import {
  calculateBeams, calculateCementConcretFloor, calculateColumns, calculateLintels, calculateSlab, calculateStage,
  convertToMeters, LINTEL_SIZES, PLASTERING_MIX, type CementWorksCalculation, type MemberType, type QuantityResult, type UnitType,
} from "./calculators.ts";
import { convertAreaToSquareMetres, isAreaUnit, type AreaUnit } from "./units.ts";
import { sumQuantities, TOTAL_LABELS } from "./multiCalc.ts";
import { STAIRCASE_TOTAL_LABELS } from "./staircase.ts";

export type FieldValue = string | number;
export type CategoryId = CementWorksCalculation["category"];

export type FieldDef =
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[]; fallback: string; fromCalc?: (c: CementWorksCalculation) => string | undefined }
  | { kind: "dimension"; key: string; label: string; fallback: number; unit: UnitType; fromCalc?: (c: CementWorksCalculation) => number | undefined }
  // An area typed in any of the shared area units (converted to m² for the formulas).
  | { kind: "area"; key: string; label: string; fallback: number; unit: AreaUnit; fromCalc?: (c: CementWorksCalculation) => number | undefined }
  | { kind: "number"; key: string; label: string; fallback: number; min?: "positive" | "nonNegative"; integer?: boolean; fromCalc?: (c: CementWorksCalculation) => number | undefined };

export type CategoryOutput = { results: QuantityResult[]; save: Partial<CementWorksCalculation> };

export type CategoryConfig = {
  id: CategoryId;
  label: string;
  singular: string;
  icon: string;
  description: string;
  heading: string;
  subheading: string;
  namePlaceholder: string;
  fields: FieldDef[];
  // Set when the category has no validated calculation method yet.
  unavailable?: string;
  // Reinforcement steel estimates can be attached to these members.
  member?: MemberType;
  compute: (values: Record<string, FieldValue>, metres: Record<string, number>) => CategoryOutput;
  validate?: (values: Record<string, FieldValue>, metres: Record<string, number>) => string | null;
  summary: (calc: CementWorksCalculation) => [string, string][];
  // [result label, label shown on the saved card]
  summaryResults: [string, string][];
  totalLabels: readonly string[];
  // Material volumes can be shown in Cubes / ft³ / m³ (display only).
  volumeOutput?: boolean;
};

export type FieldUnit = UnitType | AreaUnit;

const UNIT_SHORT: Record<UnitType, string> = { mm: "mm", cm: "cm", m: "m", inch: "in", foot: "ft", cubic_feet: "ft³", cubic_inches: "in³" };
const num = (n: number) => String(Number(n.toFixed(3)));
const GRADE_MIX = { grade20: "1:2:4", grade25: "1:1.5:3" } as const;
const FLOOR_LABEL: Record<string, string> = { ground: "Ground Floor", first: "First Floor", second: "Second Floor" };

// Shows a dimension the way the user typed it, falling back to metres for older saved records.
function dim(c: CementWorksCalculation, key: string): string {
  const entered = c.inputs?.values[key];
  const unit = c.inputs?.units[key];
  if (typeof entered === "number" && unit) return `${num(entered)} ${isAreaUnit(unit) ? unit : UNIT_SHORT[unit]}`;
  const metres = c.dimensions?.[key];
  return metres === undefined ? "—" : `${num(metres)} m`;
}

const basisNumber = (c: CementWorksCalculation, key: string) => (c.basis?.[key] === undefined ? undefined : Number(c.basis[key]));

const GRADE_FIELD: FieldDef = { kind: "select", key: "grade", label: "Concrete Grade", options: [{ value: "grade20", label: "Grade 20 (1:2:4)" }, { value: "grade25", label: "Grade 25 (1:1.5:3)" }], fallback: "grade20", fromCalc: c => c.concreteGrade };
const FLOOR_FIELD: FieldDef = { kind: "select", key: "floor", label: "Floor Level", options: [{ value: "ground", label: "Ground Floor" }, { value: "first", label: "First Floor" }, { value: "second", label: "Second Floor" }], fallback: "ground", fromCalc: c => c.floorLevel };
const countField = (label: string, fallback: number): FieldDef => ({ kind: "number", key: "count", label, fallback, integer: true, fromCalc: c => c.count });
const CONCRETE_SUMMARY: [string, string][] = [["Wet Concrete Volume", "Concrete"], ["Cement", "Cement"], ["Sand", "Sand"], ["Aggregate", "Aggregate"]];

