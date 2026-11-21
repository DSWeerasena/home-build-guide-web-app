import { convertToFeet, convertToInches, convertToMetres, LENGTH_UNITS, type AreaUnit, type LengthUnit } from "./units.ts";
import { cementBagsFromCubicFeet, cementBagsFromCubicMetres, FOUNDATION_WASTAGE_PERCENT, type VolumeUnit } from "./quantities.ts";
import type { StaircaseCalculation } from "./staircase.ts";

export type QuantityResult = {
  label: string;
  value: string;
  note?: string;
};

// Fields every saved calculation can carry.
export type WorkStatus = "ongoing" | "completed";
export type RecordMeta = {
  workStatus?: WorkStatus;
  outputUnit?: VolumeUnit;
  createdAt?: string;
  updatedAt?: string;
};

// One door/window/other opening in a wall, entered in any length unit.
export type OpeningType = "door" | "window" | "other";
export type WallOpening = { id: string; type: OpeningType; name?: string; width: number; height: number; unit: LengthUnit };

export const openingAreaSquareMetres = (o: Pick<WallOpening, "width" | "height" | "unit">) => convertToMetres(o.width, o.unit) * convertToMetres(o.height, o.unit);
export const totalOpeningAreaSquareMetres = (openings: WallOpening[] = []) => openings.reduce((sum, o) => sum + openingAreaSquareMetres(o), 0);

export type BrickworkCategory = {
  id: string;
  name: string;
  si: string;
  mortarRatio: string;
  thicknesses: BrickworkThickness[];
};

export type BrickworkThickness = {
  id: string;
  label: string;
  inches: string;
};

export type BrickworkCalculation = {
  id: string;
  name: string;
  categoryId: string;
  thicknessId: string;
  wallLength: number;
  wallHeight: number;
  wallCount: number;
  openingArea: number;
  wastagePercent: number;
  units?: { wallLength: string; wallHeight: string; openingArea: string };
  results?: QuantityResult[];
  wallType?: "brick" | "cement-block";
  unitDimensions?: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    useStandardSize: boolean;
  };
  // Every door/window opening; openingArea above holds their total in m² for older readers.
  openings?: WallOpening[];
  // Cement block walls: the width/thickness the user typed, with its unit.
  wallWidth?: { value: number; unit: LengthUnit };
} & RecordMeta;

export type CementWorksCalculation = RecordMeta & {
  id: string;
  name: string;
  category: "column" | "beam" | "lintel" | "slab" | "flooring" | "plastering" | "staircase";
  concreteGrade?: "grade20" | "grade25";
  mixRatio?: string;
  floorLevel?: "ground" | "first" | "second";
  slabThickness?: "4" | "5";
  lintelSize?: string;
  flooringType?: "cement-concrete" | "tile-bedding";
  dimensions?: Record<string, number>;
  // Form values exactly as typed (and the unit chosen for each dimension), so an edit reopens unchanged.
  inputs?: { values: Record<string, string | number>; units: Record<string, UnitType | AreaUnit> };
  count?: number;
  results?: QuantityResult[];
  basis?: Record<string, string | number>;
  // Present only for category "staircase": every original measurement, its unit and the converted feet value.
  staircase?: StaircaseCalculation;
};

export type ConcreteMix = {
  cement: number;
  sand: number;
  aggregate?: number;
};

export const CONCRETE_MIXES: Record<string, ConcreteMix> = {
  grade20: { cement: 1, sand: 2, aggregate: 4 },
  grade25: { cement: 1, sand: 1.5, aggregate: 3 },
  floorConcrete: { cement: 1, sand: 2.5, aggregate: 5 },
  rendering: { cement: 1, sand: 3 },
  tileBedding: { cement: 1, sand: 3 },
};

export const LINTEL_SIZES = [
  { id: "4.5x6", label: "4½\" × 6\"", width: 0.1143, depth: 0.1524 },
  { id: "9x6", label: "9\" × 6\"", width: 0.2286, depth: 0.1524 },
  { id: "9x9", label: "9\" × 9\"", width: 0.2286, depth: 0.2286 },
  { id: "12x9", label: "12\" × 9\"", width: 0.3048, depth: 0.2286 },
  { id: "13.5x6", label: "13½\" × 6\"", width: 0.3429, depth: 0.1524 },
  { id: "13.5x9", label: "13½\" × 9\"", width: 0.3429, depth: 0.2286 },
  { id: "13.5x12", label: "13½\" × 12\"", width: 0.3429, depth: 0.3048 },
];

