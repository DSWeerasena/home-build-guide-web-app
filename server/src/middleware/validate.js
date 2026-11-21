import { badRequest } from "../errors.js";

export const LANGUAGES = ["en", "si"];
// The stage is derived from the calculation kind on the server, never taken from the request.
export const CALCULATION_KINDS = { foundation: "foundation", brickwork: "brickwork", cement: "cement-works", rebar: "cement-works" };
export const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const SLUG = /^[a-z0-9-]{1,60}$/;
const MAX_CALCULATION_BYTES = 200_000;

const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

function text(value, field, { min = 1, max = 120, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string") throw badRequest(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw badRequest(`${field} must be ${min}–${max} characters.`);
  return trimmed;
}

function language(value, optional = true) {
  if (value === undefined && optional) return undefined;
  if (!LANGUAGES.includes(value)) throw badRequest("preferredLanguage must be \"en\" or \"si\".");
  return value;
}

// Copies only allowed fields so unexpected keys (e.g. ownerId) can never be written.
const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function validateUserUpdate(body) {
  if (!isPlainObject(body)) throw badRequest("Expected a JSON object.");
  const update = defined({ name: text(body.name, "name", { max: 80, optional: true }), preferredLanguage: language(body.preferredLanguage) });
  if (!Object.keys(update).length) throw badRequest("Nothing to update.");
  return update;
}

export function validateBootstrap(body) {
  const data = isPlainObject(body) ? body : {};
  return defined({ name: text(data.name, "name", { max: 80, optional: true }), preferredLanguage: language(data.preferredLanguage) });
}

export function validateProject(body, { partial }) {
  if (!isPlainObject(body)) throw badRequest("Expected a JSON object.");
  const out = defined({
    projectName: text(body.projectName, "projectName", { optional: partial }),
    houseType: text(body.houseType, "houseType", { max: 40, optional: true }),
    preferredLanguage: language(body.preferredLanguage),
  });
  if (body.completed !== undefined) {
    if (!Array.isArray(body.completed) || body.completed.length > 50 || !body.completed.every(s => typeof s === "string" && SLUG.test(s))) throw badRequest("completed must be a list of stage ids.");
    out.completed = [...new Set(body.completed)];
  }
  if (body.checklists !== undefined) {
    const ok = isPlainObject(body.checklists) && Object.keys(body.checklists).length <= 50
      && Object.entries(body.checklists).every(([k, v]) => SLUG.test(k) && Array.isArray(v) && v.length <= 30 && v.every(b => typeof b === "boolean"));
    if (!ok) throw badRequest("checklists must map stage ids to lists of true/false values.");
    out.checklists = body.checklists;
  }
  if (body.progress !== undefined) {
    if (typeof body.progress !== "number" || !Number.isFinite(body.progress) || body.progress < 0 || body.progress > 100) throw badRequest("progress must be between 0 and 100.");
    out.progress = Math.round(body.progress);
  }
  if (partial && !Object.keys(out).length) throw badRequest("Nothing to update.");
  return out;
}

export function validateCalculation(body) {
  if (!isPlainObject(body)) throw badRequest("Expected a JSON object.");
  if (!Object.hasOwn(CALCULATION_KINDS, body.kind)) throw badRequest(`kind must be one of: ${Object.keys(CALCULATION_KINDS).join(", ")}.`);
  if (typeof body.category !== "string" || !SLUG.test(body.category)) throw badRequest("category must be a short lowercase id.");
  if (!isPlainObject(body.data)) throw badRequest("data must be an object.");
  const json = JSON.stringify(body.data);
  if (json.length > MAX_CALCULATION_BYTES) throw badRequest("This calculation is too large to save.");
  // Images belong in Firebase Storage (plans endpoint), not inside Firestore documents.
  if (/"data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(json)) throw badRequest("Upload plan images through the plans endpoint instead of embedding them.");
  return { kind: body.kind, stage: CALCULATION_KINDS[body.kind], category: body.category, name: text(body.name, "name"), data: body.data };
}

export function validateId(id, label = "id") {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw badRequest(`${label} is not valid.`);
  return id;
}
