// Verifies stock-bar and overlap arithmetic only; it says nothing about whether a reinforcement design is structurally appropriate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateBarsForRun, calculateReinforcement, convertToFeet, validateReinforcement, type ReinforcementInput } from "../src/utils/calculators.ts";

const base = (over: Partial<ReinforcementInput> = {}): ReinforcementInput => ({
  memberType: "column",
  calculationName: "Test column",
  memberLength: { value: 61, unit: "ft" },
  memberCount: 1,
  barGroups: [{ key: "longitudinal", count: 1 }],
  stockBarLengthFt: 19.5,
  lapLengthFt: 1.5,
  stirrup: null,
  ...over,
});

test("61 ft run with 19.5 ft stock and 1.5 ft lap", () => {
  const r = calculateReinforcement(base());
  assert.equal(r.effectiveAdditionalLengthFt, 18);
  assert.equal(r.barsPerRun, 4);
  assert.equal(r.lapsPerRun, 3);
  assert.equal(r.purchasedPerRunFt, 78);
  assert.equal(r.lapLengthPerRunFt, 4.5);
  assert.equal(r.effectivePerRunFt, 73.5);
  assert.equal(r.excessPerRunFt, 12.5);
});

test("run shorter than one stock bar needs one bar and no lap", () => {
  assert.equal(calculateBarsForRun(9, 19.5, 1.5), 1);
  assert.equal(calculateBarsForRun(19.5, 19.5, 1.5), 1);
  assert.equal(calculateBarsForRun(19.6, 19.5, 1.5), 2);
});

test("totals multiply by user-entered bars and members", () => {
  const r = calculateReinforcement(base({ memberCount: 3, barGroups: [{ key: "longitudinal", count: 6 }] }));
  assert.equal(r.totalRuns, 18);
  assert.equal(r.totalStockBars, 72);
  assert.equal(r.totalPurchasedFt, 72 * 19.5);
  assert.equal(r.totalLapLengthFt, 3 * 18 * 1.5);
});

test("equivalent lengths in other units give the same bar count", () => {
  assert.equal(convertToFeet(732, "in"), 61);
  for (const [value, unit] of [[732, "in"], [18.5928, "m"], [1859.28, "cm"], [18592.8, "mm"]] as const) {
    assert.equal(calculateReinforcement(base({ memberLength: { value, unit } })).barsPerRun, 4);
  }
  // 55.5 ft sits exactly on a CEILING boundary; conversion drift must not add a bar.
  assert.equal(calculateBarsForRun(convertToFeet(55.5 / 3.280839895, "m")), 3);
});

test("stirrups use user spacing, cut length and the selected convention", () => {
  const stirrup = { size: "6 mm / 1/4\"", spacing: { value: 6, unit: "in" as const }, cutLength: { value: 3, unit: "ft" as const }, convention: "both-ends" as const };
  const r = calculateReinforcement(base({ memberLength: { value: 10, unit: "ft" }, memberCount: 2, stirrup }));
  assert.equal(r.stirrups?.perMember, 21);
  assert.equal(r.stirrups?.total, 42);
  assert.equal(r.stirrups?.totalLengthFt, 126);
  assert.equal(r.stirrups?.stockBars, 7);
  const spacesOnly = calculateReinforcement(base({ memberLength: { value: 10, unit: "ft" }, stirrup: { ...stirrup, convention: "spaces-only" } }));
  assert.equal(spacesOnly.stirrups?.perMember, 20);
});

test("validation rejects invalid input", () => {
  assert.equal(validateReinforcement(base()), null);
  assert.equal(validateReinforcement(base({ memberLength: { value: NaN, unit: "ft" } })), "rebar.err.length");
  assert.equal(validateReinforcement(base({ memberLength: { value: Infinity, unit: "ft" } })), "rebar.err.length");
  assert.equal(validateReinforcement(base({ lapLengthFt: 19.5 })), "rebar.err.lapTooLong");
  assert.equal(validateReinforcement(base({ lapLengthFt: -1 })), "rebar.err.lapNegative");
  assert.equal(validateReinforcement(base({ barGroups: [{ key: "longitudinal", count: 0 }] })), "rebar.err.bars");
  assert.equal(validateReinforcement(base({ memberCount: 0 })), "rebar.err.members");
  assert.equal(validateReinforcement(base({ memberLength: { value: 5, unit: "yd" as any } })), "rebar.err.unit");
});
