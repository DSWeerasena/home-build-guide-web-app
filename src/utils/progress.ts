// Stage completion is always derived from the project's current records, so it can never go stale.
import type { WorkStatus } from "./calculators.ts";

type WithStatus = { workStatus?: WorkStatus };
export type ProgressProject = {
  completed: string[];
  checklists: Record<string, boolean[]>;
  foundationCalculations?: WithStatus[];
  brickworkCalculations?: WithStatus[];
  cementWorksCalculations?: (WithStatus & { category: string })[];
  reinforcementCalculations?: WithStatus[];
};

const cement = (p: ProgressProject, ...categories: string[]) => (p.cementWorksCalculations ?? []).filter(c => categories.includes(c.category));

// The saved calculations that belong to each stage that has a checklist.
const STAGE_RECORDS: Record<string, (p: ProgressProject) => WithStatus[]> = {
  foundation: p => p.foundationCalculations ?? [],
  brickwork: p => p.brickworkCalculations ?? [],
  "columns-beams-lintel": p => [...cement(p, "column", "beam", "lintel"), ...(p.reinforcementCalculations ?? [])],
  plastering: p => cement(p, "plastering"),
  flooring: p => cement(p, "flooring"),
  slab: p => cement(p, "slab"),
  "stair-case": p => cement(p, "staircase"),
};

// A parent stage is complete exactly when all of its sub-stages are.
export const PARENT_STAGES: Record<string, string[]> = { "cement-works": ["columns-beams-lintel", "plastering", "flooring", "slab", "stair-case"] };

export const stageRecords = (project: ProgressProject, stageId: string) => STAGE_RECORDS[stageId]?.(project) ?? [];
export const isRecordCompleted = (record: WithStatus) => record.workStatus === "completed";

export type CompletionBlocker = "checklist" | "noRecords" | "ongoingRecords" | null;

// Why a stage cannot be marked complete right now (null = it can).
export function completionBlocker(project: ProgressProject, stageId: string): CompletionBlocker {
  const checks = project.checklists[stageId] ?? [];
  if (!checks.length || !checks.every(Boolean)) return "checklist";
  const records = stageRecords(project, stageId);
  if (!records.length) return "noRecords";
  if (!records.every(isRecordCompleted)) return "ongoingRecords";
  return null;
}

// Removes completion that no longer matches the current records and sets parent stages from their children.
// Returns the same object when nothing changes, so React does not re-render needlessly.
export function normalizeCompletion<T extends ProgressProject>(project: T): T {
  const kept = project.completed.filter(id => !PARENT_STAGES[id] && STAGE_RECORDS[id] && completionBlocker(project, id) === null);
  const parents = Object.entries(PARENT_STAGES).filter(([, children]) => children.every(c => kept.includes(c))).map(([id]) => id);
  const next = [...new Set([...kept, ...parents])];
  const same = next.length === project.completed.length && next.every(id => project.completed.includes(id));
  return same ? project : { ...project, completed: next };
}