export const CATEGORY_CONFIGS: CategoryConfig[] = [
  {
    id: "column", label: "Columns", singular: "Column", icon: "▥", description: "Concrete & reinforcement steel",
    heading: "Columns Calculator", subheading: "Reinforced Concrete Columns with flexible units", namePlaceholder: "e.g., Front Columns",
    member: "column",
    fields: [GRADE_FIELD, FLOOR_FIELD,
      { kind: "dimension", key: "width", label: "Width", fallback: 300, unit: "mm" },
      { kind: "dimension", key: "depth", label: "Depth", fallback: 300, unit: "mm" },
      { kind: "dimension", key: "height", label: "Height", fallback: 3, unit: "m" },
      countField("Number of Columns", 6)],
    compute: (v, m) => {
      const grade = v.grade as "grade20" | "grade25";
      const count = Number(v.count);
      return {
        results: calculateColumns({ width: m.width, depth: m.depth, height: m.height, count, grade }),
        save: { concreteGrade: grade, mixRatio: GRADE_MIX[grade], floorLevel: v.floor as CementWorksCalculation["floorLevel"], dimensions: { width: m.width, depth: m.depth, height: m.height }, count },
      };
    },
    summary: c => [["Number of Columns", String(c.count ?? "—")], ["Height", dim(c, "height")], ["Width × Depth", `${dim(c, "width")} × ${dim(c, "depth")}`], ["Floor Level", FLOOR_LABEL[c.floorLevel ?? ""] ?? "—"]],
    summaryResults: CONCRETE_SUMMARY, totalLabels: TOTAL_LABELS.concrete,
  },
  {
    id: "beam", label: "Beams", singular: "Beam", icon: "▬", description: "Concrete & reinforcement steel",
    heading: "Beams Calculator", subheading: "Reinforced Concrete Beams with flexible units", namePlaceholder: "e.g., Living Room Beam",
    member: "beam",
    fields: [GRADE_FIELD, FLOOR_FIELD,
      { kind: "dimension", key: "length", label: "Length", fallback: 4, unit: "m" },
      { kind: "dimension", key: "width", label: "Width", fallback: 300, unit: "mm" },
      { kind: "dimension", key: "depth", label: "Depth", fallback: 400, unit: "mm" },
      countField("Number of Beams", 4)],
    compute: (v, m) => {
      const grade = v.grade as "grade20" | "grade25";
      const count = Number(v.count);
      return {
        results: calculateBeams({ length: m.length, width: m.width, depth: m.depth, count, grade, floorLevel: String(v.floor) }),
        save: { concreteGrade: grade, mixRatio: GRADE_MIX[grade], floorLevel: v.floor as CementWorksCalculation["floorLevel"], dimensions: { length: m.length, width: m.width, depth: m.depth }, count },
      };
    },
    summary: c => [["Number of Beams", String(c.count ?? "—")], ["Length", dim(c, "length")], ["Width × Depth", `${dim(c, "width")} × ${dim(c, "depth")}`], ["Floor Level", FLOOR_LABEL[c.floorLevel ?? ""] ?? "—"]],
    summaryResults: CONCRETE_SUMMARY, totalLabels: TOTAL_LABELS.concrete,
  },
  {
    id: "lintel", label: "Lintels", singular: "Lintel", icon: "▭", description: "Concrete & reinforcement steel",
    heading: "Lintels Calculator", subheading: "Grade 20 Concrete Lintels with flexible units", namePlaceholder: "e.g., Door Lintels",
    member: "lintel",
    fields: [
      { kind: "select", key: "size", label: "Lintel Size", options: LINTEL_SIZES.map(s => ({ value: s.id, label: s.label })), fallback: "9x9", fromCalc: c => c.lintelSize },
      { kind: "dimension", key: "length", label: "Lintel Length", fallback: 1200, unit: "mm" },
      countField("Number of Lintels", 8)],
    compute: (v, m) => {
      const size = LINTEL_SIZES.find(s => s.id === v.size) ?? LINTEL_SIZES[0];
      const count = Number(v.count);
      return {
        results: calculateLintels({ length: m.length, width: size.width, depth: size.depth, count }),
        save: { concreteGrade: "grade20", mixRatio: GRADE_MIX.grade20, lintelSize: size.id, dimensions: { length: m.length }, count },
      };
    },
    summary: c => [["Number of Lintels", String(c.count ?? "—")], ["Lintel Size", LINTEL_SIZES.find(s => s.id === c.lintelSize)?.label ?? "—"], ["Length", dim(c, "length")]],
    summaryResults: CONCRETE_SUMMARY, totalLabels: TOTAL_LABELS.concrete,
  },
  {
    id: "slab", label: "Slab", singular: "Slab", icon: "▢", description: "Grade 20 4\" / 5\"",
    heading: "Slab Calculator", subheading: "Grade 20 Concrete Slab with flexible units", namePlaceholder: "e.g., First Floor Slab",
    fields: [
      { kind: "select", key: "thickness", label: "Slab Thickness", options: [{ value: "4", label: "4 inch" }, { value: "5", label: "5 inch" }], fallback: "4", fromCalc: c => c.slabThickness },
      { kind: "dimension", key: "length", label: "Length", fallback: 5, unit: "m" },
      { kind: "dimension", key: "width", label: "Width", fallback: 4, unit: "m" },
      countField("Number of Slabs", 1)],
    compute: (v, m) => {
      const thickness = v.thickness === "5" ? "5" : "4";
      const count = Number(v.count);
      return {
        results: calculateSlab({ length: m.length, width: m.width, thickness: thickness === "4" ? 0.1016 : 0.127, count }),
        save: { concreteGrade: "grade20", mixRatio: GRADE_MIX.grade20, slabThickness: thickness, dimensions: { length: m.length, width: m.width }, count },
      };
    },
    summary: c => [["Number of Slabs", String(c.count ?? "—")], ["Thickness", c.slabThickness ? `${c.slabThickness} in` : "—"], ["Length × Width", `${dim(c, "length")} × ${dim(c, "width")}`]],
    summaryResults: CONCRETE_SUMMARY, totalLabels: TOTAL_LABELS.concrete,
  },
  {
    id: "flooring", label: "Flooring", singular: "Flooring", icon: "▦", description: "Concrete & Rendering",
    heading: "Flooring Calculator", subheading: "Floor Material Calculation with flexible units", namePlaceholder: "e.g., Living Room Floor",
    fields: [
      { kind: "select", key: "type", label: "Flooring Type", options: [{ value: "cement-concrete", label: "Cement Concrete Floor (1:2.5:5 + Rendering 1:3)" }, { value: "tile-bedding", label: "Tile Bedding - Cement Mortar (1:3)" }], fallback: "cement-concrete", fromCalc: c => c.flooringType },
      { kind: "dimension", key: "length", label: "Length", fallback: 6, unit: "m" },
      { kind: "dimension", key: "width", label: "Width", fallback: 5, unit: "m" }],
    compute: (v, m) => {
      const type = v.type === "tile-bedding" ? "tile-bedding" : "cement-concrete";
      const results: QuantityResult[] = type === "cement-concrete"
        ? calculateCementConcretFloor({ length: m.length, width: m.width })
        : [
          { label: "Floor Area", value: `${(m.length * m.width).toFixed(2)} m²` },
          { label: "Mortar Ratio", value: "1 : 3" },
          { label: "Note", value: "Bedding thickness must be specified from construction plan" },
        ];
      return { results, save: { mixRatio: type === "cement-concrete" ? "1:2.5:5 + 1:3 rendering" : "1:3", flooringType: type, dimensions: { length: m.length, width: m.width } } };
    },
    summary: c => [["Flooring Type", c.flooringType === "tile-bedding" ? "Tile Bedding" : c.flooringType === "cement-concrete" ? "Cement Concrete Floor" : "—"], ["Length × Width", `${dim(c, "length")} × ${dim(c, "width")}`]],
    summaryResults: [["Floor Area", "Floor Area"], ["Cement", "Cement"], ["Sand", "Sand"], ["Aggregate", "Aggregate"]], totalLabels: TOTAL_LABELS.flooring,
  },
  {
    id: "plastering", label: "Plastering", singular: "Plastering", icon: "▨", description: "Mortar based",
    heading: "Plastering Calculator", subheading: "Wall plaster quantities with flexible units", namePlaceholder: "e.g., Ground Floor Walls",
    fields: [
      { kind: "dimension", key: "length", label: "Wall Length", fallback: 10, unit: "m" },
      { kind: "dimension", key: "height", label: "Wall Height", fallback: 3, unit: "m" },
      { kind: "area", key: "openings", label: "Openings Area", fallback: 3, unit: "m²", fromCalc: c => basisNumber(c, "openingsM2") },
      { kind: "dimension", key: "thickness", label: "Plaster Thickness", fallback: 12, unit: "mm", fromCalc: c => basisNumber(c, "thicknessMm") },
      { kind: "number", key: "wastage", label: "Wastage (%)", fallback: 5, min: "nonNegative", fromCalc: c => basisNumber(c, "wastagePercent") }],
    validate: (_v, m) => (m.openings > m.length * m.height ? "val.openingsExceed" : null),
    compute: (v, m) => {
      const thicknessMm = Number((m.thickness * 1000).toFixed(3));
      const openingsM2 = Number(m.openings.toFixed(4));
      return {
        results: calculateStage("plastering", { length: m.length, height: m.height, openings: openingsM2, thickness: thicknessMm, wastage: Number(v.wastage) }),
        save: { mixRatio: PLASTERING_MIX.join(":"), dimensions: { length: m.length, height: m.height }, basis: { openingsM2, thicknessMm, wastagePercent: Number(v.wastage) } },
      };
    },
    summary: c => [["Wall Length × Height", `${dim(c, "length")} × ${dim(c, "height")}`], ["Openings", c.inputs?.units.openings ? dim(c, "openings") : `${c.basis?.openingsM2 ?? "—"} m²`], ["Thickness", c.inputs?.units.thickness ? dim(c, "thickness") : `${c.basis?.thicknessMm ?? "—"} mm`], ["Mix Ratio", `${PLASTERING_MIX.join(" : ")} (Cement : Sand)`]],
    summaryResults: [["Plaster area", "Plaster Area"], ["Mortar", "Mortar"], ["Cement", "Cement"], ["Cement Volume", "Cement Volume"], ["Sand", "Sand"]], totalLabels: TOTAL_LABELS.plastering,
    volumeOutput: true,
  },
  {
    // Uses its own form (StaircaseCalculator); fields and compute are not used for this category.
    id: "staircase", label: "Stair Case", singular: "Stair Case", icon: "▰", description: "Concrete volume in ft³",
    heading: "Stair Case Concrete Quantity Calculator", subheading: "Geometry-based concrete estimate", namePlaceholder: "e.g., Main Staircase",
    fields: [],
    compute: () => ({ results: [], save: {} }),
    summary: c => {
      const s = c.staircase;
      if (!s) return [];
      const shown = (d: { value: number; unit: string }) => `${num(d.value)} ${d.unit}`;
      return [
        ["Treads / Risers", `${s.numberOfTreads} / ${s.numberOfRisers}`],
        ["Tread × Riser", `${shown(s.treadDepth)} × ${shown(s.riserHeight)}`],
        ["Stair Width", shown(s.stairWidth)],
        ["Number of Landings", s.landing ? String(s.landing.count) : "None"],
      ];
    },
    summaryResults: [["Waist Slab", "Waist Slab"], ["Steps", "Steps"], ["Landings", "Landings"], ["Total Concrete", "Total Concrete"]],
    totalLabels: STAIRCASE_TOTAL_LABELS,
  },
];

