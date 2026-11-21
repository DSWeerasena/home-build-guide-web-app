import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../src/utils/loadProject.ts";
import { BRICKWORK_CATEGORIES, calculateBrickwork, calculateColumns, calculateStage, openingAreaSquareMetres, totalOpeningAreaSquareMetres, upgradeFoundation, type WallOpening } from "../src/utils/calculators.ts";
import { cementBagsFromCubicFeet, cementBagsFromCubicMetres, convertVolume, displayVolume, parseVolume } from "../src/utils/quantities.ts";
import { convertFromInches, convertToInches, toLengthUnit } from "../src/utils/units.ts";
import { completionBlocker, normalizeCompletion } from "../src/utils/progress.ts";
import { migrateProject, stampRecord, toggleWorkStatus, upgradeBrickworkOpenings } from "../src/utils/multiCalc.ts";
import { getCategoryConfig, runCategory } from "../src/utils/cementCategories.ts";

const close = (actual: number, expected: number, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected}`);

test("1 cube = 100 ft³ and conversions go through cubic feet", () => {
  assert.equal(convertVolume(1, "cube", "ft3"), 100);
  assert.equal(convertVolume(250, "ft3", "cube"), 2.5);
  close(convertVolume(1, "m3", "ft3"), 35.3146667214886);
  assert.equal(convertVolume(1, "ft3", "in3"), 1728);
});

test("display unit changes only how a stored volume is shown", () => {
  assert.equal(displayVolume("390 ft³", "cube"), "3.90 Cubes");
  assert.equal(displayVolume("390 ft³", "ft3"), "390.00 ft³");
  assert.equal(displayVolume("1 m³", "ft3"), "35.31 ft³");
  assert.equal(displayVolume("12 bags", "cube"), "12 bags");
  assert.equal(displayVolume("1:5", "cube"), "1:5");
  assert.deepEqual(parseVolume("2 Cubes"), { cubicFeet: 200 });
});

test("shared length conversion: every unit to inches and back", () => {
  assert.equal(convertToInches(2, "ft"), 24);
  close(convertToInches(1, "m"), 39.37007874);
  close(convertToInches(254, "mm"), 10);
  close(convertFromInches(convertToInches(3.3, "cm"), "cm"), 3.3);
  assert.equal(toLengthUnit("inches"), "in");
  assert.equal(toLengthUnit("foot"), "ft");
  assert.equal(toLengthUnit("yards"), null);
});

test("older foundations without wastage are recalculated with 5%", () => {
  const old = { id: "f", name: "Old", method: "manual", measurements: { length: { value: 180, unit: "ft", inches: 2160 }, width: { value: 13, unit: "in", inches: 13 }, depth: { value: 2, unit: "ft", inches: 24 } }, results: [{ label: "Metal", value: "390 ft³" }], workStatus: "completed" } as any;
  const upgraded = upgradeFoundation(old);
  assert.equal(upgraded.results[0].value, "409.5 ft³");
  assert.equal(upgraded.workStatus, "completed");
  assert.equal(upgradeFoundation(upgraded), upgraded);
});

test("the 13.5 inch thickness option no longer exists", () => {
  const all = BRICKWORK_CATEGORIES.flatMap(c => c.thicknesses.map(t => t.inches));
  assert.ok(!all.includes("13.5"));
});

test("multiple openings are added up in their own units and deducted from the wall", () => {
  const openings: WallOpening[] = [
    { id: "1", type: "door", width: 3, height: 7, unit: "ft" },
    { id: "2", type: "window", width: 1200, height: 1000, unit: "mm" },
  ];
  close(openingAreaSquareMetres(openings[0]), 21 * 0.09290304);
  close(totalOpeningAreaSquareMetres(openings), 21 * 0.09290304 + 1.2);
  const results = calculateBrickwork({ categoryId: "standard-brick-1-5", wallLength: 10, wallHeight: 3, wallCount: 1, openingArea: totalOpeningAreaSquareMetres(openings), wastagePercent: 5, wallWidth: 0.2286, brickLength: 0.205, brickWidth: 0.095, brickHeight: 0.075 });
  const value = (label: string) => results.find(r => r.label === label)?.value;
  assert.equal(value("Gross Wall Area"), "30 m²");
  assert.equal(value("Net Wall Area"), `${Number((30 - totalOpeningAreaSquareMetres(openings)).toFixed(2))} m²`);
});

test("older brickwork with one opening area becomes one opening of the same area", () => {
  const legacy = { id: "b", name: "Wall", categoryId: "standard-brick-1-5", thicknessId: "9in", wallLength: 10, wallHeight: 3, wallCount: 1, openingArea: 4, wastagePercent: 5, units: { wallLength: "m", wallHeight: "m", openingArea: "m²" } } as any;
  const upgraded = upgradeBrickworkOpenings(legacy);
  assert.equal(upgraded.openings?.length, 1);
  close(totalOpeningAreaSquareMetres(upgraded.openings), 4);
  assert.deepEqual(upgradeBrickworkOpenings({ ...legacy, openingArea: 0 }).openings, []);
});

test("plastering uses Cement : Sand = 1 : 5", () => {
  const results = calculateStage("plastering", { length: 10, height: 3, openings: 0, thickness: 12, wastage: 0 });
  const value = (label: string) => results.find(r => r.label === label)?.value;
  assert.equal(value("Mix Ratio"), "1 : 5");
  const dry = 30 * 0.012 * 1.33;
  assert.equal(value("Cement Volume"), `${Number((dry / 6).toFixed(4))} m³`);
  assert.equal(value("Sand"), `${Number((dry * 5 / 6).toFixed(4))} m³`);
  // 1 bag = 1 ft³: cement m³ → ft³, rounded up to whole bags.
  assert.equal(value("Cement"), `${Math.ceil((dry / 6) * 35.3146667214886)} bags`);
});

test("1 cement bag = 1 ft³", () => {
  assert.equal(cementBagsFromCubicFeet(20.475), 20.475);
  close(cementBagsFromCubicMetres(1), 35.3146667214886);
  const results = calculateBrickwork({ categoryId: "standard-brick-1-5", wallLength: 10, wallHeight: 3, wallCount: 1, openingArea: 0, wastagePercent: 5, wallWidth: 0.2286, brickLength: 0.205, brickWidth: 0.095, brickHeight: 0.075 });
  const cement = results.find(r => r.label === "Cement");
  assert.equal(cement?.note, "1 bag = 1 ft³");
  // Brickwork: dry cement volume (cement share × 1.33) in ft³, rounded up.
  const mortar = 30 * 1.05 * 0.02;
  assert.equal(cement?.value, `${Math.ceil((mortar / 6) * 1.33 * 35.3146667214886)} bags`);
});

test("concrete categories use 1 bag = 1 ft³", () => {
  const results = calculateColumns({ width: 0.3, depth: 0.3, height: 3, count: 1, grade: "grade20" });
  const cement = results.find(r => r.label === "Cement");
  // Wet 0.27 m³ × 1.54 dry factor × 1/7 cement share, in ft³, rounded up.
  assert.equal(cement?.value, `${Math.ceil(0.27 * 1.54 / 7 * 35.3146667214886)} bags`);
  assert.equal(cement?.note, "1 bag = 1 ft³");
});

test("saved brickwork and cement records with the old bag basis are recalculated on load", () => {
  const column = runCategory(getCategoryConfig("column")!, { grade: "grade20", floor: "ground", width: 300, depth: 300, height: 3, count: 1 }, { width: "mm", depth: "mm", height: "m" });
  assert.ok("output" in column);
  const oldResults = [{ label: "Cement", value: "3 bags", note: "50 kg bags" }];
  const saved = {
    name: "p", completed: [], checklists: {}, calculations: {},
    cementWorksCalculations: [{ id: "c", name: "C", category: "column", results: oldResults, inputs: { values: { grade: "grade20", floor: "ground", width: 300, depth: 300, height: 3, count: 1 }, units: { width: "mm", depth: "mm", height: "m" } } }],
    brickworkCalculations: [{ id: "b", name: "B", categoryId: "standard-brick-1-5", thicknessId: "9in", wallLength: 10, wallHeight: 3, wallCount: 1, openingArea: 0, openings: [], wastagePercent: 5, wallType: "brick", units: { wallLength: "m", wallHeight: "m", openingArea: "m²" }, results: oldResults }],
  };
  const loaded = loadProject(saved) as any;
  if ("output" in column) assert.deepEqual(loaded.cementWorksCalculations[0].results, column.output.results);
  assert.equal(loaded.brickworkCalculations[0].results.find((r: any) => r.label === "Cement").note, "1 bag = 1 ft³");
  // Already up to date: nothing is rebuilt.
  assert.equal(loadProject(loaded).cementWorksCalculations, loaded.cementWorksCalculations);
});

test("foundations saved with the old bag basis are refreshed on load", () => {
  const saved = { id: "f", name: "F", method: "manual", wastagePercent: 5, measurements: { length: { value: 180, unit: "ft", inches: 2160 }, width: { value: 13, unit: "in", inches: 13 }, depth: { value: 2, unit: "ft", inches: 24 } }, results: [{ label: "Equivalent Cement Bags", value: "16.7 bags", note: "50 kg bags" }] } as any;
  assert.equal(upgradeFoundation(saved).results[3].note, "1 bag = 1 ft³");
});

test("plastering accepts thickness and openings in any unit", () => {
  const config = getCategoryConfig("plastering")!;
  const inMm = runCategory(config, { length: 10, height: 3, openings: 2, thickness: 12, wastage: 5 }, { length: "m", height: "m", openings: "m²", thickness: "mm" });
  const inCm = runCategory(config, { length: 1000, height: 300, openings: 20000, thickness: 1.2, wastage: 5 }, { length: "cm", height: "cm", openings: "cm²", thickness: "cm" });
  assert.ok("output" in inMm && "output" in inCm);
  if ("output" in inMm && "output" in inCm) {
    assert.deepEqual(inCm.output.results, inMm.output.results);
    assert.equal(inMm.output.save.mixRatio, "1:5");
  }
  const tooMuch = runCategory(config, { length: 1, height: 1, openings: 20, thickness: 12, wastage: 5 }, { length: "m", height: "m", openings: "ft²", thickness: "mm" });
  assert.ok("error" in tooMuch);
});

const project = (over: Record<string, any> = {}) => ({
  completed: ["foundation"], checklists: { foundation: [true, true, true, true] },
  foundationCalculations: [{ id: "f1", workStatus: "completed" }], ...over,
});

test("a stage stays completed only while its checklist and records allow it", () => {
  assert.equal(completionBlocker(project(), "foundation"), null);
  assert.equal(normalizeCompletion(project()).completed.includes("foundation"), true);
  // Unticking a checklist item removes the completed state immediately.
  assert.deepEqual(normalizeCompletion(project({ checklists: { foundation: [true, false, true, true] } })).completed, []);
  // Changing the record back to ongoing removes it too.
  assert.deepEqual(normalizeCompletion(project({ foundationCalculations: [{ id: "f1", workStatus: "ongoing" }] })).completed, []);
  // Deleting the last record removes it too.
  assert.deepEqual(normalizeCompletion(project({ foundationCalculations: [] })).completed, []);
  assert.equal(completionBlocker(project({ foundationCalculations: [] }), "foundation"), "noRecords");
});

test("cement works is completed exactly when all of its sub-stages are", () => {
  const subs = ["columns-beams-lintel", "plastering", "flooring", "slab", "stair-case"];
  const checklists = Object.fromEntries(subs.map(s => [s, [true, true, true, true]]));
  const cementWorksCalculations = ["column", "plastering", "flooring", "slab", "staircase"].map(category => ({ id: category, category, workStatus: "completed" }));
  const done = normalizeCompletion({ completed: subs, checklists, cementWorksCalculations } as any);
  assert.ok(done.completed.includes("cement-works"));
  const reopened = normalizeCompletion({ ...done, cementWorksCalculations: cementWorksCalculations.map(c => c.category === "slab" ? { ...c, workStatus: "ongoing" } : c) });
  assert.ok(!reopened.completed.includes("cement-works"));
  assert.ok(!reopened.completed.includes("slab"));
});

test("loading a saved project drops stale completion", () => {
  const saved = { name: "p", completed: ["foundation", "brickwork"], checklists: {}, calculations: {}, foundationCalculations: [], brickworkCalculations: [] };
  assert.deepEqual((migrateProject(saved) as any).completed, []);
});

test("work status toggles and edits keep the original creation time", () => {
  const list = [{ id: "a", workStatus: "ongoing" as const }, { id: "b" }];
  const toggled = toggleWorkStatus(list, "a");
  assert.equal(toggled[0].workStatus, "completed");
  assert.equal(toggleWorkStatus(toggled, "a")[0].workStatus, "ongoing");
  assert.equal(toggled[1], list[1]);
  const edited = stampRecord({ id: "a", createdAt: "x" }, { createdAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(edited.createdAt, "2026-01-01T00:00:00.000Z");
  assert.ok(edited.updatedAt);
});
