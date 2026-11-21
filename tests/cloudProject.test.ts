import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleProject, diffRecords, flattenProject, hasMeaningfulLegacyData, legacyDismissedKey, LEGACY_IMPORTED_KEY, LEGACY_PROJECT_KEY,
  mergeLegacyInto, plansNeedingUpload, projectMeta, recordKey, referencedPlanIds, shouldOfferLegacyImport, type ProjectLike,
} from "../src/lib/cloudProject.ts";

const base = (over: Partial<ProjectLike> = {}): ProjectLike => ({
  name: "My House", userName: "Nimal", completed: ["foundation"], checklists: { foundation: [true, false] }, calculations: {},
  foundationPlan: { segments: [], totalLength: 0 }, ...over,
});
const foundation = (id: string, plan?: any) => ({ id, name: `Foundation ${id}`, method: plan ? "plan" : "manual", measurements: {} as any, results: [], ...(plan ? { plan } : {}) }) as any;
const brick = (id: string, name = `Brick ${id}`) => ({ id, name, categoryId: "standard-brick-1-5", thicknessId: "9in", wallLength: 10, wallHeight: 3, wallCount: 1, openingArea: 0, openings: [], wastagePercent: 5, wallType: "brick" }) as any;
const storage = (items: Record<string, string>) => ({ getItem: (k: string) => items[k] ?? null });

test("each calculation becomes its own record with kind and category", () => {
  const records = flattenProject(base({
    foundationCalculations: [foundation("f1")],
    brickworkCalculations: [brick("b1"), { ...brick("b2"), wallType: "cement-block" }],
    cementWorksCalculations: [{ id: "c1", name: "Column 01", category: "column" } as any],
    reinforcementCalculations: [{ id: "r1", calculationName: "Steel 01", memberType: "beam" } as any],
  }));
  assert.deepEqual(records.map(r => [r.id, r.kind, r.category, r.name]), [
    ["f1", "foundation", "manual", "Foundation f1"], ["b1", "brickwork", "brick", "Brick b1"], ["b2", "brickwork", "cement-block", "Brick b2"],
    ["c1", "cement", "column", "Column 01"], ["r1", "rebar", "rebar-beam", "Steel 01"],
  ]);
});

test("diff sends only new or changed records and deletes removed ones", () => {
  const before = flattenProject(base({ brickworkCalculations: [brick("b1"), brick("b2"), brick("b3")] }));
  const saved = new Map(before.map(r => [r.id, recordKey(r)]));
  const after = flattenProject(base({ brickworkCalculations: [brick("b1"), brick("b2", "Edited"), brick("b4")] }));
  const { upserts, deletes } = diffRecords(saved, after);
  assert.deepEqual(upserts.map(r => r.id), ["b2", "b4"]);
  assert.deepEqual(deletes, ["b3"]);
  assert.deepEqual(diffRecords(new Map(after.map(r => [r.id, recordKey(r)])), after), { upserts: [], deletes: [] });
});

test("assembled project round-trips back to the same records", () => {
  const original = base({ brickworkCalculations: [brick("b1")], cementWorksCalculations: [{ id: "c1", name: "Slab 01", category: "slab" } as any] });
  const server = flattenProject(original).map(r => ({ id: r.id, kind: r.kind, data: r.data }));
  const rebuilt = assembleProject({ id: "p1", projectName: "My House", completed: ["foundation"], checklists: { foundation: [true, false] } }, server, "Nimal", { brickwork: [false] });
  assert.deepEqual(flattenProject(rebuilt), flattenProject(original));
  assert.deepEqual(rebuilt.checklists, { brickwork: [false], foundation: [true, false] });
});

test("progress is derived from completed stages", () => {
  assert.equal(projectMeta(base({ completed: ["foundation", "brickwork"] }), 8).progress, 25);
});

test("plans with in-browser images are uploaded; referenced plan ids are tracked", () => {
  const records = flattenProject(base({ foundationCalculations: [
    foundation("f1", { segments: [], totalLengthM: 10, image: "data:image/jpeg;base64,AAAA" }),
    foundation("f2", { segments: [], totalLengthM: 5, planId: "plan-123" }),
    foundation("f3"),
  ] }));
  assert.deepEqual(plansNeedingUpload(records).map(r => r.id), ["f1"]);
  assert.deepEqual([...referencedPlanIds(records)], ["plan-123"]);
});

test("legacy browser data is offered once, only when it holds real work", () => {
  const withWork = JSON.stringify(base({ brickworkCalculations: [brick("b1")] }));
  assert.ok(shouldOfferLegacyImport(storage({ [LEGACY_PROJECT_KEY]: withWork }), "u1"));
  assert.equal(shouldOfferLegacyImport(storage({ [LEGACY_PROJECT_KEY]: withWork, [LEGACY_IMPORTED_KEY]: "u1" }), "u2"), null);
  assert.equal(shouldOfferLegacyImport(storage({ [LEGACY_PROJECT_KEY]: withWork, [legacyDismissedKey("u1")]: "1" }), "u1"), null);
  assert.equal(shouldOfferLegacyImport(storage({ [LEGACY_PROJECT_KEY]: "{not json" }), "u1"), null);
  assert.equal(hasMeaningfulLegacyData(base({ name: "My First House" })), false);
});

test("older single-foundation browser data is converted before import", () => {
  const old = { ...base(), calculations: { foundation: { measurements: { length: { value: 180, unit: "ft", inches: 2160 }, width: { value: 13, unit: "in", inches: 13 }, depth: { value: 2, unit: "ft", inches: 24 } }, results: [{ label: "Metal", value: "390 ft³" }] } } };
  const offered = shouldOfferLegacyImport(storage({ [LEGACY_PROJECT_KEY]: JSON.stringify(old) }), "u1");
  assert.equal(offered?.foundationCalculations?.length, 1);
  assert.equal(offered?.foundationCalculations?.[0].measurements.length.value, 180);
});

test("importing merges into the account without overwriting existing calculations", () => {
  const cloud = base({ name: "My House Project", completed: [], checklists: { brickwork: [false, true] }, brickworkCalculations: [brick("cloud-1")] });
  const legacy = base({ name: "Shanuka House", completed: ["foundation"], checklists: { brickwork: [true, false] }, brickworkCalculations: [brick("local-1")] });
  const merged = mergeLegacyInto(cloud, legacy);
  assert.deepEqual(merged.brickworkCalculations?.map(c => c.id), ["cloud-1", "local-1"]);
  assert.equal(merged.name, "Shanuka House");
  assert.deepEqual(merged.completed, ["foundation"]);
  assert.deepEqual(merged.checklists.brickwork, [true, true]);
});