const withWaste = (value: number, wastage: number) => value * (1 + wastage / 100);
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export type UnitType = "mm" | "cm" | "m" | "inch" | "foot" | "cubic_feet" | "cubic_inches";

// Length factors come from the shared units module; the two cubic entries belong to the older result-display selector.
export const UNIT_CONVERSIONS: Record<UnitType, number> = {
  mm: convertToMetres(1, "mm"),
  cm: convertToMetres(1, "cm"),
  m: 1,
  inch: convertToMetres(1, "in"),
  foot: convertToMetres(1, "ft"),
  cubic_feet: 0.01,
  cubic_inches: 0.01 / 1728,
};

export function convertToMeters(value: number, unit: UnitType): number {
  return value * UNIT_CONVERSIONS[unit];
}

export function convertFromMeters(value: number, unit: UnitType): number {
  return value / UNIT_CONVERSIONS[unit];
}

export function formatInUnit(value: number, unit: UnitType, digits = 2): string {
  const converted = convertFromMeters(value, unit);
  return `${converted.toFixed(digits)} ${unit}`;
}

export const UNIT_LABELS: Record<UnitType, string> = {
  mm: "Millimetre (mm)",
  cm: "Centimetre (cm)",
  m: "Metre (m)",
  inch: "Inch (in)",
  foot: "Foot (ft)",
  cubic_feet: "Cubic Feet (100 = 1 Cube)",
  cubic_inches: "Cubic Inches (1728 per Foot)",
};

export function convertResultValue(value: string, fromUnit: UnitType, toUnit: UnitType): string {
  if (fromUnit === toUnit) return value;

  // Extract numeric value from strings like "1.5 m³" or "45 bags"
  const match = value.match(/^([\d.]+)\s*([a-zA-Z³²]*)?/);
  if (!match) return value;

  const numValue = parseFloat(match[1]);
  const unitPart = match[2] || "";

  // If it's not a metric measurement (like "bags", "count"), return as-is
  if (!unitPart.includes("m") && !unitPart.includes("³") && !unitPart.includes("²")) {
    return value;
  }

  // Determine if it's cubic, square, or linear
  const isCubic = unitPart.includes("³");
  const isSquare = unitPart.includes("²");

  let converted: number;
  if (isCubic) {
    // Special handling for cubic_feet: 100 cubic_feet = 1 m³
    if (toUnit === "cubic_feet") {
      converted = numValue * 100;
      return `${converted.toFixed(2)} cubic_feet`;
    }
    // Special handling for cubic_inches: 172800 cubic_inches = 1 m³ (100 * 1728)
    if (toUnit === "cubic_inches") {
      converted = numValue * 172800;
      return `${converted.toFixed(2)} cubic_inches`;
    }
    // Convert cubic meter to cubic unit
    const factor = UNIT_CONVERSIONS[toUnit];
    converted = numValue * (factor * factor * factor);
    return `${converted.toFixed(2)} ${toUnit}³`;
  } else if (isSquare) {
    // Convert square meter to square unit
    const factor = UNIT_CONVERSIONS[toUnit];
    converted = numValue * (factor * factor);
    return `${converted.toFixed(2)} ${toUnit}²`;
  } else {
    // Convert linear meter to unit
    converted = convertFromMeters(numValue, toUnit);
    return `${converted.toFixed(2)} ${toUnit}`;
  }
}

export const BRICKWORK_CATEGORIES: BrickworkCategory[] = [
  {
    id: "standard-brick-1-5",
    name: "Standard Brickwork",
    si: "සම්මත ගඩොල් කි",
    mortarRatio: "1:5",
    thicknesses: [
      { id: "4.5in", label: "4½ inch brick wall", inches: "4.5" },
      { id: "9in", label: "9 inch brick wall", inches: "9" },
    ]
  },
  {
    id: "wire-cut-1-5",
    name: "Wire-Cut Brickwork",
    si: "වයර් කැපූ ගඩොල් කි",
    mortarRatio: "1:5",
    thicknesses: [
      { id: "4.5in", label: "4½ inch wire-cut brick", inches: "4.5" },
      { id: "9in", label: "9 inch wire-cut brick", inches: "9" },
    ]
  },
  {
    id: "brickwork-1-8",
    name: "Brickwork 1:8 Mortar",
    si: "ගඩොල් කි 1:8",
    mortarRatio: "1:8",
    thicknesses: [
      { id: "foundation", label: "Foundation up to D.P.C.", inches: "9" },
      { id: "superstructure", label: "Superstructure ground floor (9 inch)", inches: "9" },
    ]
  },
  {
    id: "hollow-block-1-5",
    name: "Hollow Block Masonry",
    si: "හිස් බ්ලොක් කි",
    mortarRatio: "1:5",
    thicknesses: [
      { id: "4in", label: "4 inch (16×8×4)", inches: "4" },
      { id: "6in", label: "6 inch (16×8×6)", inches: "6" },
      { id: "8in", label: "8 inch (16×8×8)", inches: "8" },
    ]
  },
  {
    id: "solid-block-1-5",
    name: "Solid Block Masonry",
    si: "ඝණ බ්ලොක් කි",
    mortarRatio: "1:5",
    thicknesses: [
      { id: "4in", label: "4 inch (16×8×4)", inches: "4" },
      { id: "6in", label: "6 inch (16×8×6)", inches: "6" },
      { id: "8in", label: "8 inch (16×8×8)", inches: "8" },
    ]
  },
];

