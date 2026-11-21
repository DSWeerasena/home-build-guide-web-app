import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { ApiError, apiErrorKey, apiFetch } from "../lib/api";
import {
  assembleProject, dataUrlToBlob, diffRecords, extensionForMime, flattenProject, LEGACY_IMPORTED_KEY, legacyDismissedKey, mergeLegacyInto,
  plansNeedingUpload, projectMeta, recordKey, referencedPlanIds, shouldOfferLegacyImport, type ProjectLike, type ServerCalculation, type ServerProject,
} from "../lib/cloudProject";
import { SIGNUP_DETAILS_KEY } from "../auth/AuthProvider";
import type { Language, Translate } from "../i18n";

export type CloudStatus = "idle" | "loading" | "ready" | "error";
export type SaveState = "idle" | "saving" | "saved" | "error";
export type Profile = { uid: string; name: string; email: string; preferredLanguage: Language; emailVerified?: boolean };
type Plan = { planId: string; url: string; fileName: string };

type Options = {
  user: User | null;
  language: Language;
  setLanguage: (l: Language) => void;
  notify: (message: string) => void;
  t: Translate;
  totalStages: number;
  emptyChecklists: Record<string, boolean[]>;
  emptyProject: ProjectLike;
};

const SAVE_DELAY_MS = 700;
const ignoreNotFound = (e: unknown) => { if (!(e instanceof ApiError && e.status === 404)) throw e; };

