import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { convertResultValue, type CementWorksCalculation, type UnitType } from "../utils/calculators";
import { buildCementCalculation, initialFieldState, runCategory, type CategoryConfig, type CategoryOutput, type FieldUnit, type ValidationMessage } from "../utils/cementCategories";
import { makeId } from "../utils/multiCalc";
import { DEFAULT_VOLUME_UNIT, displayVolume, isVolumeUnit, VOLUME_UNITS, type VolumeUnit } from "../utils/quantities";
import { AREA_UNITS } from "../utils/units";
import { useLanguage } from "../i18n";

type Props = {
  config: CategoryConfig;
  initial: CementWorksCalculation | null;
  defaultName: string;
  onSave: (calc: CementWorksCalculation) => void;
  onBack: () => void;
};

const UNIT_ORDER: UnitType[] = ["mm", "m", "inch", "foot", "cubic_feet", "cubic_inches"];
const LENGTH_UNIT_ORDER: UnitType[] = ["mm", "cm", "m", "inch", "foot"];
const box = { padding: "8px", minHeight: "44px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)" } as const;

// One form for every cement-works category; the fields and formulas come from the category config.
export default function CementCalculatorForm({ config, initial, defaultName, onSave, onBack }: Props) {
  const { t, tl, tn, tv } = useLanguage();
  const [values, setValues] = useState(() => initialFieldState(config, initial).values);
  const [units, setUnits] = useState(() => initialFieldState(config, initial).units);
  const [name, setName] = useState(initial?.name ?? "");
  const [resultUnit, setResultUnit] = useState<UnitType>("m");
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>(initial?.outputUnit && isVolumeUnit(initial.outputUnit) ? initial.outputUnit : DEFAULT_VOLUME_UNIT);
  const [error, setError] = useState<ValidationMessage | null>(null);

  // Results are only shown while they match the current inputs, so Save can never store stale numbers.
  const inputKey = JSON.stringify([values, units]);
  const [computed, setComputed] = useState<{ key: string; output: CategoryOutput } | null>(() => {
    if (!initial) return null;
    const run = runCategory(config, values, units);
    return "output" in run ? { key: inputKey, output: run.output } : null;
  });
  const output = computed && computed.key === inputKey ? computed.output : null;
  const cat = (field: string) => t(`cat.${config.id}.${field}`);
  // Categories with a volume picker show Cubes / ft³ / m³; the others keep the older result selector.
  const shown = (value: string) => config.volumeOutput ? tv(displayVolume(value, volumeUnit, u => t(`volSym.${u}`))) : tv(convertResultValue(value, "m", resultUnit));

  const handleCalculate = () => {
    const run = runCategory(config, values, units);
    if ("error" in run) { setError(run.error); return; }
    setError(null);
    setComputed({ key: inputKey, output: run.output });
  };

  const handleSave = () => {
    if (!output) return;
    const calc = buildCementCalculation(config, { id: initial?.id ?? makeId(), name: name.trim() || initial?.name || defaultName, values, units, output });
    onSave(config.volumeOutput ? { ...calc, outputUnit: volumeUnit } : calc);
  };

  const backButton = <button className="back-link" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> {t("back")}</button>;
  if (config.unavailable) return <div className="content-wrap">
    {backButton}
    <p>{config.unavailable}</p>
  </div>;

  const unitSelect = (key: string, label: string, options: readonly string[], optionLabel: (u: string) => string) =>
    <select aria-label={`${tl(label)} – ${t("common.unit")}`} value={units[key]} onChange={e => setUnits({ ...units, [key]: e.target.value as FieldUnit })} style={{ ...box, flex: "1 1 140px" }}>
      {(options.includes(units[key]) ? options : [...options, units[key]]).map(u => <option key={u} value={u}>{optionLabel(u)}</option>)}
    </select>;
  const numberInput = (key: string, label: string) => <label style={{ flex: "1 1 160px" }}><span>{tl(label)}</span><input type="number" min="0" step="any" value={values[key]} onChange={e => setValues({ ...values, [key]: Number(e.target.value) })} style={{ ...box, width: "100%" }} /></label>;

  return <div className="content-wrap">
    {backButton}
    <div className="content-heading"><h2>{initial ? t("cat.editTitle", { what: cat("singular") }) : cat("heading")}</h2><p>{cat("subheading")}</p></div>
    {config.id === "plastering" && <p style={{ fontSize: "13px", color: "var(--muted)" }}>{t("label.Mix Ratio")}: <strong style={{ color: "var(--text)" }}>1 : 5</strong> ({tn("Cement : Sand")})</p>}
    {error && <div role="alert" style={{ padding: "12px", background: "#8B3838", borderRadius: "6px", marginBottom: "12px", color: "#FFE5E5", fontSize: "13px" }}>{t(error.key, { field: error.field ? tl(error.field) : "" })}</div>}
    <div style={{ marginBottom: "20px", display: "grid", gap: "12px" }}>
      <label><span>{t("common.calcName")}</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={cat("namePh")} style={{ ...box, width: "100%" }} /></label>
      {config.fields.map(f => f.kind === "select"
        ? <label key={f.key}><span>{tl(f.label)}</span><select value={String(values[f.key])} onChange={e => setValues({ ...values, [f.key]: e.target.value })} style={box}>{f.options.map(o => <option key={o.value} value={o.value}>{tl(o.label)}</option>)}</select></label>
        : f.kind === "dimension"
          ? <div key={f.key} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
            {numberInput(f.key, f.label)}
            {unitSelect(f.key, f.label, LENGTH_UNIT_ORDER, u => t(`unitType.${u}`))}
          </div>
          : f.kind === "area"
            ? <div key={f.key} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
              {numberInput(f.key, f.label)}
              {unitSelect(f.key, f.label, AREA_UNITS, u => u)}
            </div>
            : <label key={f.key}><span>{tl(f.label)}</span><input type="number" value={values[f.key]} onChange={e => setValues({ ...values, [f.key]: Number(e.target.value) })} style={{ ...box, width: "100%" }} /></label>)}
    </div>
    <button onClick={handleCalculate} className="btn btn-primary" style={{ marginBottom: "20px", width: "100%" }}>{t("common.calculateMaterials")}</button>
    {output && <div>
      <div style={{ padding: "16px", background: "var(--surface)", borderRadius: "8px", marginBottom: "16px" }}>
        {config.volumeOutput
          ? <label style={{ display: "block", marginBottom: "12px" }}><span style={{ fontSize: "12px", color: "var(--muted)" }}>{t("vol.showIn")}</span><select value={volumeUnit} onChange={e => setVolumeUnit(isVolumeUnit(e.target.value) ? e.target.value : DEFAULT_VOLUME_UNIT)} style={{ ...box, width: "100%", marginTop: "4px", background: "var(--bg)" }}>{VOLUME_UNITS.map(u => <option key={u} value={u}>{t(`vol.${u}`)}</option>)}</select></label>
          : <label style={{ display: "block", marginBottom: "12px" }}><span style={{ fontSize: "12px", color: "var(--muted)" }}>{t("common.displayResultsIn")}</span><select value={resultUnit} onChange={e => setResultUnit(e.target.value as UnitType)} style={{ ...box, width: "100%", marginTop: "4px", background: "var(--bg)" }}>{UNIT_ORDER.map(u => <option key={u} value={u}>{t(`unitType.${u}`)}</option>)}</select></label>}
        {output.results.map((r, i) => r.value === ""
          ? <div key={i} style={{ fontSize: "12px", fontWeight: 600, marginTop: "10px" }}>{tl(r.label)}</div>
          : <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: "13px" }}>
            <span>{tl(r.label)}{r.note && <small style={{ display: "block", color: "var(--muted)" }}>{tn(r.note)}</small>}</span>
            <strong style={{ textAlign: "right" }}>{shown(r.value)}</strong>
          </div>)}
      </div>
      <button onClick={handleSave} className="btn btn-primary" style={{ width: "100%", minHeight: "44px" }}>{initial ? t("common.saveChanges") : t("common.saveCalculation")}</button>
    </div>}
  </div>;
}