// Foundation ratio Cement : Sand : Metal = 5 : 40 : 100, with the metal volume as the 100-part reference.
// Base quantities are calculated first; the wastage allowance is applied afterwards.
export function calculateFoundation({
  lengthInches,
  widthInches,
  depthInches,
  wastagePercent = FOUNDATION_WASTAGE_PERCENT,
}: {
  lengthInches: number;
  widthInches: number;
  depthInches: number;
  wastagePercent?: number;
}) {
  const metalVolumeCubicInches = lengthInches * widthInches * depthInches;
  const metal = metalVolumeCubicInches / 1728;
  const sand = metal * (40 / 100);
  const cement = metal * (5 / 100);
  const factor = 1 + wastagePercent / 100;

  return {
    metalVolumeCubicInches,
    // Base quantities (before wastage), cubic feet.
    metalVolumeCubicFeet: round(metal, 2),
    sandVolumeCubicFeet: round(sand, 2),
    cementVolumeCubicFeet: round(cement, 2),
    wastagePercent,
    // Final quantities including wastage, cubic feet (full precision kept for display conversion).
    metalFinalCubicFeet: round(metal * factor, 4),
    sandFinalCubicFeet: round(sand * factor, 4),
    cementFinalCubicFeet: round(cement * factor, 4),
    cementBags: round(cementBagsFromCubicFeet(cement * factor), 2),
  };
}

export type FoundationUnit = LengthUnit;
export type FoundationMeasurement = { value: number; unit: FoundationUnit; inches: number };
export type PlanSegment = { id: string; x1: number; y1: number; x2: number; y2: number; realLength: number; included: boolean };
export type FoundationPlanData = {
  segments: PlanSegment[];
  totalLengthM: number;
  // Downscaled preview of the uploaded plan; segment coordinates are relative to `canvas`.
  // In local mode this is a data URL; in cloud mode it is uploaded to Firebase Storage and replaced by `planId`.
  image?: string;
  canvas?: { width: number; height: number };
  planId?: string;
  fileName?: string;
};
export type FoundationCalculation = RecordMeta & {
  id: string;
  name: string;
  method: "manual" | "plan";
  measurements: { length: FoundationMeasurement; width: FoundationMeasurement; depth: FoundationMeasurement };
  // Final quantities (wastage included) in cubic feet, plus the cement bag equivalent.
  results: QuantityResult[];
  // Quantities before wastage, for the report.
  baseResults?: QuantityResult[];
  wastagePercent?: number;
  plan?: FoundationPlanData;
};

export const foundationToInches = (value: number, unit: FoundationUnit) => convertToInches(value, unit);

export function buildFoundationCalculation(input: {
  id: string;
  name: string;
  method: FoundationCalculation["method"];
  length: { value: number; unit: FoundationUnit };
  width: { value: number; unit: FoundationUnit };
  depth: { value: number; unit: FoundationUnit };
  plan?: FoundationPlanData;
  meta?: RecordMeta;
}): FoundationCalculation {
  const withInches = (m: { value: number; unit: FoundationUnit }): FoundationMeasurement => ({ ...m, inches: foundationToInches(m.value, m.unit) });
  const measurements = { length: withInches(input.length), width: withInches(input.width), depth: withInches(input.depth) };
  const r = calculateFoundation({ lengthInches: measurements.length.inches, widthInches: measurements.width.inches, depthInches: measurements.depth.inches });
  return {
    ...input.meta,
    id: input.id,
    name: input.name,
    method: input.method,
    measurements,
    wastagePercent: r.wastagePercent,
    results: [
      { label: "Metal", value: `${r.metalFinalCubicFeet} ft³` },
      { label: "Sand", value: `${r.sandFinalCubicFeet} ft³` },
      { label: "Cement", value: `${r.cementFinalCubicFeet} ft³` },
      { label: "Equivalent Cement Bags", value: `${r.cementBags} bags`, note: "1 bag = 1 ft³" },
    ],
    baseResults: [
      { label: "Metal", value: `${r.metalVolumeCubicFeet} ft³` },
      { label: "Sand", value: `${r.sandVolumeCubicFeet} ft³` },
      { label: "Cement", value: `${r.cementVolumeCubicFeet} ft³` },
    ],
    ...(input.plan ? { plan: input.plan } : {}),
  };
}

