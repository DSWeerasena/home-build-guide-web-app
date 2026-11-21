// Every translation key used in the UI must exist in English, and Sinhala must cover every English key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../src/i18n/en.ts";
import si from "../src/i18n/si.ts";
import { translate, translateText } from "../src/i18n/translate.ts";
import { CATEGORY_CONFIGS } from "../src/utils/cementCategories.ts";
import { LENGTH_UNITS } from "../src/utils/units.ts";
import { VOLUME_UNITS } from "../src/utils/quantities.ts";

const SRC = join(import.meta.dirname, "..", "src");
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !path.includes("i18n") ? [path] : [];
});
const source = files(SRC).map(f => readFileSync(f, "utf8")).join("\n");

// Literal keys: t("x.y"), t('x.y'), t("x.y", {...}), plus key strings passed around before being translated.
const literalKeys = new Set<string>();
for (const m of source.matchAll(/\bt\(\s*"([^"]+)"/g)) literalKeys.add(m[1]);
for (const m of source.matchAll(/\bt\(\s*\w+\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g)) { literalKeys.add(m[1]); literalKeys.add(m[2]); }
for (const m of source.matchAll(/"((?:fnd|bw|cw|rebar|stair|common|plan|report|check|prog|val|msg|tab|guide|overview|hero|how|journey|features|footer|auth|dash|nav|lang|notFound|stage|status|checklist|calc|comingSoon|safety|cat|err|authErr|migrate|verify|sync|profile|loading|vol|volSym|opening|about)\.[A-Za-z0-9.\-]+)"/g)) literalKeys.add(m[1]);

// Keys built at run time from known ids.
const dynamicKeys = [
  ...["foundation", "brickwork", "cement-works", "columns-beams-lintel", "plastering", "flooring", "slab", "stair-case"].flatMap(id => [id, `stageDesc.${id}`]),
  ...CATEGORY_CONFIGS.flatMap(c => ["label", "singular", "description", "heading", "subheading", "namePh"].map(f => `cat.${c.id}.${f}`)),
  ...["column", "beam", "lintel"].flatMap(m => [`rebar.member.${m}`, `rebar.plural.${m}`, `rebar.length.${m}`, `rebar.count.${m}`, `rebar.namePh.${m}`]),
  ...["longitudinal", "top", "bottom", "additional", "main"].map(g => `rebar.group.${g}`),
  ...LENGTH_UNITS.map(u => `unit.${u}`),
  ...["mm", "cm", "m", "inch", "foot", "cubic_feet", "cubic_inches"].map(u => `unitType.${u}`),
  ...VOLUME_UNITS.flatMap(u => [`vol.${u}`, `volSym.${u}`]),
  ...["door", "window", "other"].map(o => `opening.${o}`),
  ...["checklist", "noRecords", "ongoingRecords"].map(b => `check.blocked.${b}`),
  ...["why", "method", "note"].flatMap(k => [`about.${k}.title`, `about.${k}.text`]),
  "how", "stages", "features", "about",
  ...["completed", "progress", "not-started"].map(s => `status.${s}`),
  ...[1, 2, 3, 4].flatMap(n => [`how.step${n}.title`, `how.step${n}.text`]),
  ...[1, 2, 3, 4, 5, 6].flatMap(n => [`features.f${n}.title`, `features.f${n}.text`]),
  ...[1, 2, 3, 4, 5].map(n => `guide.step${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => `stair.step${n}`),
  ...["required", "stock", "lap", "effective", "barsPerRun", "laps", "lapTotal", "purchased", "effectiveLen", "excess", "runs", "totalBars", "totalPurchased", "totalLap", "stirNormalize", "stirCount", "stirTotal", "stirCut", "stirLength", "stirBars"].map(s => `rebar.step.${s}`),
];

const isTextKey = (k: string) => /^(label|note|value)\./.test(k);
const usedKeys = [...literalKeys, ...dynamicKeys].filter(k => !isTextKey(k) && !k.includes("${"));

test("every key used in the UI exists in English", () => {
  const missing = usedKeys.filter(k => !(k in en));
  assert.deepEqual(missing, []);
});

test("Sinhala has a translation for every English key", () => {
  const missing = Object.keys(en).filter(k => !(k in si));
  assert.deepEqual(missing, []);
});

test("Sinhala strings contain no stray Devanagari characters", () => {
  const bad = Object.entries(si).filter(([, v]) => /[ऀ-ॿ]/.test(v)).map(([k]) => k);
  assert.deepEqual(bad, []);
});

test("placeholders match between English and Sinhala", () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
  const mismatched = Object.keys(en).filter(k => k in si && names(en[k]) !== names(si[k]));
  assert.deepEqual(mismatched, []);
});

test("translate fills placeholders and falls back sensibly", () => {
  assert.equal(translate("en", "dash.stagesCompleted", { done: 2, total: 8 }), "2 of 8 stages completed");
  assert.equal(translate("si", "dash.stagesCompleted", { done: 2, total: 8 }), "අදියර 8 න් 2 ක් සම්පූර්ණයි");
  assert.equal(translate("si", "label.Some unknown label"), "Some unknown label");
  assert.equal(translate("si", "does.not.exist"), "does.not.exist");
});

test("stored English results are shown in Sinhala without changing numbers", () => {
  assert.equal(translateText("si", "label", "Wet Concrete Volume"), "තෙත් කොන්ක්‍රීට් පරිමාව");
  assert.equal(translateText("si", "value", "12 bags"), "12 බෑග්");
  assert.equal(translateText("si", "value", "1.25 m³"), "1.25 m³");
  assert.equal(translateText("si", "note", "1 part cement : 5 parts sand"), "සිමෙන්ති කොටස් 1 : වැලි කොටස් 5");
  assert.equal(translateText("si", "label", "Estimated Cement Blocks"), "ඇස්තමේන්තුගත සිමෙන්ති බ්ලොක්");
  assert.equal(translateText("en", "label", "Wet Concrete Volume"), "Wet Concrete Volume");
});

test("every result label, note and field label the calculators can produce has Sinhala", () => {
  const calc = readFileSync(join(SRC, "utils", "calculators.ts"), "utf8") + readFileSync(join(SRC, "utils", "cementCategories.ts"), "utf8") + readFileSync(join(SRC, "utils", "staircase.ts"), "utf8");
  const labels = new Set<string>();
  for (const m of calc.matchAll(/label: "([^"]+)"/g)) labels.add(m[1]);
  for (const m of calc.matchAll(/\[\["([^"]+)", /g)) labels.add(m[1]);
  for (const m of calc.matchAll(/\], \["([^"]+)", /g)) labels.add(m[1]);
  // Category names are shown through cat.<id>.label keys (checked above), and sizes such as 9" × 9" are numbers only.
  const categoryLabels = new Set(CATEGORY_CONFIGS.map(c => c.label));
  const untranslated = [...labels].filter(l => !categoryLabels.has(l) && translateText("si", "label", l) === l && translateText("si", "value", l) === l && !/^[\d½"×\s.()\\]+$/.test(l));
  assert.deepEqual(untranslated, []);
  const notes = [...calc.matchAll(/note: "([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(notes.filter(n => translateText("si", "note", n) === n), []);
});
