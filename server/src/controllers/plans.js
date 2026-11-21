import { randomUUID } from "node:crypto";
import { notFound } from "../errors.js";
import { validateId } from "../middleware/validate.js";
import { detectPlanType } from "../middleware/upload.js";

const ANALYSIS_STATUSES = ["uploaded", "traced", "completed"];
const safeFileName = name => String(name || "").replace(/[^\p{L}\p{N} ._()-]/gu, "").trim().slice(0, 120) || "house-plan";

export function plansController({ store, files }) {
  const withUrl = async plan => ({ ...plan, url: await files.signedUrl(plan.storagePath) });
  return {
    async upload(req, res) {
      const type = detectPlanType(req.file);
      const { uid } = req.user;
      const planId = randomUUID();
      const storagePath = `users/${uid}/projects/${req.project.id}/plans/${planId}.${type.ext}`;
      await files.save(storagePath, req.file.buffer, type.mime);
      try {
        const plan = await store.createPlan(req.project.id, planId, {
          planId,
          projectId: req.project.id,
          ownerId: uid,
          fileName: safeFileName(req.body?.displayName || req.file.originalname),
          storagePath,
          contentType: type.mime,
          size: req.file.size,
          analysisStatus: ANALYSIS_STATUSES.includes(req.body?.analysisStatus) ? req.body.analysisStatus : "uploaded",
        });
        res.status(201).json({ plan: await withUrl(plan) });
      } catch (error) {
        // Never leave an uploaded file without its metadata record.
        await files.remove(storagePath).catch(() => {});
        throw error;
      }
    },
    async list(req, res) {
      const plans = await store.listPlans(req.project.id);
      res.json({ plans: await Promise.all(plans.map(withUrl)) });
    },
    async remove(req, res) {
      const planId = validateId(req.params.planId, "planId");
      const plan = await store.getPlan(req.project.id, planId);
      if (!plan) throw notFound("Plan");
      await files.remove(plan.storagePath);
      await store.deletePlan(req.project.id, planId);
      res.status(204).end();
    },
  };
}