// Older saved foundations had no wastage; rebuilding from their stored measurements brings them up to date.
export function upgradeFoundation(calc: FoundationCalculation): FoundationCalculation {
  // Rebuilt when saved before wastage was added or before the 1 bag = 1 ft³ basis.
  const current = calc.wastagePercent !== undefined && calc.results?.some(r => r.note === "1 bag = 1 ft³");
  if (current || !calc.measurements?.length || !calc.measurements?.width || !calc.measurements?.depth) return calc;
  const { id, name, method, measurements: m, plan, results, baseResults, ...meta } = calc;
  return buildFoundationCalculation({ id, name, method, length: m.length, width: m.width, depth: m.depth, plan, meta });
}

export { convertToFeet, convertToInches, LENGTH_UNITS, type LengthUnit } from "./units.ts";

// Rounding to 9 decimals stops floating-point drift from unit conversion pushing an exact multiple over the next CEILING step.
const safeCeil = (n: number) => Math.ceil(Number(n.toFixed(9)));

export function calculateBarsForRun(requiredLength: number, stockLength = 19.5, lapLength = 1.5): number {
  if (requiredLength <= stockLength) return 1;
  return 1 + safeCeil((requiredLength - stockLength) / (stockLength - lapLength));
}

export type MemberType = "column" | "beam" | "lintel";
export type MeasuredValue = { value: number; unit: LengthUnit };
export type BarGroupKey = "longitudinal" | "top" | "bottom" | "additional" | "main";
export type StirrupConvention = "both-ends" | "spaces-only";

export const BAR_GROUPS: Record<MemberType, BarGroupKey[]> = {
  column: ["longitudinal"],
  beam: ["top", "bottom", "additional"],
  lintel: ["main"],
};

export type ReinforcementInput = {
  memberType: MemberType;
  calculationName: string;
  linkedConcreteId?: string;
  memberLength: MeasuredValue;
  memberWidth?: MeasuredValue;
  memberDepth?: MeasuredValue;
  memberCount: number;
  mainBarDiameter?: string;
  barGroups: { key: BarGroupKey; count: number }[];
  stockBarLengthFt: number;
  lapLengthFt: number;
  stirrup: {
    size: string;
    spacing: MeasuredValue;
    cutLength: MeasuredValue;
    convention: StirrupConvention;
  } | null;
};

export type ReinforcementResults = {
  memberLengthFt: number;
  effectiveAdditionalLengthFt: number;
  barsPerRun: number;
  lapsPerRun: number;
  purchasedPerRunFt: number;
  lapLengthPerRunFt: number;
  effectivePerRunFt: number;
  excessPerRunFt: number;
  runsPerMember: number;
  totalRuns: number;
  totalStockBars: number;
  totalPurchasedFt: number;
  totalLaps: number;
  totalLapLengthFt: number;
  totalExcessFt: number;
  stirrups: {
    spacingFt: number;
    spacesRatio: number;
    perMember: number;
    total: number;
    cutLengthFt: number;
    totalLengthFt: number;
    stockBars: number;
  } | null;
};

export type ReinforcementCalculation = ReinforcementInput & RecordMeta & { id: string; results: ReinforcementResults };

