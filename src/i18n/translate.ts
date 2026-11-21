// Plain translation functions (no React), shared by the UI and the tests.
import en from "./en.ts";
import si from "./si.ts";

export type Language = "en" | "si";
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const DICTIONARIES: Record<Language, Record<string, string>> = { en, si };

// "{count} saved" + { count: 3 } -> "3 saved"
const fill = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : text;

// "label.Metal" etc. name stored English text; when a dictionary has no entry the text itself is the English wording.
const TEXT_PREFIX = /^(label|note|value)\./;

export function translate(language: Language, key: string, vars?: Record<string, string | number>): string {
  return fill(DICTIONARIES[language][key] ?? en[key] ?? key.replace(TEXT_PREFIX, ""), vars);
}

// Calculation results are saved with English labels/notes (e.g. "Wet Concrete Volume"); they are translated only when shown,
// so saved projects never need migrating and unknown labels are displayed unchanged.
export function translateText(language: Language, kind: "label" | "note" | "value", text: string): string {
  if (!text) return text;
  const dict = DICTIONARIES[language];
  const direct = dict[`${kind}.${text}`];
  if (direct) return direct;
  if (language === "en") return text;
  if (kind === "note") {
    // Notes that carry numbers, e.g. "1 part cement : 5 parts sand" or "12 mm thickness".
    const mix = /^(\d+(?:\.\d+)?) part cement : (\d+(?:\.\d+)?) parts sand$/.exec(text);
    if (mix && dict["note.mixParts"]) return fill(dict["note.mixParts"], { cement: mix[1], sand: mix[2] });
    const thick = /^(\d+(?:\.\d+)?) mm thickness$/.exec(text);
    if (thick && dict["note.mmThickness"]) return fill(dict["note.mmThickness"], { n: thick[1] });
    return text;
  }
  if (kind === "label") {
    const estimated = /^Estimated (.+)$/.exec(text);
    if (estimated && dict["label.estimatedPrefix"]) return fill(dict["label.estimatedPrefix"], { what: translateText(language, "value", estimated[1]) });
    return text;
  }
  // Values like "12 bags" or "340 nos." keep their numbers; only the word is translated.
  return text.replace(/\b(bags|bricks|nos\.)(?=\s|$)/g, word => dict[`value.${word}`] ?? word);
}
