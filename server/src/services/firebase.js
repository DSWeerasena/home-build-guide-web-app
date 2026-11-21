// Firebase Admin SDK setup. Credentials come only from environment variables (never from the frontend).
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export function initFirebase(firebaseConfig) {
  const app = initializeApp({
    credential: cert({ projectId: firebaseConfig.projectId, clientEmail: firebaseConfig.clientEmail, privateKey: firebaseConfig.privateKey }),
    storageBucket: firebaseConfig.storageBucket,
  });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return { db, bucket: getStorage(app).bucket(), auth: getAuth(app) };
}

// Firestore Timestamps become ISO strings in API responses.
function plain(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}
const fromSnap = snap => (snap.exists ? { ...plain(snap.data()), id: snap.id } : null);

async function deleteCollection(collectionRef) {
  for (;;) {
    const page = await collectionRef.limit(400).get();
    if (page.empty) return;
    const batch = collectionRef.firestore.batch();
    page.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

// Data access used by the controllers. Every write stamps server-side times; the client clock is never used.
export function createFirestoreStore(db) {
  const now = () => FieldValue.serverTimestamp();
  const users = db.collection("users");
  const projects = db.collection("projects");
  const calcs = projectId => projects.doc(projectId).collection("calculations");
  const plans = projectId => projects.doc(projectId).collection("plans");

  return {
    async getUser(uid) { return fromSnap(await users.doc(uid).get()); },
    async createUser(uid, data) { await users.doc(uid).set({ ...data, uid, createdAt: now(), updatedAt: now(), lastLoginAt: now() }); return this.getUser(uid); },
    async updateUser(uid, data) { await users.doc(uid).set({ ...data, updatedAt: now() }, { merge: true }); return this.getUser(uid); },
    async touchLogin(uid, data) { await users.doc(uid).set({ ...data, lastLoginAt: now() }, { merge: true }); },
    async deleteUser(uid) { await users.doc(uid).delete(); },

    async listProjects(ownerId) {
      const snap = await projects.where("ownerId", "==", ownerId).get();
      return snap.docs.map(fromSnap).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },
    async getProject(projectId) { return fromSnap(await projects.doc(projectId).get()); },
    async createProject(data) { const ref = projects.doc(); await ref.set({ ...data, createdAt: now(), updatedAt: now() }); return this.getProject(ref.id); },
    async updateProject(projectId, data) { await projects.doc(projectId).update({ ...data, updatedAt: now() }); return this.getProject(projectId); },
    async deleteProject(projectId) {
      await deleteCollection(calcs(projectId));
      await deleteCollection(plans(projectId));
      await projects.doc(projectId).delete();
    },

    async listCalculations(projectId) {
      const snap = await calcs(projectId).get();
      return snap.docs.map(fromSnap).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },
    async getCalculation(projectId, id) { return fromSnap(await calcs(projectId).doc(id).get()); },
    async saveCalculation(projectId, id, data, isNew) {
      const ref = calcs(projectId).doc(id);
      await ref.set(isNew ? { ...data, createdAt: now(), updatedAt: now() } : { ...data, updatedAt: now() }, { merge: !isNew });
      return fromSnap(await ref.get());
    },
    async deleteCalculation(projectId, id) { await calcs(projectId).doc(id).delete(); },

    async listPlans(projectId) {
      const snap = await plans(projectId).get();
      return snap.docs.map(fromSnap).sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
    },
    async getPlan(projectId, planId) { return fromSnap(await plans(projectId).doc(planId).get()); },
    async createPlan(projectId, planId, data) { await plans(projectId).doc(planId).set({ ...data, uploadedAt: now() }); return this.getPlan(projectId, planId); },
    async deletePlan(projectId, planId) { await plans(projectId).doc(planId).delete(); },
  };
}

// Uploaded files live in a private bucket; the browser only ever receives short-lived signed URLs.
export function createStorageFiles(bucket) {
  return {
    async save(path, buffer, contentType) { await bucket.file(path).save(buffer, { contentType, resumable: false, metadata: { cacheControl: "private, max-age=0" } }); },
    async remove(path) { await bucket.file(path).delete({ ignoreNotFound: true }); },
    async removePrefix(prefix) { await bucket.deleteFiles({ prefix, force: true }); },
    async signedUrl(path) {
      const [url] = await bucket.file(path).getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
      return url;
    },
  };
}

export function createAuthService(auth) {
  return {
    verifyIdToken: token => auth.verifyIdToken(token, true),
    deleteUser: uid => auth.deleteUser(uid),
  };
}