// Returns a translation key describing the first problem, or null when the input is valid.
export function validateReinforcement(input: ReinforcementInput): string | null {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  const validUnit = (m?: MeasuredValue) => !m || LENGTH_UNITS.includes(m.unit);
  if (![input.memberLength, input.memberWidth, input.memberDepth, input.stirrup?.spacing, input.stirrup?.cutLength].every(validUnit)) return "rebar.err.unit";
  if (!positive(input.memberLength.value)) return "rebar.err.length";
  for (const dim of [input.memberWidth, input.memberDepth]) {
    if (dim && !positive(dim.value)) return "rebar.err.dimension";
  }
  if (!positive(input.stockBarLengthFt)) return "rebar.err.stock";
  if (!Number.isFinite(input.lapLengthFt) || input.lapLengthFt < 0) return "rebar.err.lapNegative";
  if (input.lapLengthFt >= input.stockBarLengthFt) return "rebar.err.lapTooLong";
  if (!Number.isInteger(input.memberCount) || input.memberCount <= 0) return "rebar.err.members";
  if (input.barGroups.some(g => !Number.isInteger(g.count) || g.count < 0)) return "rebar.err.bars";
  if (input.barGroups.reduce((s, g) => s + g.count, 0) <= 0) return "rebar.err.bars";
  if (input.stirrup) {
    if (!input.stirrup.size.trim()) return "rebar.err.stirrupSize";
    if (!positive(input.stirrup.spacing.value)) return "rebar.err.spacing";
    if (!positive(input.stirrup.cutLength.value)) return "rebar.err.cutLength";
  }
  return null;
}

export function calculateReinforcement(input: ReinforcementInput): ReinforcementResults {
  const stock = input.stockBarLengthFt;
  const lap = input.lapLengthFt;
  const memberLengthFt = convertToFeet(input.memberLength.value, input.memberLength.unit);
  const barsPerRun = calculateBarsForRun(memberLengthFt, stock, lap);
  const lapsPerRun = barsPerRun - 1;
  const purchasedPerRunFt = barsPerRun * stock;
  const lapLengthPerRunFt = lapsPerRun * lap;
  const effectivePerRunFt = purchasedPerRunFt - lapLengthPerRunFt;
  const excessPerRunFt = effectivePerRunFt - memberLengthFt;
  const runsPerMember = input.barGroups.reduce((s, g) => s + g.count, 0);
  const totalRuns = runsPerMember * input.memberCount;
  const totalStockBars = barsPerRun * totalRuns;
  const totalLaps = lapsPerRun * totalRuns;

  let stirrups: ReinforcementResults["stirrups"] = null;
  if (input.stirrup) {
    const spacingFt = convertToFeet(input.stirrup.spacing.value, input.stirrup.spacing.unit);
    const cutLengthFt = convertToFeet(input.stirrup.cutLength.value, input.stirrup.cutLength.unit);
    const spacesRatio = memberLengthFt / spacingFt;
    const perMember = safeCeil(spacesRatio) + (input.stirrup.convention === "both-ends" ? 1 : 0);
    const total = perMember * input.memberCount;
    const totalLengthFt = total * cutLengthFt;
    stirrups = { spacingFt, spacesRatio, perMember, total, cutLengthFt, totalLengthFt, stockBars: safeCeil(totalLengthFt / stock) };
  }

  return {
    memberLengthFt,
    effectiveAdditionalLengthFt: stock - lap,
    barsPerRun,
    lapsPerRun,
    purchasedPerRunFt,
    lapLengthPerRunFt,
    effectivePerRunFt,
    excessPerRunFt,
    runsPerMember,
    totalRuns,
    totalStockBars,
    totalPurchasedFt: totalStockBars * stock,
    totalLaps,
    totalLapLengthFt: totalLaps * lap,
    totalExcessFt: excessPerRunFt * totalRuns,
    stirrups,
  };
}

// Converts records saved by the earlier steel / rebar length estimator so they are not lost.
export function migrateLegacySteel(old: any): ReinforcementCalculation {
  const memberType: MemberType = ["column", "beam", "lintel"].includes(old.category) ? old.category : "column";
  const key = BAR_GROUPS[memberType].includes("additional") ? "additional" : BAR_GROUPS[memberType][0];
  const input: ReinforcementInput = {
    memberType,
    calculationName: old.calculationName || "Reinforcement",
    memberLength: { value: Number(old.runLength?.value) || 0, unit: LENGTH_UNITS.includes(old.runLength?.unit) ? old.runLength.unit : "ft" },
    memberCount: Number(old.similarElements) || 1,
    mainBarDiameter: old.barDiameter,
    barGroups: BAR_GROUPS[memberType].map(k => ({ key: k, count: k === key ? Number(old.reinforcementRuns) || 0 : 0 })),
    stockBarLengthFt: Number(old.standardBarLengthFt) || 19.5,
    lapLengthFt: Number(old.lapLengthFt ?? 1.5),
    stirrup: null,
  };
  return { ...input, id: old.id || crypto.randomUUID(), results: calculateReinforcement(input) };
}

