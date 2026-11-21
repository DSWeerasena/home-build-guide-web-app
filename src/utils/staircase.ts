// Geometry-based concrete quantity estimation for staircases.
// It only converts the measurements the user enters and applies the formulas below;
// it never chooses tread size, riser height, stair width, waist slab thickness,
// landing dimensions or reinforcement. Those come from the user's approved plan.
import type { QuantityResult } from "./calculators.ts";
import { convertToFeet, LENGTH_UNITS, type LengthUnit } from "./units.ts";

export type StairMeasure = { value: number; unit: LengthUnit };

// Every geometry formula is declared in feet, exactly as the calculator documents.
export type StaircaseGeometryInput = {
  numberOfTreads: number;
  numberOfRisers: number;
  treadDepthFt: number;
  riserHeightFt: number;
  stairWidthFt: number;
  waistThicknessFt: number;
  landingLengthFt: number;
  landingWidthFt: number;
  landingThicknessFt: number;
  numberOfLandings: number;
};

export type StaircaseResults = {
  horizontalRunFt: number;
  verticalRiseFt: number;
  slopeLengthFt: number;
  waistSlabVolumeFt3: number;
  stepVolumeFt3: number;
  landingVolumeFt3: number;
  totalConcreteFt3: number;
};

export const CUBIC_FEET_PER_CUBIC_METRE = 35.3146667214886;
export const cubicFeetToCubicMetres = (cubicFeet: number) => cubicFeet / CUBIC_FEET_PER_CUBIC_METRE;

// Keeps full precision internally; rounding happens only for display.
export function calculateStaircase(input: StaircaseGeometryInput): StaircaseResults {
  const horizontalRunFt = input.numberOfTreads * input.treadDepthFt;
  const verticalRiseFt = input.numberOfRisers * input.riserHeightFt;
  const slopeLengthFt = Math.sqrt(horizontalRunFt ** 2 + verticalRiseFt ** 2);
  const waistSlabVolumeFt3 = slopeLengthFt * input.stairWidthFt * input.waistThicknessFt;
  const stepVolumeFt3 = 0.5 * input.treadDepthFt * input.riserHeightFt * input.stairWidthFt * input.numberOfTreads;
  const landingVolumeFt3 = input.landingLengthFt * input.landingWidthFt * input.landingThicknessFt * input.numberOfLandings;

  return {
    horizontalRunFt,
    verticalRiseFt,
    slopeLengthFt,
    waistSlabVolumeFt3,
    stepVolumeFt3,
    landingVolumeFt3,
    totalConcreteFt3: waistSlabVolumeFt3 + stepVolumeFt3 + landingVolumeFt3,
  };
}

// A stored dimension keeps the user's own value + unit and the converted feet value.
export type StairDimension = StairMeasure & { feet: number };

export type StaircaseLandingInput = {
  length: StairMeasure;
  width: StairMeasure;
  thickness: StairMeasure;
  count: number;
};

export type StaircaseBuildInput = {
  id: string;
  name: string;
  numberOfTreads: number;
  numberOfRisers: number;
  treadDepth: StairMeasure;
  riserHeight: StairMeasure;
  stairWidth: StairMeasure;
  waistThickness: StairMeasure;
  landing: StaircaseLandingInput | null;
};

export type StaircaseLanding = {
  length: StairDimension;
  width: StairDimension;
  thickness: StairDimension;
  count: number;
};

export type StaircaseCalculation = {
  id: string;
  name: string;
  numberOfTreads: number;
  numberOfRisers: number;
  treadDepth: StairDimension;
  riserHeight: StairDimension;
  stairWidth: StairDimension;
  waistThickness: StairDimension;
  landing: StaircaseLanding | null;
  results: StaircaseResults;
};

const toDimension = (measure: StairMeasure): StairDimension => ({ ...measure, feet: convertToFeet(measure.value, measure.unit) });

export function buildStaircaseCalculation(input: StaircaseBuildInput): StaircaseCalculation {
  const treadDepth = toDimension(input.treadDepth);
  const riserHeight = toDimension(input.riserHeight);
  const stairWidth = toDimension(input.stairWidth);
  const waistThickness = toDimension(input.waistThickness);
  const landing: StaircaseLanding | null = input.landing
    ? { length: toDimension(input.landing.length), width: toDimension(input.landing.width), thickness: toDimension(input.landing.thickness), count: input.landing.count }
    : null;

  const results = calculateStaircase({
    numberOfTreads: input.numberOfTreads,
    numberOfRisers: input.numberOfRisers,
    treadDepthFt: treadDepth.feet,
    riserHeightFt: riserHeight.feet,
    stairWidthFt: stairWidth.feet,
    waistThicknessFt: waistThickness.feet,
    landingLengthFt: landing?.length.feet ?? 0,
    landingWidthFt: landing?.width.feet ?? 0,
    landingThicknessFt: landing?.thickness.feet ?? 0,
    numberOfLandings: landing?.count ?? 0,
  });

  return {
    id: input.id,
    name: input.name,
    numberOfTreads: input.numberOfTreads,
    numberOfRisers: input.numberOfRisers,
    treadDepth,
    riserHeight,
    stairWidth,
    waistThickness,
    landing,
    results,
  };
}

const isPositive = (n: number) => Number.isFinite(n) && n > 0;
const isWholePositive = (n: number) => Number.isInteger(n) && n > 0;
const hasKnownUnit = (measure: StairMeasure) => LENGTH_UNITS.includes(measure.unit);

