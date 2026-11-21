import { formatFeet, round3, type StaircaseCalculation } from "../utils/staircase";

// A quantity illustration only: it explains run, rise, slope, tread and riser.
// It is not a structural drawing and says nothing about reinforcement.
export default function StaircaseDiagram({ calc, t }: { calc: StaircaseCalculation; t: (key: string) => string }) {
  const { numberOfTreads, numberOfRisers, results } = calc;
  const treadFt = calc.treadDepth.feet;
  const riserFt = calc.riserHeight.feet;

  const width = 620;
  const height = 268;
  const leftPad = 58;
  const rightPad = 30;
  const topPad = 34;
  const bottomPad = 60;
  const plotWidth = width - leftPad - rightPad;
  const plotHeight = height - topPad - bottomPad;

  const runFt = Math.max(results.horizontalRunFt, 1e-6);
  const riseFt = Math.max(results.verticalRiseFt, 1e-6);
  const scale = Math.min(plotWidth / runFt, plotHeight / riseFt);
  const stepWidth = treadFt * scale;
  const stepHeight = riserFt * scale;
  const x0 = leftPad;
  const y0 = topPad + plotHeight;

  // Alternate riser (up) and tread (right); the first riser sits at the bottom left.
  const outline: string[] = [`${x0},${y0}`];
  let x = x0;
  let y = y0;
  for (let i = 0; i < Math.max(numberOfTreads, numberOfRisers); i += 1) {
    if (i < numberOfRisers) {
      y -= stepHeight;
      outline.push(`${round3(x)},${round3(y)}`);
    }
    if (i < numberOfTreads) {
      x += stepWidth;
      outline.push(`${round3(x)},${round3(y)}`);
    }
  }

  const topX = x;
  const topY = y;
  const label = { fill: "var(--muted)", fontSize: "11px", fontFamily: "Inter, 'Noto Sans Sinhala', sans-serif" } as const;
  const firstTreadMidX = x0 + stepWidth / 2;
  const firstRiserMidY = y0 - stepHeight / 2;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "14px", marginBottom: "20px" }}>
      <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>{t("stair.diagram")}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={t("stair.diagram")}>
        {/* waist slab slope */}
        <line x1={x0} y1={y0} x2={topX} y2={topY} stroke="var(--green)" strokeWidth={2} strokeDasharray="6 4" />
        {/* step outline */}
        <polyline points={outline.join(" ")} fill="none" stroke="var(--highlight, #4ADE80)" strokeWidth={2.5} strokeLinejoin="round" />
        {/* run and rise base lines */}
        <line x1={x0} y1={y0} x2={topX} y2={y0} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" />
        <line x1={x0} y1={y0} x2={x0} y2={topY} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" />

        {/* run dimension */}
        <line x1={x0} y1={y0 + 42} x2={topX} y2={y0 + 42} stroke="var(--muted)" strokeWidth={1} />
        <line x1={x0} y1={y0 + 38} x2={x0} y2={y0 + 46} stroke="var(--muted)" strokeWidth={1} />
        <line x1={topX} y1={y0 + 38} x2={topX} y2={y0 + 46} stroke="var(--muted)" strokeWidth={1} />
        <text x={(x0 + topX) / 2} y={y0 + 56} textAnchor="middle" style={label}>{t("stair.horizontalRun")} · {formatFeet(results.horizontalRunFt)}</text>

        {/* rise dimension */}
        <line x1={x0 - 26} y1={y0} x2={x0 - 26} y2={topY} stroke="var(--muted)" strokeWidth={1} />
        <line x1={x0 - 30} y1={y0} x2={x0 - 22} y2={y0} stroke="var(--muted)" strokeWidth={1} />
        <line x1={x0 - 30} y1={topY} x2={x0 - 22} y2={topY} stroke="var(--muted)" strokeWidth={1} />
        <text x={x0 - 34} y={(y0 + topY) / 2} textAnchor="middle" transform={`rotate(-90 ${x0 - 34} ${(y0 + topY) / 2})`} style={label}>{t("stair.verticalRise")} · {formatFeet(results.verticalRiseFt)}</text>

        {/* tread and riser labels on the first step */}
        {stepWidth > 26 && <text x={firstTreadMidX} y={y0 + 16} textAnchor="middle" style={{ ...label, fill: "var(--green)" }}>{t("stair.tread")}</text>}
        {stepHeight > 16 && <text x={x0 - 8} y={firstRiserMidY} textAnchor="end" style={{ ...label, fill: "var(--green)" }}>{t("stair.riser")}</text>}

        {/* slope label */}
        <text x={(x0 + topX) / 2 + 12} y={(y0 + topY) / 2 - 12} textAnchor="middle" style={{ ...label, fill: "var(--green)" }}>{t("stair.slope")} · {formatFeet(results.slopeLengthFt)}</text>

        {/* Width cannot be drawn in a side view, so it is stated in the caption with the waist thickness. */}
        <text x={leftPad} y={16} style={label}>{t("stair.width")} · {formatFeet(calc.stairWidth.feet)}   ·   {t("stair.waistThickness")} · {formatFeet(calc.waistThickness.feet)}</text>
      </svg>
      <small style={{ display: "block", color: "var(--muted)", marginTop: "6px" }}>{t("stair.diagramNote")}</small>
    </div>
  );
}