// Loads the signed-in user's project from the API and saves every change back automatically.
export function useCloudProject({ user, language, setLanguage, notify, t, totalStages, emptyChecklists, emptyProject }: Options) {
  const [status, setStatus] = useState<CloudStatus>("idle");
  const [project, setProjectState] = useState<ProjectLike>(emptyProject);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [planUrls, setPlanUrls] = useState<Record<string, string>>({});
  const [legacyOffer, setLegacyOffer] = useState<ProjectLike | null>(null);
  const [importing, setImporting] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Always the latest project, including changes not yet rendered.
  const projectRef = useRef(project);
  const projectId = useRef<string | null>(null);
  const savedRecords = useRef(new Map<string, string>());
  const savedMeta = useRef("");
  const knownPlans = useRef(new Set<string>());
  const syncing = useRef<Promise<boolean> | null>(null);
  const syncAgain = useRef(false);
  const pendingTimer = useRef<number | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  // Computed immediately (not inside a React updater) so the save code can read the new value straight away.
  const setProject = useCallback((next: ProjectLike | ((p: ProjectLike) => ProjectLike)) => {
    const value = typeof next === "function" ? next(projectRef.current) : next;
    projectRef.current = value;
    setProjectState(value);
  }, []);

  // ---- Load after sign-in; clear everything after sign-out ----
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setStatus("idle"); setProfile(null); setSaveState("idle"); setPlanUrls({}); setLegacyOffer(null);
      setProject(emptyProject);
      projectId.current = null; savedRecords.current = new Map(); savedMeta.current = ""; knownPlans.current = new Set();
      return;
    }
    (async () => {
      setStatus("loading");
      try {
        let signup: { name?: string; preferredLanguage?: Language } | null = null;
        try { signup = JSON.parse(sessionStorage.getItem(SIGNUP_DETAILS_KEY) || "null"); } catch { signup = null; }
        const boot = await apiFetch<{ user: Profile; projects: ServerProject[] }>("/api/users/bootstrap", {
          method: "POST",
          body: { ...(signup?.name ? { name: signup.name } : {}), preferredLanguage: signup?.preferredLanguage ?? language },
        });
        sessionStorage.removeItem(SIGNUP_DETAILS_KEY);
        const serverProject = boot.projects[0];
        const [{ calculations }, { plans }] = await Promise.all([
          apiFetch<{ calculations: ServerCalculation[] }>(`/api/projects/${serverProject.id}/calculations`),
          apiFetch<{ plans: Plan[] }>(`/api/projects/${serverProject.id}/foundation/plans`),
        ]);
        if (cancelled) return;
        const assembled = assembleProject(serverProject, calculations, boot.user.name, emptyChecklists);
        projectId.current = serverProject.id;
        savedRecords.current = new Map(flattenProject(assembled).map(r => [r.id, recordKey(r)]));
        savedMeta.current = JSON.stringify(projectMeta(assembled, totalStages));
        knownPlans.current = new Set(plans.map(p => p.planId));
        setPlanUrls(Object.fromEntries(plans.map(p => [p.planId, p.url])));
        setProfile(boot.user);
        if (boot.user.preferredLanguage && boot.user.preferredLanguage !== language) setLanguage(boot.user.preferredLanguage);
        setProject(assembled);
        setLegacyOffer(shouldOfferLegacyImport(localStorage, user.uid));
        setSaveState("idle");
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        notify(tRef.current(apiErrorKey(error)));
      }
    })();
    return () => { cancelled = true; };
    // Reload only when the signed-in account changes or the user asks to retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, loadAttempt]);

  // ---- Save: upload new plan images, then changed calculations, then project details, then unused plans ----
  const syncOnce = useCallback(async (): Promise<boolean> => {
    const pid = projectId.current;
    if (!pid) return true;
    let records = flattenProject(projectRef.current);
    const uploads = plansNeedingUpload(records);
    let { upserts, deletes } = diffRecords(savedRecords.current, records);
    const metaChanged = () => JSON.stringify(projectMeta(projectRef.current, totalStages)) !== savedMeta.current;
    if (!uploads.length && !upserts.length && !deletes.length && !metaChanged()) return true;

    setSaveState("saving");
    try {
      for (const rec of uploads) {
        const plan = rec.data.plan;
        const blob = dataUrlToBlob(plan.image);
        const baseName = String(plan.fileName || "house-plan").replace(/\.[^.]+$/, "") || "house-plan";
        const form = new FormData();
        form.append("displayName", plan.fileName || `${baseName}.${extensionForMime(blob.type)}`);
        form.append("analysisStatus", "traced");
        form.append("file", blob, `${baseName}.${extensionForMime(blob.type)}`);
        const { plan: saved } = await apiFetch<{ plan: Plan }>(`/api/projects/${pid}/foundation/plans`, { method: "POST", form });
        knownPlans.current.add(saved.planId);
        setPlanUrls(urls => ({ ...urls, [saved.planId]: saved.url }));
        // Swap the in-browser image for the stored plan reference.
        setProject(p => ({
          ...p,
          foundationCalculations: (p.foundationCalculations ?? []).map(c => c.id === rec.id && c.plan && c.plan.image === plan.image
            ? { ...c, plan: { ...c.plan, image: undefined, planId: saved.planId, fileName: saved.fileName } }
            : c),
        }));
      }
      if (uploads.length) {
        records = flattenProject(projectRef.current);
        ({ upserts, deletes } = diffRecords(savedRecords.current, records));
      }
      for (const rec of upserts) {
        await apiFetch(`/api/projects/${pid}/calculations/${encodeURIComponent(rec.id)}`, {
          method: "PUT",
          body: { kind: rec.kind, category: rec.category, name: (rec.name || "Calculation").slice(0, 120), data: rec.data },
        });
        savedRecords.current.set(rec.id, recordKey(rec));
      }
      for (const id of deletes) {
        await apiFetch(`/api/projects/${pid}/calculations/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(ignoreNotFound);
        savedRecords.current.delete(id);
      }
      if (metaChanged()) {
        const meta = projectMeta(projectRef.current, totalStages);
        await apiFetch(`/api/projects/${pid}`, { method: "PUT", body: meta });
        savedMeta.current = JSON.stringify(meta);
      }
      // A replaced or deleted plan is removed only after the calculations no longer reference it.
      const used = referencedPlanIds(flattenProject(projectRef.current));
      for (const planId of [...knownPlans.current]) {
        if (used.has(planId)) continue;
        await apiFetch(`/api/projects/${pid}/foundation/plans/${encodeURIComponent(planId)}`, { method: "DELETE" }).catch(ignoreNotFound);
        knownPlans.current.delete(planId);
      }
      setSaveState("saved");
      return true;
    } catch (error) {
      setSaveState("error");
      notify(tRef.current(apiErrorKey(error) === "err.generic" ? "err.save" : apiErrorKey(error)));
      return false;
    }
  }, [notify, setProject, totalStages]);

  // Saves never overlap; changes made during a save are picked up by another pass.
  const runSync = useCallback(async (): Promise<boolean> => {
    if (syncing.current) { syncAgain.current = true; return syncing.current; }
    const task = (async () => {
      let ok = true;
      do { syncAgain.current = false; ok = await syncOnce(); } while (ok && syncAgain.current);
      return ok;
    })();
    syncing.current = task;
    try { return await task; } finally { syncing.current = null; }
  }, [syncOnce]);

  useEffect(() => {
    if (status !== "ready") return;
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(() => { pendingTimer.current = null; void runSync(); }, SAVE_DELAY_MS);
    return () => { if (pendingTimer.current) window.clearTimeout(pendingTimer.current); };
  }, [project, status, runSync]);

  // Warn before leaving while a save is still pending.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (pendingTimer.current || syncing.current) e.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Remember the language the user picks in their profile.
  useEffect(() => {
    if (status !== "ready" || !profile || profile.preferredLanguage === language) return;
    apiFetch<{ user: Profile }>("/api/me", { method: "PUT", body: { preferredLanguage: language } })
      .then(res => setProfile(res.user))
      .catch(() => { /* the choice still applies on this device */ });
  }, [language, profile, status]);

  const updateName = useCallback(async (name: string) => {
    const res = await apiFetch<{ user: Profile }>("/api/me", { method: "PUT", body: { name } });
    setProfile(res.user);
    setProject(p => ({ ...p, userName: res.user.name }));
  }, [setProject]);

  // One-time import of a project saved only in this browser. Browser data is never deleted; it is just marked as imported.
  const importLegacy = useCallback(async () => {
    if (!legacyOffer || !user) return false;
    setImporting(true);
    if (pendingTimer.current) { window.clearTimeout(pendingTimer.current); pendingTimer.current = null; }
    setProject(p => mergeLegacyInto(p, legacyOffer));
    const ok = await runSync();
    setImporting(false);
    if (ok) {
      localStorage.setItem(LEGACY_IMPORTED_KEY, user.uid);
      setLegacyOffer(null);
      notify(tRef.current("migrate.done"));
    }
    return ok;
  }, [legacyOffer, user, runSync, setProject, notify]);

  const dismissLegacy = useCallback(() => {
    if (user) localStorage.setItem(legacyDismissedKey(user.uid), "1");
    setLegacyOffer(null);
  }, [user]);

  return {
    status, project, setProject, profile, saveState, planUrls, legacyOffer, importing,
    importLegacy, dismissLegacy, updateName,
    retryLoad: () => setLoadAttempt(n => n + 1),
    retrySave: runSync,
  };
}
