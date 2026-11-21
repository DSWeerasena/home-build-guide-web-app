import { migrateLegacySteel, upgradeFoundation, type BrickworkCalculation, type FoundationCalculation, type QuantityResult, type ReinforcementCalculation, type WorkStatus } from "./calculators.ts";
import { toLengthUnit } from "./units.ts";
import { normalizeCompletion } from "./progress.ts";

export type TotalRow = { label: string; value: string };

export const makeId = () => globalThis.crypto.randomUUID();

// 1-based position label shown on saved calculations: index 0 -> "01".
export const padIndex = (index: number) => String(index + 1).padStart(2, "0");

// existingCount is how many calculations of this kind are already saved.
export const defaultCalcName = (label: string, existingCount: number) => `${label} ${padIndex(existingCount)}`;

export const upsertById = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some(x => x.id === item.id) ? list.map(x => (x.id === item.id ? item : x)) : [...list, item];

export const removeById = <T extends { id: string }>(list: T[], id: string): T[] => list.filter(x => x.id !== id);

// The copy is inserted directly after its original and never overwrites it.
export function duplicateById<T extends { id: string }>(list: T[], id: string, rename: (item: T) => T): T[] {
  const index = list.findIndex(x => x.id === id);
  if (index < 0) return list;
  const copy = { ...rename(list[index]), id: makeId() };
  return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
}

export function parseQuantity(value: string): { amount: number; unit: string } | null {
  const match = /^\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(.*?)\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? { amount, unit: match[2] } : null;
}

// Adds up the named results across calculations; quantities are only combined when their units match.
// Labels are accepted as a readonly list so the `as const` TOTAL_LABELS tuples can be passed directly.
export function sumQuantities(resultSets: (QuantityResult[] | undefined)[], labels: readonly string[]): TotalRow[] {
  const rows: TotalRow[] = [];
  for (const label of labels) {
    const byUnit = new Map<string, number>();
    for (const set of resultSets) {
      for (const result of set ?? []) {
        if (result.label !== label) continue;
        const q = parseQuantity(result.value);
        if (q) byUnit.set(q.unit, (byUnit.get(q.unit) ?? 0) + q.amount);
      }
    }
    for (const [unit, amount] of byUnit) rows.push({ label, value: `${Number(amount.toFixed(3))}${unit ? ` ${unit}` : ""}` });
  }
  return rows;
}

// Result labels that are meaningful to add together for each calculator.
export const TOTAL_LABELS = {
  foundation: ["Metal", "Sand", "Cement"],
  brickwork: ["Net Wall Area", "Estimated Bricks", "Estimated Cement Blocks", "Mortar (Wet)", "Mortar (Dry)", "Cement", "Sand"],
  concrete: ["Wet Concrete Volume", "Cement", "Sand", "Aggregate"],
  flooring: ["Floor Area", "Cement", "Sand", "Aggregate"],
  plastering: ["Plaster area", "Mortar", "Cement", "Sand"],
  cementWorks: ["Cement", "Sand", "Aggregate"],
} as const;

// Combined steel totals; `t` maps the label keys below to display text.
export function sumReinforcement(calcs: ReinforcementCalculation[], t: (key: string) => string = key => key): TotalRow[] {
  if (!calcs.length) return [];
  const sum = (pick: (c: ReinforcementCalculation) => number) => calcs.reduce((total, c) => total + pick(c), 0);
  const rows: TotalRow[] = [
    { label: t("rebar.totalBars"), value: String(sum(c => c.results.totalStockBars)) },
    { label: t("rebar.totalPurchased"), value: `${Number(sum(c => c.results.totalPurchasedFt).toFixed(2))} ft` },
  ];
  if (calcs.some(c => c.results.stirrups)) {
    rows.push({ label: t("rebar.stirrupCount"), value: String(sum(c => c.results.stirrups?.total ?? 0)) });
    rows.push({ label: t("rebar.stirrupBars"), value: String(sum(c => c.results.stirrups?.stockBars ?? 0)) });
  }
  return rows;
}

export function migrateLegacyFoundation(legacy: any): FoundationCalculation | null {
  const m = legacy?.measurements;
  if (!m?.length || !m?.width || !m?.depth || !Array.isArray(legacy.results)) return null;
  return { id: makeId(), name: "Foundation 01", method: "manual", measurements: { length: m.length, width: m.width, depth: m.depth }, results: legacy.results };
}

// Keeps the original creation time and records when the calculation was last saved.
export function stampRecord<T extends { createdAt?: string; updatedAt?: string }>(record: T, existing?: { createdAt?: string } | null): T {
  const now = new Date().toISOString();
  return { ...record, createdAt: existing?.createdAt ?? record.createdAt ?? now, updatedAt: now };
}

// Flips a saved calculation between ongoing and completed.
export const toggleWorkStatus = <T extends { id: string; workStatus?: WorkStatus }>(list: T[], id: string): T[] =>
  list.map(item => (item.id === id ? { ...item, workStatus: item.workStatus === "completed" ? "ongoing" : "completed", updatedAt: new Date().toISOString() } : item));

// Brickwork saved before multiple openings existed kept one total area; it becomes a single "other" opening of the same area.
export function upgradeBrickworkOpenings(calc: BrickworkCalculation): BrickworkCalculation {
  if (Array.isArray(calc.openings)) return calc;
  const area = Number(calc.openingArea) || 0;
  if (area <= 0) return { ...calc, openings: [] };
  const unit = toLengthUnit(String(calc.units?.openingArea ?? "m²").replace("²", "")) ?? "m";
  return { ...calc, openings: [{ id: `${calc.id}-opening-1`, type: "other", width: area, height: 1, unit }] };
}

// Upgrades older saved projects: single steel list -> reinforcement list, single foundation -> foundation list,
// foundations without wastage are recalculated, brickwork single opening area -> opening list.
export function migrateProject<T extends Record<string, any>>(saved: T): T {
  let project: Record<string, any> = { ...saved };
  if (Array.isArray(project.steelCalculations)) {
    const { steelCalculations, ...rest } = project;
    project = { ...rest, reinforcementCalculations: [...(rest.reinforcementCalculations || []), ...steelCalculations.map(migrateLegacySteel)] };
  }
  const legacyFoundation = project.calculations?.foundation;
  if (legacyFoundation) {
    const { foundation, ...otherCalculations } = project.calculations;
    const migrated = migrateLegacyFoundation(legacyFoundation);
    project = {
      ...project,
      calculations: otherCalculations,
      foundationCalculations: migrated ? [...(project.foundationCalculations || []), migrated] : project.foundationCalculations,
    };
  }
  if (Array.isArray(project.foundationCalculations)) project = { ...project, foundationCalculations: project.foundationCalculations.map(upgradeFoundation) };
  if (Array.isArray(project.brickworkCalculations)) project = { ...project, brickworkCalculations: project.brickworkCalculations.map(upgradeBrickworkOpenings) };
  if (Array.isArray(project.completed) && project.checklists) project = normalizeCompletion(project as any);
  return project as T;
}