export const getCategoryConfig = (id: string | null | undefined) => CATEGORY_CONFIGS.find(c => c.id === id) ?? null;

// Form state for a new calculation, or for editing a saved one (older records without stored inputs are best-effort).
export function initialFieldState(config: CategoryConfig, initial?: CementWorksCalculation | null) {
  const values: Record<string, FieldValue> = {};
  const units: Record<string, FieldUnit> = {};
  for (const f of config.fields) {
    if (f.kind === "dimension" || f.kind === "area") {
      // Older plastering records stored thickness (mm) and openings (m²) as plain numbers without a unit.
      const legacyMetres = f.kind === "dimension" ? initial?.dimensions?.[f.key] : undefined;
      values[f.key] = initial?.inputs?.values[f.key] ?? legacyMetres ?? (initial ? f.fromCalc?.(initial) : undefined) ?? f.fallback;
      units[f.key] = initial?.inputs?.units[f.key] ?? (legacyMetres !== undefined ? "m" : f.unit);
    } else {
      values[f.key] = initial?.inputs?.values[f.key] ?? (initial ? f.fromCalc?.(initial) : undefined) ?? f.fallback;
    }
  }
  return { values, units };
}

// Lengths in metres and areas in m², whatever unit each field was typed in.
export function metresOf(config: CategoryConfig, values: Record<string, FieldValue>, units: Record<string, FieldUnit>) {
  const metres: Record<string, number> = {};
  for (const f of config.fields) {
    const unit = units[f.key];
    if (f.kind === "dimension" && !isAreaUnit(unit)) metres[f.key] = convertToMeters(Number(values[f.key]), unit);
    if (f.kind === "area") metres[f.key] = convertAreaToSquareMetres(Number(values[f.key]), isAreaUnit(unit) ? unit : "m²");
  }
  return metres;
}

