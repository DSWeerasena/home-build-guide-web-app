// Loading a saved project: the usual upgrades, then any result still using the old cement-bag basis
// (50 kg bag ≈ 1.23 ft³) is recalculated from its saved inputs with 1 bag = 1 ft³.
// Kept separate from multiCalc.ts because it needs cementCategories.ts, which itself imports multiCalc.ts.
import { BRICKWORK_CATEGORIES, calculateBrickwork, totalOpeningAreaSquareMetres as totalOpeningArea, type BrickworkCalculation, type CementWorksCalculation, type QuantityResult } from "./calculators.ts";
import { getCategoryConfig, runCategory } from "./cementCategories.ts";
import { migrateProject } from "./multiCalc.ts";
import { convertToMetres, toLengthUnit } from "./units.ts";

const OLD_BAG_NOTE = "50 kg bags";
const usesOldBags = (results?: QuantityResult[]) => !!results?.some(r => r.note === OLD_BAG_NOTE);

function refreshBrickwork(calc: BrickworkCalculation): BrickworkCalculation {
  if (!usesOldBags(calc.results)) return calc;
  const isBlock = calc.wallType === "cement-block";
  const thickness = BRICKWORK_CATEGORIES.find(c => c.id === calc.categoryId)?.thicknesses.find(t => t.id === calc.thicknessId);
  const wallWidth = isBlock && calc.wallWidth ? convertToMetres(calc.wallWidth.value, calc.wallWidth.unit) : thickness ? convertToMetres(Number(thickness.inches), "in") : null;
  if (!wallWidth) return calc;
  const dims = calc.unitDimensions ?? (isBlock ? { lengthMm: 400, widthMm: 100, heightMm: 200 } : { lengthMm: 205, widthMm: 95, heightMm: 75 });
  const results = calculateBrickwork({
    categoryId: calc.categoryId,
    thicknessId: calc.thicknessId,
    wallLength: convertToMetres(calc.wallLength, toLengthUnit(calc.units?.wallLength ?? "m") ?? "m"),
    wallHeight: convertToMetres(calc.wallHeight, toLengthUnit(calc.units?.wallHeight ?? "m") ?? "m"),
    wallCount: calc.wallCount || 1,
    openingArea: calc.openings ? totalOpeningArea(calc.openings) : Number(calc.openingArea) || 0,
    wastagePercent: calc.wastagePercent,
    wallWidth,
    brickLength: dims.lengthMm / 1000,
    brickWidth: dims.widthMm / 1000,
    brickHeight: dims.heightMm / 1000,
    unitName: isBlock ? "Cement Blocks" : "Bricks",
    wallWidthNote: isBlock && calc.wallWidth ? "Entered wall width" : "Selected thickness",
  });
  return results.length ? { ...calc, results } : calc;
}

function refreshCement(calc: CementWorksCalculation): CementWorksCalculation {
  const config = getCategoryConfig(calc.category);
  if (!usesOldBags(calc.results) || !config || calc.staircase || !calc.inputs) return calc;
  const run = runCategory(config, calc.inputs.values, calc.inputs.units);
  return "output" in run ? { ...calc, results: run.output.results } : calc;
}

export function loadProject<T extends Record<string, any>>(saved: T): T {
  const project: Record<string, any> = migrateProject(saved);
  const brick: BrickworkCalculation[] = project.brickworkCalculations ?? [];
  const cement: CementWorksCalculation[] = project.cementWorksCalculations ?? [];
  if (!brick.some(c => usesOldBags(c.results)) && !cement.some(c => usesOldBags(c.results))) return project as T;
  return { ...project, brickworkCalculations: brick.map(refreshBrickwork), cementWorksCalculations: cement.map(refreshCement) } as unknown as T;
}