export type BrickworkInput = {
  categoryId: string;
  thicknessId?: string;
  wallLength: number;
  wallHeight: number;
  wallCount?: number;
  openingArea?: number;
  wastagePercent?: number;
  wallWidth?: number;
  brickLength?: number;
  brickHeight?: number;
  brickWidth?: number;
  unitName?: string;
  wallWidthNote?: string;
};

export function computeBrickworkBreakdown(values: BrickworkInput) {
  const category = BRICKWORK_CATEGORIES.find(c => c.id === values.categoryId);
  if (!category) return null;

  const wallLength = values.wallLength || 0;
  const wallHeight = values.wallHeight || 0;
  const wallCount = values.wallCount || 1;
  const openingArea = Math.max(0, values.openingArea || 0);
  const wastage = values.wastagePercent || 5;
  const brickLength = values.brickLength || 0.23;
  const brickHeight = values.brickHeight || 0.11;
  const brickWidth = values.brickWidth || 0.11;
  const wallWidth = values.wallWidth || 0.23;

  const grossArea = wallLength * wallHeight * wallCount;
  const netArea = Math.max(0, grossArea - openingArea);
  const effectiveArea = withWaste(netArea, wastage);
  const wallVolume = effectiveArea * wallWidth;
  const brickVolume = brickLength * brickHeight * brickWidth;
  const brickQuantity = Math.ceil(wallVolume / brickVolume);
  const mortarVolume = effectiveArea * 0.02;
  const dryMortarVolume = mortarVolume * 1.33;

  const ratios = category.mortarRatio.split(':').map(Number);
  const totalParts = ratios[0] + ratios[1];
  const cementVolume = mortarVolume * (ratios[0] / totalParts);
  const sandVolume = mortarVolume * (ratios[1] / totalParts);
  // Dry cement volume (× 1.33) in ft³; 1 bag = 1 ft³.
  const cementBags = Math.ceil(Number(cementBagsFromCubicMetres(cementVolume * 1.33).toFixed(9)));

  return {
    category, ratios, totalParts,
    wallLength, wallHeight, wallCount, openingArea, wastage, wallWidth,
    brickLength, brickHeight, brickWidth,
    grossArea, netArea, effectiveArea, wallVolume, brickVolume, brickQuantity,
    mortarVolume, dryMortarVolume, cementVolume, sandVolume, cementBags,
  };
}

export function calculateBrickwork(values: BrickworkInput): QuantityResult[] {
  const b = computeBrickworkBreakdown(values);
  if (!b) return [];
  const unitName = values.unitName || "Bricks";
  const mm = (m: number) => Math.round(m * 1000);

  return [
    { label: "Wall Type", value: b.category.name },
    { label: "Mortar Ratio", value: b.category.mortarRatio, note: `${b.ratios[0]} part cement : ${b.ratios[1]} parts sand` },
    { label: "Wall Width/Thickness", value: `${(b.wallWidth / 0.0254).toFixed(1)}"`, note: values.wallWidthNote ?? "Selected thickness" },
    { label: "Gross Wall Area", value: `${round(b.grossArea)} m²` },
    { label: "Total Opening Area", value: `${round(b.openingArea)} m²` },
    { label: "Net Wall Area", value: `${round(b.netArea)} m²`, note: "Openings deducted" },
    { label: "Unit Size", value: `${mm(b.brickLength)} × ${mm(b.brickWidth)} × ${mm(b.brickHeight)} mm`, note: "Length × Width × Height" },
    { label: `Estimated ${unitName}`, value: `${b.brickQuantity} nos.`, note: "Wall volume ÷ Unit volume" },
    { label: "Mortar (Wet)", value: `${round(b.mortarVolume)} m³` },
    { label: "Mortar (Dry)", value: `${round(b.dryMortarVolume)} m³` },
    { label: "Cement", value: `${b.cementBags} bags`, note: "1 bag = 1 ft³" },
    { label: "Cement Volume", value: `${round(b.cementVolume, 4)} m³` },
    { label: "Sand", value: `${round(b.sandVolume, 4)} m³` },
    { label: "Wastage Included", value: `${b.wastage}%` },
  ];
}

// Plastering mortar mix, Cement : Sand.
export const PLASTERING_MIX = [1, 5] as const;

