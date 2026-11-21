// Verifies the staircase geometry and volume arithmetic only, not structural suitability.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStaircaseCalculation, buildStaircaseFromForm, calculateStaircase, staircaseFormOf, STAIRCASE_DEFAULT_FORM, validateStaircase, type StaircaseBuildInput } from "../src/utils/staircase.ts";
import { convertToFeet, convertToInches } from "../src/utils/units.ts";

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

const base = (over: Partial<StaircaseBuildInput> = {}): StaircaseBuildInput => ({
  id: "s1",
  name: "Main Staircase",
  numberOfTreads: 10,
  numberOfRisers: 11,
  treadDepth: { value: 10, unit: "in" },
  riserHeight: { value: 7, unit: "in" },
  stairWidth: { value: 3.5, unit: "ft" },
  waistThickness: { value: 6, unit: "in" },
  landing: null,
  ...over,
});

test("example staircase: 10 treads of 10 in, 11 risers of 7 in, 3.5 ft wide, 6 in waist", () => {
  const r = buildStaircaseCalculation(base()).results;
  close(r.horizontalRunFt, 10 * (10 / 12));
  close(r.verticalRiseFt, 11 * (7 / 12));
  close(r.slopeLengthFt, Math.sqrt((100 / 12) ** 2 + (77 / 12) ** 2));
  close(r.waistSlabVolumeFt3, r.slopeLengthFt * 3.5 * 0.5);
  close(r.stepVolumeFt3, 0.5 * (10 / 12) * (7 / 12) * 3.5 * 10);
  close(r.landingVolumeFt3, 0);
  close(r.totalConcreteFt3, r.waistSlabVolumeFt3 + r.stepVolumeFt3);
  assert.equal(Number(r.totalConcreteFt3.toFixed(2)), 26.91);
});

test("landing volume = length × width × thickness × number of landings", () => {
  const landing = { length: { value: 4, unit: "ft" as const }, width: { value: 3.5, unit: "ft" as const }, thickness: { value: 6, unit: "in" as const }, count: 2 };
  const r = buildStaircaseCalculation(base({ landing })).results;
  close(r.landingVolumeFt3, 4 * 3.5 * 0.5 * 2);
});

test("mixed units give the same result as the same sizes in feet", () => {
  const mixed = buildStaircaseCalculation(base({ treadDepth: { value: 254, unit: "mm" }, stairWidth: { value: 1.0668, unit: "m" }, waistThickness: { value: 15.24, unit: "cm" } }));
  const feet = calculateStaircase({ numberOfTreads: 10, numberOfRisers: 11, treadDepthFt: 254 * 0.003280839895, riserHeightFt: 7 / 12, stairWidthFt: 1.0668 * 3.280839895, waistThicknessFt: 15.24 * 0.03280839895, landingLengthFt: 0, landingWidthFt: 0, landingThicknessFt: 0, numberOfLandings: 0 });
  close(mixed.results.totalConcreteFt3, feet.totalConcreteFt3, 1e-9);
  close(mixed.treadDepth.feet, 0.8333333, 1e-6);
  assert.equal(mixed.treadDepth.value, 254);
  assert.equal(mixed.treadDepth.unit, "mm");
});

test("shared unit utility converts consistently", () => {
  assert.equal(convertToInches(180, "ft"), 2160);
  close(convertToFeet(250, "mm"), 0.82020997, 1e-8);
  close(convertToFeet(1.2, "m"), 3.937007874, 1e-9);
  assert.throws(() => convertToFeet(1, "yd" as any), /Unsupported/);
});

test("validation rejects bad input", () => {
  assert.equal(validateStaircase(base()), null);
  assert.equal(validateStaircase(base({ numberOfTreads: 10.5 })), "stair.err.count");
  assert.equal(validateStaircase(base({ numberOfRisers: 0 })), "stair.err.count");
  assert.equal(validateStaircase(base({ treadDepth: { value: -1, unit: "in" } })), "stair.err.measure");
  assert.equal(validateStaircase(base({ riserHeight: { value: Number.NaN, unit: "in" } })), "stair.err.measure");
  assert.equal(validateStaircase(base({ stairWidth: { value: Infinity, unit: "ft" } })), "stair.err.measure");
  assert.equal(validateStaircase(base({ waistThickness: { value: 6, unit: "yd" as any } })), "stair.err.unit");
  const landing = { length: { value: 4, unit: "ft" as const }, width: { value: 3, unit: "ft" as const }, thickness: { value: 6, unit: "in" as const }, count: 1.3 };
  assert.equal(validateStaircase(base({ landing })), "stair.err.count");
});

test("an empty field is an error, never silently zero", () => {
  const run = buildStaircaseFromForm({ ...STAIRCASE_DEFAULT_FORM, riserHeight: { value: "", unit: "in" } }, "s1", "x");
  assert.ok("error" in run && run.error === "stair.err.measure");
});

test("editing reopens with the original values and units", () => {
  const calc = buildStaircaseCalculation(base({ treadDepth: { value: 250, unit: "mm" } }));
  const form = staircaseFormOf(calc);
  assert.deepEqual(form.treadDepth, { value: "250", unit: "mm" });
  assert.equal(form.hasLanding, false);
});
