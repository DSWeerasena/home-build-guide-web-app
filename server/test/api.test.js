// Runs the real Express app against in-memory stand-ins for Firestore, Storage and Firebase Auth.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const clone = v => JSON.parse(JSON.stringify(v));
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1) + clock++).toISOString();

function memoryStore() {
  const users = new Map(), projects = new Map(), calcs = new Map(), plans = new Map();
  let nextProject = 1;
  const sub = (map, pid) => [...map.values()].filter(x => x.projectId === pid).map(clone);
  return {
    data: { users, projects, calcs, plans },
    async getUser(uid) { return users.has(uid) ? clone(users.get(uid)) : null; },
    async createUser(uid, data) { users.set(uid, { ...data, uid, id: uid, createdAt: stamp() }); return this.getUser(uid); },
    async updateUser(uid, data) { users.set(uid, { ...users.get(uid), ...data }); return this.getUser(uid); },
    async touchLogin(uid, data) { users.set(uid, { ...users.get(uid), ...data, lastLoginAt: stamp() }); },
    async deleteUser(uid) { users.delete(uid); },
    async listProjects(owner) { return [...projects.values()].filter(p => p.ownerId === owner).map(clone); },
    async getProject(id) { return projects.has(id) ? clone(projects.get(id)) : null; },
    async createProject(data) { const id = `proj${nextProject++}`; projects.set(id, { ...data, id, createdAt: stamp() }); return this.getProject(id); },
    async updateProject(id, data) { projects.set(id, { ...projects.get(id), ...data }); return this.getProject(id); },
    async deleteProject(id) {
      for (const [k, v] of calcs) if (v.projectId === id) calcs.delete(k);
      for (const [k, v] of plans) if (v.projectId === id) plans.delete(k);
      projects.delete(id);
    },
    async listCalculations(pid) { return sub(calcs, pid); },
    async getCalculation(pid, id) { const c = calcs.get(`${pid}/${id}`); return c ? clone(c) : null; },
    async saveCalculation(pid, id, data, isNew) {
      const key = `${pid}/${id}`;
      calcs.set(key, isNew ? { ...data, id, createdAt: stamp() } : { ...calcs.get(key), ...data, id, updatedAt: stamp() });
      return this.getCalculation(pid, id);
    },
    async deleteCalculation(pid, id) { calcs.delete(`${pid}/${id}`); },
    async listPlans(pid) { return sub(plans, pid); },
    async getPlan(pid, id) { const p = plans.get(`${pid}/${id}`); return p ? clone(p) : null; },
    async createPlan(pid, id, data) { plans.set(`${pid}/${id}`, { ...data, id, uploadedAt: stamp() }); return this.getPlan(pid, id); },
    async deletePlan(pid, id) { plans.delete(`${pid}/${id}`); },
  };
}

function memoryFiles() {
  const saved = new Map();
  return {
    saved,
    async save(path, buffer, contentType) { saved.set(path, { size: buffer.length, contentType }); },
    async remove(path) { saved.delete(path); },
    async removePrefix(prefix) { for (const k of [...saved.keys()]) if (k.startsWith(prefix)) saved.delete(k); },
    async signedUrl(path) { return `https://signed.example/${encodeURIComponent(path)}`; },
  };
}

// Tokens are "token-<uid>"; anything else is rejected like an invalid or expired Firebase token.
const fakeAuth = { deleted: [], verifyIdToken: async t => { if (!t.startsWith("token-")) throw Object.assign(new Error("bad"), { code: "auth/argument-error" }); return { uid: t.slice(6), email: `${t.slice(6)}@example.com`, email_verified: false }; }, async deleteUser(uid) { this.deleted.push(uid); } };
const quietLogger = { warn() {}, error() {}, log() {} };

