import { randomUUID } from "node:crypto";
import { HttpError, notFound } from "../errors.js";
import { validateCalculation, validateId } from "../middleware/validate.js";

// Calculations live under projects/{projectId}/calculations/{calculationId}; the project was ownership-checked already.
export function calculationsController({ store }) {
  const save = async (req, id, isNew) => {
    const input = validateCalculation(req.body);
    return store.saveCalculation(req.project.id, id, { ...input, ownerId: req.user.uid, projectId: req.project.id }, isNew);
  };
  return {
    async list(req, res) {
      res.json({ calculations: await store.listCalculations(req.project.id) });
    },
    async get(req, res) {
      const calc = await store.getCalculation(req.project.id, validateId(req.params.calculationId, "calculationId"));
      if (!calc) throw notFound("Calculation");
      res.json({ calculation: calc });
    },
    // The browser may suggest an id (it already links records by id); it is only ever used inside this owner's project.
    async create(req, res) {
      const id = req.body?.id === undefined ? randomUUID() : validateId(req.body.id);
      if (await store.getCalculation(req.project.id, id)) throw new HttpError(409, "conflict", "A calculation with this id already exists.");
      res.status(201).json({ calculation: await save(req, id, true) });
    },
    // Updates the existing record in place (same id) and creates it if it does not exist yet, so saving is idempotent.
    async upsert(req, res) {
      const id = validateId(req.params.calculationId, "calculationId");
      const existing = await store.getCalculation(req.project.id, id);
      const calculation = await save(req, id, !existing);
      res.status(existing ? 200 : 201).json({ calculation });
    },
    async remove(req, res) {
      const id = validateId(req.params.calculationId, "calculationId");
      if (!(await store.getCalculation(req.project.id, id))) throw notFound("Calculation");
      await store.deleteCalculation(req.project.id, id);
      res.status(204).end();
    },
  };
}
