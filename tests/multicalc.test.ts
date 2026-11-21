import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFoundationCalculation } from "../src/utils/calculators.ts";
import { defaultCalcName, duplicateById, migrateProject, padIndex, parseQuantity, removeById, sumQuantities, upsertById } from "../src/utils/multiCalc.ts";

type Item = { id: string; name: string };
const items: Item[] = [{ id: "a", name: "Brick Wall 01" }, { id: "b", name: "Brick Wall 02" }];

test("saving a new calculation keeps every earlier one", () => {
  const next = upsertById(items, { id: "c", name: "Cement Block Wall 03" });
  assert.deepEqual(next.map(i => i.id), ["a", "b", "c"]);
});

test("saving an edited calculation replaces only that entry", () => {
  const next = upsertById(items, { id: "a", name: "Edited" });
  assert.deepEqual(next.map(i => i.name), ["Edited", "Brick Wall 02"]);
});

test("duplicate inserts a renamed copy with a new id after the original", () => {
  const next = duplicateById(items, "a", i => ({ ...i, name: `${i.name} (copy)` }));
  assert.equal(next.length, 3);
  assert.equal(next[0].name, "Brick Wall 01");
  assert.equal(next[1].name, "Brick Wall 01 (copy)");
  assert.notEqual(next[1].id, "a");
  assert.equal(next[2].id, "b");
  assert.equal(duplicateById(items, "missing", i => i), items);
});

test("delete removes only the chosen calculation", () => {
  assert.deepEqual(removeById(items, "a").map(i => i.id), ["b"]);
});

test("numbering helpers", () => {
  assert.equal(padIndex(0), "01");
  assert.equal(padIndex(11), "12");
  assert.equal(defaultCalcName("Column", 0), "Column 01");
  assert.equal(defaultCalcName("Column", 2), "Column 03");
});

test("parseQuantity reads amount and unit", () => {
  assert.deepEqual(parseQuantity("19.5 ft³"), { amount: 19.5, unit: "ft³" });
  assert.deepEqual(parseQuantity("1,250 nos."), { amount: 1250, unit: "nos." });
  assert.deepEqual(parseQuantity("12 bags"), { amount: 12, unit: "bags" });
  assert.equal(parseQuantity("Grade 20"), null);
});

test("sumQuantities adds matching labels across calculations", () => {
  const a = [{ label: "Cement", value: "10 bags" }, { label: "Sand", value: "0.5 m³" }, { label: "Mix Ratio", value: "1 : 2 : 4" }];
  const b = [{ label: "Cement", value: "5 bags" }, { label: "Sand", value: "0.25 m³" }];
  assert.deepEqual(sumQuantities([a, b], ["Cement", "Sand"]), [{ label: "Cement", value: "15 bags" }, { label: "Sand", value: "0.75 m³" }]);
});

test("sumQuantities keeps different units and different labels apart", () => {
  const rows = sumQuantities(
    [[{ label: "Estimated Bricks", value: "100 nos." }], [{ label: "Estimated Cement Blocks", value: "40 nos." }], [{ label: "Estimated Bricks", value: "50 nos." }]],
    ["Estimated Bricks", "Estimated Cement Blocks"],
  );
  assert.deepEqual(rows, [{ label: "Estimated Bricks", value: "150 nos." }, { label: "Estimated Cement Blocks", value: "40 nos." }]);
  assert.equal(sumQuantities([[{ label: "Cement", value: "1 bags" }, { label: "Cement", value: "2 m³" }]], ["Cement"]).length, 2);
});

test("foundation calculation matches the worked 180 ft x 13 in x 2 ft example, plus 5% wastage", () => {
  const calc = buildFoundationCalculation({ id: "f1", name: "Main", method: "manual", length: { value: 180, unit: "ft" }, width: { value: 13, unit: "in" }, depth: { value: 2, unit: "ft" } });
  // Base 5 : 40 : 100 quantities are unchanged; wastage is applied afterwards.
  assert.deepEqual(calc.baseResults, [{ label: "Metal", value: "390 ft³" }, { label: "Sand", value: "156 ft³" }, { label: "Cement", value: "19.5 ft³" }]);
  assert.deepEqual(calc.results.slice(0, 3), [{ label: "Metal", value: "409.5 ft³" }, { label: "Sand", value: "163.8 ft³" }, { label: "Cement", value: "20.475 ft³" }]);
  // 1 cement bag = 1 ft³, so the bag count equals the final cement volume in ft³.
  assert.deepEqual(calc.results[3], { label: "Equivalent Cement Bags", value: `${Number((20.475).toFixed(2))} bags`, note: "1 bag = 1 ft³" });
  assert.equal(calc.wastagePercent, 5);
  assert.equal(calc.measurements.length.inches, 2160);
});

test("foundation totals across several calculations include wastage", () => {
  const a = buildFoundationCalculation({ id: "1", name: "A", method: "manual", length: { value: 180, unit: "ft" }, width: { value: 13, unit: "in" }, depth: { value: 2, unit: "ft" } });
  const b = buildFoundationCalculation({ id: "2", name: "B", method: "manual", length: { value: 42, unit: "ft" }, width: { value: 9, unit: "in" }, depth: { value: 18, unit: "in" } });
  const totals = sumQuantities([a.results, b.results], ["Metal", "Sand", "Cement"]);
  assert.equal(totals[0].value, `${Number(((390 + 42 * 12 * 9 * 18 / 1728) * 1.05).toFixed(3))} ft³`);
});

test("migrateProject turns the old single foundation into a list entry", () => {
  const legacy = {
    name: "p",
    calculations: {
      foundation: { measurements: { length: { value: 10, unit: "ft", inches: 120 }, width: { value: 9, unit: "in", inches: 9 }, depth: { value: 1, unit: "ft", inches: 12 } }, results: [{ label: "Metal", value: "7.5 ft³" }] },
      other: [1],
    },
  };
  const migrated = migrateProject(legacy) as any;
  assert.equal(migrated.foundationCalculations.length, 1);
  assert.equal(migrated.foundationCalculations[0].method, "manual");
  assert.equal(migrated.calculations.foundation, undefined);
  assert.deepEqual(migrated.calculations.other, [1]);
  assert.equal((migrateProject(migrated) as any).foundationCalculations.length, 1);
});