// A translation key plus the English field label it refers to; the UI turns both into the selected language.
export type ValidationMessage = { key: string; field?: string };

export function validateCategory(config: CategoryConfig, values: Record<string, FieldValue>, metres: Record<string, number>): ValidationMessage | null {
  for (const f of config.fields) {
    if (f.kind === "select") continue;
    const raw = values[f.key];
    const n = Number(raw);
    const allowZero = f.kind === "area" || (f.kind === "number" && f.min === "nonNegative");
    if (raw === "" || !Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) return { key: allowZero ? "val.zeroOrMore" : "val.greaterThanZero", field: f.label };
    if (f.kind === "number" && f.integer && !Number.isInteger(n)) return { key: "val.wholeNumber", field: f.label };
  }
  const custom = config.validate?.(values, metres);
  return custom ? { key: custom } : null;
}

export function runCategory(config: CategoryConfig, values: Record<string, FieldValue>, units: Record<string, FieldUnit>): { output: CategoryOutput } | { error: ValidationMessage } {
  const metres = metresOf(config, values, units);
  const error = validateCategory(config, values, metres);
  return error ? { error } : { output: config.compute(values, metres) };
}

export function buildCementCalculation(config: CategoryConfig, input: { id: string; name: string; values: Record<string, FieldValue>; units: Record<string, FieldUnit>; output: CategoryOutput }): CementWorksCalculation {
  return { ...input.output.save, id: input.id, name: input.name, category: config.id, results: input.output.results, inputs: { values: input.values, units: input.units } };
}

// Rows for the saved card: category-specific values followed by the key material quantities.
export function cementSummaryRows(config: CategoryConfig, calc: CementWorksCalculation): [string, string][] {
  const materials = config.summaryResults.flatMap(([label, shown]) => {
    const row = sumQuantities([calc.results], [label])[0];
    return row ? [[shown, row.value] as [string, string]] : [];
  });
  return [...config.summary(calc), ...materials];
}
