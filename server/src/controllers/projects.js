import { validateProject } from "../middleware/validate.js";
import { deleteProjectCompletely } from "../services/cleanup.js";

export function projectsController(deps) {
  const { store } = deps;
  return {
    async list(req, res) {
      res.json({ projects: await store.listProjects(req.user.uid) });
    },
    async create(req, res) {
      const input = validateProject(req.body, { partial: false });
      const project = await store.createProject({ completed: [], checklists: {}, progress: 0, houseType: "residential", preferredLanguage: "en", ...input, ownerId: req.user.uid });
      res.status(201).json({ project });
    },
    // req.project was loaded and ownership-checked by requireProjectOwner.
    async get(req, res) {
      res.json({ project: req.project });
    },
    async update(req, res) {
      res.json({ project: await store.updateProject(req.project.id, validateProject(req.body, { partial: true })) });
    },
    async remove(req, res) {
      await deleteProjectCompletely(deps, req.user.uid, req.project.id);
      res.status(204).end();
    },
  };
}
