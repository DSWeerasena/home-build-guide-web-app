// Report data always comes from the latest saved records, grouped by construction stage.
export function reportsController({ store }) {
  return {
    async get(req, res) {
      const [calculations, plans] = await Promise.all([store.listCalculations(req.project.id), store.listPlans(req.project.id)]);
      const stages = { foundation: [], brickwork: [], "cement-works": [] };
      for (const calc of calculations) (stages[calc.stage] ||= []).push(calc);
      res.json({
        project: req.project,
        stages,
        plans: plans.map(({ planId, fileName, contentType, uploadedAt, analysisStatus }) => ({ planId, fileName, contentType, uploadedAt, analysisStatus })),
        counts: Object.fromEntries(Object.entries(stages).map(([stage, list]) => [stage, list.length])),
        generatedAt: new Date().toISOString(),
      });
    },
  };
}
