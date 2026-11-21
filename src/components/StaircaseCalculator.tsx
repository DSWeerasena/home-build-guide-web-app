import { useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { CementWorksCalculation } from "../utils/calculators";
import { makeId } from "../utils/multiCalc";
import {
  buildStaircaseFromForm, cubicFeetToCubicMetres, formatCubicFeet, formatFeet, round2, round3, staircaseFormOf, staircaseResultRows,
  STAIRCASE_DEFAULT_FORM, type StairDimension, type StaircaseCalculation, type StaircaseFormState, type StairRawMeasure,
} from "../utils/staircase";
import { feetPerUnit, LENGTH_UNITS, type LengthUnit } from "../utils/units";
import StaircaseDiagram from "./StaircaseDiagram";

type Props = {
  initial: CementWorksCalculation | null;
  defaultName: string;
  t: (key: string) => string;
  onSave: (calc: CementWorksCalculation) => void;
  onBack: () => void;
};

type MeasureKey = "treadDepth" | "riserHeight" | "stairWidth" | "waistThickness" | "landingLength" | "landingWidth" | "landingThickness";

const box = { padding: "10px", minHeight: "44px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)" } as const;

// Shows "250 mm → 0.82 ft" under a field while the user types, without validating yet.
function livePreview(raw: StairRawMeasure): string | null {
  const value = Number(raw.value);
  if (raw.value.trim() === "" || !Number.isFinite(value) || !LENGTH_UNITS.includes(raw.unit as LengthUnit)) return null;
  return `${raw.value} ${raw.unit} → ${round3(value * feetPerUnit(raw.unit as LengthUnit))} ft`;
}

function conversionLine(label: string, d: StairDimension): string {
  if (d.unit === "ft") return `${label}: ${d.value} ft = ${round3(d.feet)} ft`;
  if (d.unit === "in") return `${label}: ${d.value} in ÷ 12 = ${round3(d.feet)} ft`;
  return `${label}: ${d.value} ${d.unit} × ${feetPerUnit(d.unit)} = ${round3(d.feet)} ft`;
}

export function StaircaseSummary({ calc, t }: { calc: StaircaseCalculation; t: (key: string) => string }) {
  const r = calc.results;
  const shown = (d: StairDimension) => d.unit === "ft" ? formatFeet(d.feet) : `${d.value} ${d.unit} (${formatFeet(d.feet)})`;
  const rows: [string, string][] = [
    [t("stair.numberOfTreads"), String(calc.numberOfTreads)],
    [t("stair.numberOfRisers"), String(calc.numberOfRisers)],
    [t("stair.treadDepth"), shown(calc.treadDepth)],
    [t("stair.riserHeight"), shown(calc.riserHeight)],
    [t("stair.stairWidth"), shown(calc.stairWidth)],
    [t("stair.waistThickness"), shown(calc.waistThickness)],
    ...(calc.landing ? [
      [t("stair.landingLength"), shown(calc.landing.length)],
      [t("stair.landingWidth"), shown(calc.landing.width)],
      [t("stair.landingThickness"), shown(calc.landing.thickness)],
      [t("stair.numberOfLandings"), String(calc.landing.count)],
    ] as [string, string][] : [[t("stair.landing"), t("no")] as [string, string]]),
    [t("stair.horizontalRun"), formatFeet(r.horizontalRunFt)],
    [t("stair.verticalRise"), formatFeet(r.verticalRiseFt)],
    [t("stair.slopeLength"), formatFeet(r.slopeLengthFt)],
    [t("stair.waistSlab"), formatCubicFeet(r.waistSlabVolumeFt3)],
    [t("stair.steps"), formatCubicFeet(r.stepVolumeFt3)],
    [t("stair.landings"), formatCubicFeet(r.landingVolumeFt3)],
    [t("stair.totalConcrete"), formatCubicFeet(r.totalConcreteFt3)],
  ];
  return <div style={{ display: "grid", gap: "6px" }}>
    {rows.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px" }}><span style={{ color: "var(--muted)" }}>{k}</span><strong style={{ textAlign: "right" }}>{v}</strong></div>)}
  </div>;
}

export default function StaircaseCalculator({ initial, defaultName, t, onSave, onBack }: Props) {
  const [form, setForm] = useState<StaircaseFormState>(() => initial?.staircase ? { ...staircaseFormOf(initial.staircase), name: initial.name } : STAIRCASE_DEFAULT_FORM);
  const [error, setError] = useState("");
  const formKey = JSON.stringify(form);
  const [computed, setComputed] = useState<{ key: string; calc: StaircaseCalculation } | null>(() => {
    if (!initial?.staircase) return null;
    const run = buildStaircaseFromForm(form, initial.id, initial.name);
    return "calc" in run ? { key: formKey, calc: run.calc } : null;
  });
  const calc = computed && computed.key === formKey ? computed.calc : null;

  const setMeasure = (key: MeasureKey, patch: Partial<StairRawMeasure>) => setForm(f => ({ ...f, [key]: { ...f[key], ...patch } }));
  const name = () => form.name.trim() || initial?.name || defaultName;

  const handleCalculate = () => {
    const run = buildStaircaseFromForm(form, initial?.id ?? makeId(), name());
    if ("error" in run) { setError(t(run.error)); return; }
    setError("");
    setComputed({ key: formKey, calc: run.calc });
  };

  const handleSave = () => {
    if (!calc) return;
    const finalName = name();
    const staircase = { ...calc, name: finalName };
    onSave({ id: staircase.id, name: finalName, category: "staircase", results: staircaseResultRows(staircase), staircase });
  };

  const measureField = (key: MeasureKey, labelKey: string) => {
    const raw = form[key];
    const preview = livePreview(raw);
    return <label key={key}>
      <span>{t(labelKey)}</span>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <input type="number" min="0" step="any" inputMode="decimal" value={raw.value} onChange={e => setMeasure(key, { value: e.target.value })} style={{ ...box, flex: "1 1 120px", minWidth: 0 }} />
        <select aria-label={`${t(labelKey)} – unit`} value={raw.unit} onChange={e => setMeasure(key, { unit: e.target.value })} style={{ ...box, flex: "1 1 130px" }}>
          {LENGTH_UNITS.map(u => <option key={u} value={u}>{t(`unit.${u}`)} ({u})</option>)}
        </select>
      </div>
      {preview && <small style={{ color: "var(--muted)" }}>{preview}</small>}
    </label>;
  };

  const countField = (key: "numberOfTreads" | "numberOfRisers" | "numberOfLandings", labelKey: string) =>
    <label key={key}><span>{t(labelKey)}</span><input type="number" min="1" step="1" inputMode="numeric" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={{ ...box, width: "100%" }} /></label>;

  const sectionTitle = (text: string) => <p style={{ fontSize: "13px", fontWeight: 600, margin: "20px 0 12px" }}>{text.toUpperCase()}</p>;
  const toggle = (on: boolean, label: string) => <button type="button" aria-pressed={form.hasLanding === on} onClick={() => setForm(f => ({ ...f, hasLanding: on }))}
    style={{ ...box, minWidth: "88px", cursor: "pointer", fontWeight: 600, background: form.hasLanding === on ? "var(--green)" : "var(--card)", color: form.hasLanding === on ? "#0F1712" : "var(--text)" }}>{label}</button>;

  const steps: [string, ReactNode[]][] = calc ? (() => {
    const r = calc.results;
    const L = calc.landing;
    return [
      [t("stair.step1"), [
        conversionLine(t("stair.treadDepth"), calc.treadDepth),
        conversionLine(t("stair.riserHeight"), calc.riserHeight),
        conversionLine(t("stair.stairWidth"), calc.stairWidth),
        conversionLine(t("stair.waistThickness"), calc.waistThickness),
        ...(L ? [conversionLine(t("stair.landingLength"), L.length), conversionLine(t("stair.landingWidth"), L.width), conversionLine(t("stair.landingThickness"), L.thickness)] : []),
      ]],
      [t("stair.step2"), [`${t("stair.numberOfTreads")} × ${t("stair.treadDepth")}`, `${calc.numberOfTreads} × ${round3(calc.treadDepth.feet)} = ${formatFeet(r.horizontalRunFt)}`]],
      [t("stair.step3"), [`${t("stair.numberOfRisers")} × ${t("stair.riserHeight")}`, `${calc.numberOfRisers} × ${round3(calc.riserHeight.feet)} = ${formatFeet(r.verticalRiseFt)}`]],
      [t("stair.step4"), [`√(${round3(r.horizontalRunFt)}² + ${round3(r.verticalRiseFt)}²) = ${formatFeet(r.slopeLengthFt)}`]],
      [t("stair.step5"), [`${t("stair.slopeLength")} × ${t("stair.stairWidth")} × ${t("stair.waistThickness")}`, `${round3(r.slopeLengthFt)} × ${round3(calc.stairWidth.feet)} × ${round3(calc.waistThickness.feet)} = ${formatCubicFeet(r.waistSlabVolumeFt3)}`]],
      [t("stair.step6"), [`0.5 × ${t("stair.treadDepth")} × ${t("stair.riserHeight")} × ${t("stair.stairWidth")} × ${t("stair.numberOfTreads")}`, `0.5 × ${round3(calc.treadDepth.feet)} × ${round3(calc.riserHeight.feet)} × ${round3(calc.stairWidth.feet)} × ${calc.numberOfTreads} = ${formatCubicFeet(r.stepVolumeFt3)}`]],
      [t("stair.step7"), L
        ? [`${t("stair.landingLength")} × ${t("stair.landingWidth")} × ${t("stair.landingThickness")} × ${t("stair.numberOfLandings")}`, `${round3(L.length.feet)} × ${round3(L.width.feet)} × ${round3(L.thickness.feet)} × ${L.count} = ${formatCubicFeet(r.landingVolumeFt3)}`]
        : [t("stair.noLanding")]],
      [t("stair.step8"), [`${t("stair.waistSlab")} + ${t("stair.steps")} + ${t("stair.landings")}`, `${round2(r.waistSlabVolumeFt3)} + ${round2(r.stepVolumeFt3)} + ${round2(r.landingVolumeFt3)} = ${formatCubicFeet(r.totalConcreteFt3)}`]],
    ];
  })() : [];

  const resultCard = (labelKey: string, value: number) => <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", padding: "14px", textAlign: "center" }}>
    <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px" }}>{t(labelKey).toUpperCase()}</div>
    <div style={{ fontSize: "20px", fontWeight: 700 }}>{formatCubicFeet(value)}</div>
  </div>;

  return <div className="content-wrap">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> {t("back")}</button>
    <div className="content-heading"><span className="eyebrow"><span />{t("cement-works").toUpperCase()} › {t("stair.short").toUpperCase()}</span><h2>{initial ? t("stair.editTitle") : t("stair.title")}</h2><p>{t("stair.intro")}</p></div>
    <div className="assumption" style={{ marginBottom: "16px" }}><span>{t("stair.scope")} {t("stair.method")}</span></div>
    <div className="calculator-panel">
      {error && <div role="alert" style={{ padding: "12px", background: "#8B3838", borderRadius: "6px", marginBottom: "12px", color: "#FFE5E5", fontSize: "13px" }}>{error}</div>}
      <label><span>{t("stair.calcName")}</span><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={defaultName} style={{ ...box, width: "100%" }} /></label>

      {sectionTitle(t("stair.dimensions"))}
      <div className="form-grid">
        {countField("numberOfTreads", "stair.numberOfTreads")}
        {countField("numberOfRisers", "stair.numberOfRisers")}
        {measureField("treadDepth", "stair.treadDepth")}
        {measureField("riserHeight", "stair.riserHeight")}
        {measureField("stairWidth", "stair.stairWidth")}
        {measureField("waistThickness", "stair.waistThickness")}
      </div>

      {sectionTitle(t("stair.landing"))}
      <p style={{ margin: "0 0 8px", fontSize: "13px" }}>{t("stair.hasLanding")}</p>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>{toggle(true, t("yes"))}{toggle(false, t("no"))}</div>
      {form.hasLanding && <div className="form-grid">
        {measureField("landingLength", "stair.landingLength")}
        {measureField("landingWidth", "stair.landingWidth")}
        {measureField("landingThickness", "stair.landingThickness")}
        {countField("numberOfLandings", "stair.numberOfLandings")}
      </div>}

      <button className="btn btn-primary btn-lg" onClick={handleCalculate} style={{ width: "100%", marginTop: "20px" }}>{t("stair.calculate")}</button>
    </div>

    {calc && <div style={{ marginTop: "28px" }}>
      <div style={{ background: "var(--surface)", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
        <h3 style={{ marginBottom: "12px", fontSize: "15px", fontWeight: 600 }}>{t("stair.estimate").toUpperCase()}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "12px" }}>
          {resultCard("stair.waistSlab", calc.results.waistSlabVolumeFt3)}
          {resultCard("stair.steps", calc.results.stepVolumeFt3)}
          {resultCard("stair.landings", calc.results.landingVolumeFt3)}
        </div>
        <div style={{ background: "var(--soft-green, #183424)", border: "2px solid var(--green)", borderRadius: "10px", padding: "18px", textAlign: "center" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "1px", color: "var(--green)" }}>{t("stair.totalConcrete").toUpperCase()}</div>
          <div style={{ fontSize: "32px", fontWeight: 800, margin: "4px 0" }}>{formatCubicFeet(calc.results.totalConcreteFt3)}</div>
          <small style={{ color: "var(--muted)" }}>≈ {round2(cubicFeetToCubicMetres(calc.results.totalConcreteFt3))} m³</small>
        </div>
      </div>
      <StaircaseDiagram calc={calc} t={t} />
      <div style={{ background: "var(--surface)", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
        <h3 style={{ marginBottom: "16px", fontSize: "14px", fontWeight: 600 }}>{t("stair.process").toUpperCase()}</h3>
        <div style={{ fontSize: "12px", color: "var(--muted)", display: "grid", gap: "12px", overflowWrap: "anywhere" }}>
          {steps.map(([title, lines], i) => <div key={title}>
            <div style={{ fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>{t("stair.step")} {i + 1} · {title}</div>
            {lines.map((line, j) => <div key={j}>{line}</div>)}
          </div>)}
        </div>
      </div>
      <button className="btn btn-primary" style={{ width: "100%", minHeight: "44px" }} onClick={handleSave}>{initial ? t("stair.saveChanges") : t("stair.save")}</button>
    </div>}
  </div>;
}