export function calculateStage(
  stageId: string,
  values: Record<string, number>,
): QuantityResult[] {
  const wastage = values.wastage ?? 5;
  if (stageId === "brickwork") {
    const area = Math.max(0, values.length * values.height - (values.openings || 0));
    const effectiveArea = withWaste(area, wastage);
    return [
      { label: "Wall area", value: `${round(area)} m²`, note: "Openings deducted" },
      { label: "Standard bricks", value: `${Math.ceil(effectiveArea * 60)} bricks`, note: "Assumes 60 bricks per m²" },
      { label: "Mortar", value: `${round(effectiveArea * 0.02)} m³`, note: "Assumes 10 mm mortar joints" },
    ];
  }
  if (stageId === "plastering") {
    // Cement : Sand = 1 : 5, applied to the dry mortar volume (wet volume × 1.33).
    const [cementParts, sandParts] = PLASTERING_MIX;
    const totalParts = cementParts + sandParts;
    const area = Math.max(0, values.length * values.height - (values.openings || 0));
    const volume = withWaste(area * (values.thickness / 1000), wastage);
    const dry = volume * 1.33;
    const cementVolume = dry * (cementParts / totalParts);
    return [
      { label: "Plaster area", value: `${round(area)} m²` },
      { label: "Mortar", value: `${round(volume, 4)} m³`, note: `${round(values.thickness, 2)} mm thickness` },
      { label: "Mix Ratio", value: `${cementParts} : ${sandParts}`, note: "Cement : Sand" },
      { label: "Cement", value: `${Math.ceil(Number(cementBagsFromCubicMetres(cementVolume).toFixed(9)))} bags`, note: "1 bag = 1 ft³" },
      { label: "Cement Volume", value: `${round(cementVolume, 4)} m³` },
      { label: "Sand", value: `${round(dry * (sandParts / totalParts), 4)} m³` },
    ];
  }
  if (stageId === "flooring") {
    const area = values.length * values.width;
    return [
      { label: "Floor area", value: `${round(area)} m²` },
      { label: "Floor finish", value: `${round(withWaste(area, wastage))} m²`, note: "Includes cutting wastage" },
    ];
  }
  return [];
}

const dryVolumeFactor = 1.54;

function calculateMaterials(dryVolume: number, mix: ConcreteMix): Record<string, number> {
  const totalParts = mix.cement + mix.sand + (mix.aggregate || 0);
  const cementFraction = mix.cement / totalParts;
  const sandFraction = mix.sand / totalParts;
  const aggregateFraction = (mix.aggregate || 0) / totalParts;

  const cementVolume = dryVolume * cementFraction;
  const sandVolume = dryVolume * sandFraction;
  const aggregateVolume = dryVolume * aggregateFraction;

  return {
    // Cement m³ → ft³, 1 bag = 1 ft³, rounded up to whole bags.
    cement: Math.ceil(Number(cementBagsFromCubicMetres(cementVolume).toFixed(9))),
    sand: round(sandVolume),
    aggregate: round(aggregateVolume),
  };
}

export function calculateColumns(params: {
  width: number;
  depth: number;
  height: number;
  count: number;
  grade: "grade20" | "grade25";
}): QuantityResult[] {
  const singleVolume = params.width * params.depth * params.height;
  const totalVolume = singleVolume * params.count;
  const dryVolume = totalVolume * dryVolumeFactor;
  const mix = CONCRETE_MIXES[params.grade];
  const materials = calculateMaterials(dryVolume, mix);

  return [
    { label: "Concrete Grade", value: params.grade === "grade20" ? "Grade 20" : "Grade 25" },
    { label: "Mix Ratio", value: `${mix.cement} : ${mix.sand} : ${mix.aggregate}` },
    { label: "Number of Columns", value: `${params.count}` },
    { label: "Wet Concrete Volume", value: `${round(totalVolume)} m³` },
    { label: "Dry Volume", value: `${round(dryVolume)} m³` },
    { label: "Cement", value: `${materials.cement} bags`, note: "1 bag = 1 ft³" },
    { label: "Sand", value: `${materials.sand} m³` },
    { label: "Aggregate", value: `${materials.aggregate} m³` },
  ];
}

export function calculateBeams(params: {
  length: number;
  width: number;
  depth: number;
  count: number;
  grade: "grade20" | "grade25";
  floorLevel: string;
}): QuantityResult[] {
  const singleVolume = params.length * params.width * params.depth;
  const totalVolume = singleVolume * params.count;
  const dryVolume = totalVolume * dryVolumeFactor;
  const mix = CONCRETE_MIXES[params.grade];
  const materials = calculateMaterials(dryVolume, mix);

  return [
    { label: "Concrete Grade", value: params.grade === "grade20" ? "Grade 20" : "Grade 25" },
    { label: "Mix Ratio", value: `${mix.cement} : ${mix.sand} : ${mix.aggregate}` },
    { label: "Floor Level", value: params.floorLevel },
    { label: "Number of Beams", value: `${params.count}` },
    { label: "Wet Concrete Volume", value: `${round(totalVolume)} m³` },
    { label: "Dry Volume", value: `${round(dryVolume)} m³` },
    { label: "Cement", value: `${materials.cement} bags`, note: "1 bag = 1 ft³" },
    { label: "Sand", value: `${materials.sand} m³` },
    { label: "Aggregate", value: `${materials.aggregate} m³` },
  ];
}