// Returns an i18n key naming the first problem, or null when the input is valid.
export function validateStaircase(input: StaircaseBuildInput): string | null {
  const all: StairMeasure[] = [input.treadDepth, input.riserHeight, input.stairWidth, input.waistThickness];
  if (input.landing) all.push(input.landing.length, input.landing.width, input.landing.thickness);
  if (!all.every(hasKnownUnit)) return "stair.err.unit";

  if (![input.treadDepth, input.riserHeight, input.stairWidth, input.waistThickness].every(m => isPositive(m.value))) return "stair.err.measure";
  if (!isWholePositive(input.numberOfTreads) || !isWholePositive(input.numberOfRisers)) return "stair.err.count";

  if (input.landing) {
    if (![input.landing.length, input.landing.width, input.landing.thickness].every(m => isPositive(m.value))) return "stair.err.measure";
    if (!isWholePositive(input.landing.count)) return "stair.err.count";
  }
  return null;
}

// ---- Form handling -------------------------------------------------------------------
// The form keeps every value as text so an empty field is never silently read as zero.
export type StairRawMeasure = { value: string; unit: string };

export type StaircaseFormState = {
  name: string;
  numberOfTreads: string;
  numberOfRisers: string;
  treadDepth: StairRawMeasure;
  riserHeight: StairRawMeasure;
  stairWidth: StairRawMeasure;
  waistThickness: StairRawMeasure;
  hasLanding: boolean;
  landingLength: StairRawMeasure;
  landingWidth: StairRawMeasure;
  landingThickness: StairRawMeasure;
  numberOfLandings: string;
};

const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
const toMeasure = (raw: StairRawMeasure): StairMeasure => ({ value: toNumber(raw.value), unit: raw.unit as LengthUnit });

export const STAIRCASE_DEFAULT_FORM: StaircaseFormState = {
  name: "",
  numberOfTreads: "10",
  numberOfRisers: "11",
  treadDepth: { value: "10", unit: "in" },
  riserHeight: { value: "7", unit: "in" },
  stairWidth: { value: "3.5", unit: "ft" },
  waistThickness: { value: "6", unit: "in" },
  hasLanding: false,
  landingLength: { value: "4", unit: "ft" },
  landingWidth: { value: "3.5", unit: "ft" },
  landingThickness: { value: "6", unit: "in" },
  numberOfLandings: "1",
};

export function staircaseMeasureInput(form: StaircaseFormState, id: string, name: string): StaircaseBuildInput {
  return {
    id,
    name,
    numberOfTreads: toNumber(form.numberOfTreads),
    numberOfRisers: toNumber(form.numberOfRisers),
    treadDepth: toMeasure(form.treadDepth),
    riserHeight: toMeasure(form.riserHeight),
    stairWidth: toMeasure(form.stairWidth),
    waistThickness: toMeasure(form.waistThickness),
    landing: form.hasLanding
      ? {
        length: toMeasure(form.landingLength),
        width: toMeasure(form.landingWidth),
        thickness: toMeasure(form.landingThickness),
        count: toNumber(form.numberOfLandings),
      }
      : null,
  };
}

export function buildStaircaseFromForm(form: StaircaseFormState, id: string, name: string): { calc: StaircaseCalculation } | { error: string } {
  const input = staircaseMeasureInput(form, id, name);
  const error = validateStaircase(input);
  return error ? { error } : { calc: buildStaircaseCalculation(input) };
}

export function staircaseFormOf(calc: StaircaseCalculation): StaircaseFormState {
  const asRaw = (dimension: StairDimension): StairRawMeasure => ({ value: String(dimension.value), unit: dimension.unit });
  return {
    name: calc.name,
    numberOfTreads: String(calc.numberOfTreads),
    numberOfRisers: String(calc.numberOfRisers),
    treadDepth: asRaw(calc.treadDepth),
    riserHeight: asRaw(calc.riserHeight),
    stairWidth: asRaw(calc.stairWidth),
    waistThickness: asRaw(calc.waistThickness),
    hasLanding: calc.landing !== null,
    landingLength: calc.landing ? asRaw(calc.landing.length) : STAIRCASE_DEFAULT_FORM.landingLength,
    landingWidth: calc.landing ? asRaw(calc.landing.width) : STAIRCASE_DEFAULT_FORM.landingWidth,
    landingThickness: calc.landing ? asRaw(calc.landing.thickness) : STAIRCASE_DEFAULT_FORM.landingThickness,
    numberOfLandings: calc.landing ? String(calc.landing.count) : STAIRCASE_DEFAULT_FORM.numberOfLandings,
  };
}

// ---- Display helpers -----------------------------------------------------------------
export const round2 = (n: number) => Number(n.toFixed(2));
export const round3 = (n: number) => Number(n.toFixed(3));

// Result labels double as the identity keys used to combine saved calculations.
export const STAIRCASE_TOTAL_LABELS = ["Waist Slab", "Steps", "Landings", "Total Concrete"] as const;

export function staircaseResultRows(calc: StaircaseCalculation): QuantityResult[] {
  const r = calc.results;
  return [
    { label: "Waist Slab", value: `${round2(r.waistSlabVolumeFt3)} ft³` },
    { label: "Steps", value: `${round2(r.stepVolumeFt3)} ft³` },
    { label: "Landings", value: `${round2(r.landingVolumeFt3)} ft³` },
    { label: "Total Concrete", value: `${round2(r.totalConcreteFt3)} ft³` },
  ];
}

export const formatFeet = (feet: number) => `${round3(feet)} ft`;
export const formatCubicFeet = (cubicFeet: number) => `${round2(cubicFeet)} ft³`;
