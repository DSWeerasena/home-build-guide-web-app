// Converts between the app's in-memory project and the API's records (one Firestore document per calculation).
// Pure functions only, so the sync logic can be unit-tested without Firebase.
import type { BrickworkCalculation, CementWorksCalculation, FoundationCalculation, ReinforcementCalculation } from "../utils/calculators.ts";
import { loadProject } from "../utils/loadProject.ts";

export type CalcKind = "foundation" | "brickwork" | "cement" | "rebar";
export type CalcRecord = { id: string; kind: CalcKind; category: string; name: string; data: Record<string, any> };

export type ProjectLike = {
  name: string;
  userName: string;
  completed: string[];
  checklists: Record<string, boolean[]>;
  calculations: Record<string, any>;
  foundationCalculations?: FoundationCalculation[];
  brickworkCalculations?: BrickworkCalculation[];
  cementWorksCalculations?: CementWorksCalculation[];
  reinforcementCalculations?: ReinforcementCalculation[];
  foundationPlan: { segments: any[]; totalLength: number };
};

export type ProjectMeta = { projectName: string; completed: string[]; checklists: Record<string, boolean[]>; progress: number };

export const LEGACY_PROJECT_KEY = "hbg-project";
export const LEGACY_IMPORTED_KEY = "hbg-legacy-imported";
export const legacyDismissedKey = (uid: string) => `hbg-legacy-dismissed:${uid}`;
const DEFAULT_LOCAL_NAME = "My First House";

export function flattenProject(project: ProjectLike): CalcRecord[] {
  return [
    ...(project.foundationCalculations ?? []).map(c => ({ id: c.id, kind: "foundation" as const, category: c.method, name: c.name, data: c })),
    ...(project.brickworkCalculations ?? []).map(c => ({ id: c.id, kind: "brickwork" as const, category: c.wallType ?? "brick", name: c.name, data: c })),
    ...(project.cementWorksCalculations ?? []).map(c => ({ id: c.id, kind: "cement" as const, category: c.category, name: c.name, data: c })),
    ...(project.reinforcementCalculations ?? []).map(c => ({ id: c.id, kind: "rebar" as const, category: `rebar-${c.memberType}`, name: c.calculationName, data: c })),
  ];
}

export const recordKey = (r: CalcRecord) => JSON.stringify(r);

// Only records that changed since the last successful save are sent; removed ones are deleted.
export function diffRecords(lastSaved: Map<string, string>, current: CalcRecord[]) {
  const currentIds = new Set(current.map(r => r.id));
  return {
    upserts: current.filter(r => lastSaved.get(r.id) !== recordKey(r)),
    deletes: [...lastSaved.keys()].filter(id => !currentIds.has(id)),
  };
}

export function projectMeta(project: ProjectLike, totalStages: number): ProjectMeta {
  return {
    projectName: project.name.trim() || "My House Project",
    completed: project.completed,
    checklists: project.checklists,
    progress: totalStages ? Math.round((project.completed.length / totalStages) * 100) : 0,
  };
}

export type ServerCalculation = { id: string; kind: CalcKind; data: Record<string, any> };
export type ServerProject = { id: string; projectName?: string; completed?: string[]; checklists?: Record<string, boolean[]> };

export function assembleProject(project: ServerProject, calculations: ServerCalculation[], userName: string, emptyChecklists: Record<string, boolean[]>): ProjectLike {
  const ofKind = <T,>(kind: CalcKind) => calculations.filter(c => c.kind === kind).map(c => ({ ...c.data, id: c.id }) as T);
  // Same upgrades as browser-saved projects (foundation wastage, opening lists) and completion derived from current records.
  return loadProject({
    name: project.projectName || "My House Project",
    userName,
    completed: project.completed ?? [],
    checklists: { ...emptyChecklists, ...(project.checklists ?? {}) },
    calculations: {},
    foundationCalculations: ofKind<FoundationCalculation>("foundation"),
    brickworkCalculations: ofKind<BrickworkCalculation>("brickwork"),
    cementWorksCalculations: ofKind<CementWorksCalculation>("cement"),
    reinforcementCalculations: ofKind<ReinforcementCalculation>("rebar"),
    foundationPlan: { segments: [], totalLength: 0 },
  });
}

// Foundation plans still holding an in-browser image (data URL) must be uploaded to Storage before saving.
export function plansNeedingUpload(records: CalcRecord[]) {
  return records.filter(r => r.kind === "foundation" && typeof r.data.plan?.image === "string" && r.data.plan.image.startsWith("data:"));
}

export function referencedPlanIds(records: CalcRecord[]): Set<string> {
  return new Set(records.flatMap(r => (r.kind === "foundation" && r.data.plan?.planId ? [r.data.plan.planId as string] : [])));
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export const extensionForMime = (mime: string) => (mime === "image/png" ? "png" : mime === "application/pdf" ? "pdf" : "jpg");

// ---- Legacy (browser-only) projects ----------------------------------------------------------

export function readLegacyProject(storage: Pick<Storage, "getItem">): ProjectLike | null {
  try {
    const raw = storage.getItem(LEGACY_PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.completed)) return null;
    return loadProject(parsed) as ProjectLike;
  } catch {
    return null;
  }
}

// Worth offering only when the browser holds real work, not just the untouched starter project.
export function hasMeaningfulLegacyData(project: ProjectLike | null): project is ProjectLike {
  return Boolean(project && (flattenProject(project).length > 0 || (project.name && project.name !== DEFAULT_LOCAL_NAME)));
}

export function shouldOfferLegacyImport(storage: Pick<Storage, "getItem">, uid: string): ProjectLike | null {
  if (storage.getItem(LEGACY_IMPORTED_KEY) || storage.getItem(legacyDismissedKey(uid))) return null;
  const legacy = readLegacyProject(storage);
  return hasMeaningfulLegacyData(legacy) ? legacy : null;
}

// Legacy records are added to whatever the account already holds; ids are UUIDs so nothing is overwritten.
export function mergeLegacyInto(cloud: ProjectLike, legacy: ProjectLike): ProjectLike {
  const merge = <T extends { id: string }>(a: T[] = [], b: T[] = []) => [...a, ...b.filter(x => !a.some(y => y.id === x.id))];
  const checklists = { ...cloud.checklists };
  for (const [stage, checks] of Object.entries(legacy.checklists ?? {})) {
    if (Array.isArray(checks) && checks.every(v => typeof v === "boolean")) checklists[stage] = (checklists[stage] ?? []).length ? checklists[stage].map((v, i) => v || Boolean(checks[i])) : checks;
  }
  return {
    ...cloud,
    name: legacy.name && legacy.name !== DEFAULT_LOCAL_NAME ? legacy.name : cloud.name,
    completed: [...new Set([...cloud.completed, ...(legacy.completed ?? []).filter(s => typeof s === "string")])],
    checklists,
    foundationCalculations: merge(cloud.foundationCalculations, legacy.foundationCalculations),
    brickworkCalculations: merge(cloud.brickworkCalculations, legacy.brickworkCalculations),
    cementWorksCalculations: merge(cloud.cementWorksCalculations, legacy.cementWorksCalculations),
    reinforcementCalculations: merge(cloud.reinforcementCalculations, legacy.reinforcementCalculations),
  };
}