let server, base, store, files;
before(async () => {
  store = memoryStore();
  files = memoryFiles();
  const config = loadConfig({ NODE_ENV: "production", FRONTEND_URL: "https://house-build-guide.vercel.app" });
  const app = createApp({ config, store, files, auth: fakeAuth, logger: quietLogger });
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (path, { uid, method = "GET", body, headers = {} } = {}) => fetch(`${base}${path}`, {
  method,
  headers: { ...(uid ? { Authorization: `Bearer token-${uid}` } : {}), ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...headers },
  body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
});
const json = async res => ({ status: res.status, body: res.status === 204 ? null : await res.json() });
const bootstrap = async uid => (await json(await call("/api/users/bootstrap", { uid, method: "POST", body: { name: uid.toUpperCase(), preferredLanguage: "si" } }))).body;
const calcBody = (over = {}) => ({ kind: "brickwork", category: "brick", name: "Brick Wall 01", data: { wallLength: 10, results: [{ label: "Net Wall Area", value: "27 m²" }] }, ...over });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const planForm = (bytes, name, type) => { const f = new FormData(); f.append("displayName", "Ground floor.png"); f.append("file", new Blob([bytes], { type }), name); return f; };

test("health check is public and reveals no configuration", async () => {
  const r = await json(await call("/health"));
  assert.deepEqual(r, { status: 200, body: { status: "ok", service: "house-build-guide-api" } });
});

test("API rejects missing and invalid tokens with friendly messages", async () => {
  assert.equal((await json(await call("/api/me"))).body.error, "auth_required");
  const bad = await json(await call("/api/me", { headers: { Authorization: "Bearer forged" } }));
  assert.equal(bad.status, 401);
  assert.equal(bad.body.message, "Your session has expired. Please sign in again.");
});

test("bootstrap creates the profile and first project once, keeps language, never stores a password", async () => {
  const first = await bootstrap("alice");
  assert.equal(first.user.preferredLanguage, "si");
  assert.equal(first.projects.length, 1);
  assert.equal(first.projects[0].ownerId, "alice");
  const again = await bootstrap("alice");
  assert.equal(again.projects.length, 1);
  assert.ok(!("password" in again.user) && !("passwordHash" in again.user));
});

test("calculations: unique ids, edits update the same record, nothing is overwritten", async () => {
  const { projects: [p] } = await bootstrap("alice");
  const a = await json(await call(`/api/projects/${p.id}/calculations`, { uid: "alice", method: "POST", body: calcBody() }));
  const b = await json(await call(`/api/projects/${p.id}/calculations`, { uid: "alice", method: "POST", body: calcBody({ name: "Brick Wall 02" }) }));
  assert.equal(a.status, 201);
  assert.notEqual(a.body.calculation.id, b.body.calculation.id);
  assert.equal(a.body.calculation.stage, "brickwork");

  const edited = await json(await call(`/api/projects/${p.id}/calculations/${a.body.calculation.id}`, { uid: "alice", method: "PUT", body: calcBody({ name: "Brick Wall 01 (edited)" }) }));
  assert.equal(edited.status, 200);
  const list = (await json(await call(`/api/projects/${p.id}/calculations`, { uid: "alice" }))).body.calculations;
  assert.equal(list.filter(c => c.id === a.body.calculation.id).length, 1);
  assert.ok(list.some(c => c.name === "Brick Wall 01 (edited)") && list.some(c => c.name === "Brick Wall 02"));
});

test("stage comes from the server and forged owner fields are ignored", async () => {
  const { projects: [p] } = await bootstrap("alice");
  const r = await json(await call(`/api/projects/${p.id}/calculations`, { uid: "alice", method: "POST", body: { ...calcBody(), stage: "foundation", ownerId: "mallory" } }));
  assert.equal(r.body.calculation.stage, "brickwork");
  assert.equal(r.body.calculation.ownerId, "alice");
});

test("another user cannot read, edit, delete or upload into someone else's project", async () => {
  const { projects: [p] } = await bootstrap("alice");
  await bootstrap("bob");
  const calc = (await json(await call(`/api/projects/${p.id}/calculations`, { uid: "alice", method: "POST", body: calcBody() }))).body.calculation;
  const attempts = [
    call(`/api/projects/${p.id}`, { uid: "bob" }),
    call(`/api/projects/${p.id}`, { uid: "bob", method: "PUT", body: { projectName: "Mine now" } }),
    call(`/api/projects/${p.id}/calculations`, { uid: "bob" }),
    call(`/api/projects/${p.id}/calculations/${calc.id}`, { uid: "bob" }),
    call(`/api/projects/${p.id}/calculations/${calc.id}`, { uid: "bob", method: "PUT", body: calcBody() }),
    call(`/api/projects/${p.id}/calculations/${calc.id}`, { uid: "bob", method: "DELETE" }),
    call(`/api/projects/${p.id}/foundation/plans`, { uid: "bob" }),
    call(`/api/projects/${p.id}/foundation/plans`, { uid: "bob", method: "POST", body: planForm(PNG, "plan.png", "image/png") }),
    call(`/api/projects/${p.id}/report`, { uid: "bob" }),
    call(`/api/projects/${p.id}`, { uid: "bob", method: "DELETE" }),
  ];
  for (const res of await Promise.all(attempts)) assert.equal(res.status, 403);
  assert.ok(!(await json(await call("/api/projects", { uid: "bob" }))).body.projects.some(x => x.id === p.id));
  assert.equal((await json(await call(`/api/projects/${p.id}/calculations/${calc.id}`, { uid: "alice" }))).status, 200);
});

test("validation rejects bad input and embedded base64 images", async () => {
  const { projects: [p] } = await bootstrap("alice");
  const post = body => call(`/api/projects/${p.id}/calculations`, { uid: "alice", method: "POST", body });
  assert.equal((await post(calcBody({ kind: "nonsense" }))).status, 400);
  assert.equal((await post(calcBody({ name: "" }))).status, 400);
  assert.equal((await post(calcBody({ id: "../../etc" }))).status, 400);
  assert.equal((await post(calcBody({ data: { plan: { image: "data:image/png;base64,AAAA" } } }))).status, 400);
  assert.equal((await call(`/api/projects/${p.id}`, { uid: "alice", method: "PUT", body: { progress: 400 } })).status, 400);
  assert.equal((await call("/api/me", { uid: "alice", method: "PUT", body: { preferredLanguage: "fr" } })).status, 400);
  assert.equal((await call(`/api/projects/does-not-exist`, { uid: "alice" })).status, 404);
});

test("plan upload checks type and bytes, stores privately, and lists signed URLs", async () => {
  const { projects: [p] } = await bootstrap("alice");
  const url = `/api/projects/${p.id}/foundation/plans`;
  const ok = await json(await call(url, { uid: "alice", method: "POST", body: planForm(PNG, "plan.png", "image/png") }));
  assert.equal(ok.status, 201);
  assert.match(ok.body.plan.storagePath, new RegExp(`^users/alice/projects/${p.id}/plans/.+\\.png$`));
  assert.equal(ok.body.plan.fileName, "Ground floor.png");
  assert.ok(files.saved.has(ok.body.plan.storagePath));

  assert.equal((await call(url, { uid: "alice", method: "POST", body: planForm(Uint8Array.from([1, 2, 3, 4]), "fake.png", "image/png") })).status, 415);
  assert.equal((await call(url, { uid: "alice", method: "POST", body: planForm(PNG, "plan.txt", "text/plain") })).status, 415);
  assert.equal((await call(url, { uid: "alice", method: "POST", body: planForm(PNG, "plan.jpg", "image/png") })).status, 415);

  const listed = (await json(await call(url, { uid: "alice" }))).body.plans;
  assert.ok(listed.some(x => x.planId === ok.body.plan.planId && x.url.startsWith("https://signed.example/")));
  assert.equal((await call(`${url}/${ok.body.plan.planId}`, { uid: "alice", method: "DELETE" })).status, 204);
  assert.ok(!files.saved.has(ok.body.plan.storagePath));
});

test("report groups the owner's latest calculations by stage", async () => {
  const { projects: [p] } = await bootstrap("carol");
  await call(`/api/projects/${p.id}/calculations`, { uid: "carol", method: "POST", body: calcBody() });
  await call(`/api/projects/${p.id}/calculations`, { uid: "carol", method: "POST", body: calcBody({ kind: "cement", category: "staircase", name: "Stair Case 01" }) });
  const r = (await json(await call(`/api/projects/${p.id}/report`, { uid: "carol" }))).body;
  assert.equal(r.counts.brickwork, 1);
  assert.equal(r.counts["cement-works"], 1);
});

test("deleting the account removes projects, calculations, plans, files, profile and the auth user", async () => {
  const { projects: [p] } = await bootstrap("dave");
  await call(`/api/projects/${p.id}/calculations`, { uid: "dave", method: "POST", body: calcBody() });
  await call(`/api/projects/${p.id}/foundation/plans`, { uid: "dave", method: "POST", body: planForm(PNG, "plan.png", "image/png") });
  assert.equal((await call("/api/me", { uid: "dave", method: "DELETE" })).status, 204);
  assert.equal(await store.getUser("dave"), null);
  assert.equal(await store.getProject(p.id), null);
  assert.equal((await store.listCalculations(p.id)).length, 0);
  assert.equal((await store.listPlans(p.id)).length, 0);
  assert.ok(![...files.saved.keys()].some(k => k.startsWith("users/dave/")));
  assert.ok(fakeAuth.deleted.includes("dave"));
});

test("CORS only allows the configured frontend and errors stay generic", async () => {
  const allowed = await call("/health", { headers: { Origin: "https://house-build-guide.vercel.app" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://house-build-guide.vercel.app");
  const blocked = await json(await call("/health", { headers: { Origin: "https://evil.example" } }));
  assert.equal(blocked.status, 403);
  const missing = await json(await call("/nope"));
  assert.deepEqual(missing.body, { error: "not_found", message: "Not found." });
});