export function calculateLintels(params: {
  length: number;
  width: number;
  depth: number;
  count: number;
}): QuantityResult[] {
  const singleVolume = params.length * params.width * params.depth;
  const totalVolume = singleVolume * params.count;
  const dryVolume = totalVolume * dryVolumeFactor;
  const mix = CONCRETE_MIXES.grade20;
  const materials = calculateMaterials(dryVolume, mix);

  return [
    { label: "Concrete Grade", value: "Grade 20" },
    { label: "Mix Ratio", value: `${mix.cement} : ${mix.sand} : ${mix.aggregate}` },
    { label: "Number of Lintels", value: `${params.count}` },
    { label: "Wet Concrete Volume", value: `${round(totalVolume)} m³` },
    { label: "Dry Volume", value: `${round(dryVolume)} m³` },
    { label: "Cement", value: `${materials.cement} bags`, note: "1 bag = 1 ft³" },
    { label: "Sand", value: `${materials.sand} m³` },
    { label: "Aggregate", value: `${materials.aggregate} m³` },
  ];
}

export function calculateSlab(params: {
  length: number;
  width: number;
  thickness: number;
  count: number;
}): QuantityResult[] {
  const singleVolume = params.length * params.width * params.thickness;
  const totalVolume = singleVolume * params.count;
  const dryVolume = totalVolume * dryVolumeFactor;
  const mix = CONCRETE_MIXES.grade20;
  const materials = calculateMaterials(dryVolume, mix);

  return [
    { label: "Concrete Grade", value: "Grade 20" },
    { label: "Mix Ratio", value: `${mix.cement} : ${mix.sand} : ${mix.aggregate}` },
    { label: "Slab Thickness", value: `${params.thickness.toFixed(3)} m` },
    { label: "Wet Concrete Volume", value: `${round(totalVolume)} m³` },
    { label: "Dry Volume", value: `${round(dryVolume)} m³` },
    { label: "Cement", value: `${materials.cement} bags`, note: "1 bag = 1 ft³" },
    { label: "Sand", value: `${materials.sand} m³` },
    { label: "Aggregate", value: `${materials.aggregate} m³` },
  ];
}

export function calculateCementConcretFloor(params: {
  length: number;
  width: number;
}): QuantityResult[] {
  const area = params.length * params.width;
  const concreteThickness = 0.0762; // 3 inches
  const renderingThickness = 0.0127; // 0.5 inches

  const concreteVolume = area * concreteThickness;
  const concreteDryVolume = concreteVolume * dryVolumeFactor;
  const concreteMaterials = calculateMaterials(concreteDryVolume, CONCRETE_MIXES.floorConcrete);

  const renderingVolume = area * renderingThickness;
  const renderingDryVolume = renderingVolume * dryVolumeFactor;
  const renderingMaterials = calculateMaterials(renderingDryVolume, CONCRETE_MIXES.rendering);

  return [
    { label: "Floor Area", value: `${round(area)} m²` },
    { label: "", value: "", note: "" },
    { label: "BASE CONCRETE", value: "" },
    { label: "Mix Ratio", value: "1 : 2.5 : 5" },
    { label: "Wet Volume", value: `${round(concreteVolume)} m³` },
    { label: "Dry Volume", value: `${round(concreteDryVolume)} m³` },
    { label: "Cement", value: `${concreteMaterials.cement} bags`, note: "1 bag = 1 ft³" },
    { label: "Sand", value: `${concreteMaterials.sand} m³` },
    { label: "Aggregate", value: `${concreteMaterials.aggregate} m³` },
    { label: "", value: "", note: "" },
    { label: "SURFACE RENDERING", value: "" },
    { label: "Mix Ratio", value: "1 : 3" },
    { label: "Wet Volume", value: `${round(renderingVolume)} m³` },
    { label: "Dry Volume", value: `${round(renderingDryVolume)} m³` },
    { label: "Cement", value: `${renderingMaterials.cement} bags`, note: "1 bag = 1 ft³" },
    { label: "Sand", value: `${renderingMaterials.sand} m³` },
  ];
}
