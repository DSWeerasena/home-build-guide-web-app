import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, requireProjectOwner } from "../middleware/auth.js";
import { planUpload } from "../middleware/upload.js";
import { usersController } from "../controllers/users.js";
import { projectsController } from "../controllers/projects.js";
import { calculationsController } from "../controllers/calculations.js";
import { plansController } from "../controllers/plans.js";
import { reportsController } from "../controllers/reports.js";

const limitMessage = { error: "rate_limited", message: "Too many requests. Please wait a moment and try again." };

// Every /api route requires a verified Firebase token; every project route also requires ownership.
export function apiRouter(deps) {
  const { store, auth, logger, config } = deps;
  const router = Router();
  const users = usersController(deps);
  const projects = projectsController(deps);
  const calcs = calculationsController(deps);
  const plans = plansController(deps);
  const reports = reportsController(deps);
  const owner = requireProjectOwner(store);
  const uploadLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false, message: limitMessage });

  router.use(authenticate(auth, logger));

  router.post("/users/bootstrap", users.bootstrap);
  router.get("/me", users.me);
  router.put("/me", users.updateMe);
  router.delete("/me", users.deleteMe);

  router.get("/projects", projects.list);
  router.post("/projects", projects.create);
  router.get("/projects/:projectId", owner, projects.get);
  router.put("/projects/:projectId", owner, projects.update);
  router.delete("/projects/:projectId", owner, projects.remove);

  router.get("/projects/:projectId/calculations", owner, calcs.list);
  router.post("/projects/:projectId/calculations", owner, calcs.create);
  router.get("/projects/:projectId/calculations/:calculationId", owner, calcs.get);
  router.put("/projects/:projectId/calculations/:calculationId", owner, calcs.upsert);
  router.delete("/projects/:projectId/calculations/:calculationId", owner, calcs.remove);

  router.post("/projects/:projectId/foundation/plans", uploadLimit, owner, planUpload(config.uploads.maxBytes), plans.upload);
  router.get("/projects/:projectId/foundation/plans", owner, plans.list);
  router.delete("/projects/:projectId/foundation/plans/:planId", owner, plans.remove);

  router.get("/projects/:projectId/report", owner, reports.get);
  return router;
}
