import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Circle, Plus } from "lucide-react";
import { useLanguage } from "../i18n";
import { padIndex, type TotalRow } from "../utils/multiCalc";

export type SavedItem = {
  id: string;
  title: string;
  badge?: string;
  rows: [string, string][];
  // Present when the record tracks progress; drives the Completed / Ongoing badge.
  workStatus?: "ongoing" | "completed";
  preview?: ReactNode;
  details?: ReactNode;
};

type Props = {
  heading: string;
  items: SavedItem[];
  addLabel?: string;
  emptyText?: string;
  totals?: TotalRow[];
  totalsTitle?: string;
  // Accepted for older callers; every label now comes from the shared translation dictionary.
  labels?: unknown;
  confirmDelete?: (title: string) => string;
  onAdd?: () => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleStatus?: (id: string) => void;
  extraActions?: (id: string) => ReactNode;
};

export const actionButtonStyle = { minHeight: "44px", padding: "4px 12px", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600 } as const;

export function TotalsPanel({ title, totals, count }: { title: string; totals: TotalRow[]; count: number }) {
  const { t } = useLanguage();
  return <div style={{ marginTop: "16px", padding: "16px", background: "var(--card)", border: "1px solid var(--green)", borderRadius: "10px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "10px", flexWrap: "wrap" }}>
      <strong style={{ fontSize: "13px", letterSpacing: ".06em", textTransform: "uppercase" }}>{title}</strong>
      <small style={{ color: "var(--muted)" }}>{t("common.calculationsCount", { count })}</small>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
      {totals.map(row => <div key={`${row.label}-${row.value}`}>
        <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>{row.label}</small>
        <strong style={{ fontSize: "16px" }}>{row.value}</strong>
      </div>)}
    </div>
  </div>;
}

// In-app confirmation so the question and both buttons follow the selected language (window.confirm cannot).
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useLanguage();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return <div role="presentation" onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: "16px", zIndex: 1000 }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" onClick={e => e.stopPropagation()}
      style={{ width: "100%", maxWidth: "420px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px" }}>
      <h3 id="confirm-title" style={{ margin: "0 0 8px", fontSize: "17px" }}>{title}</h3>
      <p id="confirm-message" style={{ margin: "0 0 18px", color: "var(--muted)", fontSize: "14px", overflowWrap: "anywhere" }}>{message}</p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
        <button ref={cancelRef} type="button" className="btn btn-secondary" style={{ minHeight: "44px" }} onClick={onCancel}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" style={{ minHeight: "44px", background: "#B91C1C", borderColor: "#B91C1C" }} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}

// Shared list used by every calculator: numbered saved calculations with View / Edit / Duplicate / Delete and an add button.
export function WorkStatusBadge({ status }: { status?: "ongoing" | "completed" }) {
  const { t } = useLanguage();
  const done = status === "completed";
  return <small style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 700, color: done ? "var(--green)" : "var(--muted)", border: `1px solid ${done ? "var(--green)" : "var(--border)"}`, borderRadius: "999px", padding: "2px 9px" }}>
    {done ? <Check size={12} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}{t(done ? "status.completed" : "status.ongoing")}
  </small>;
}

export default function SavedCalculationList({ heading, items, addLabel, emptyText, totals, totalsTitle, confirmDelete, onAdd, onEdit, onDuplicate, onDelete, onToggleStatus, extraActions }: Props) {
  const { t } = useLanguage();
  const [viewing, setViewing] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedItem | null>(null);
  return <section style={{ marginTop: "24px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", marginBottom: "12px" }}>
      <h3 style={{ margin: 0, fontSize: "13px", letterSpacing: ".06em", textTransform: "uppercase" }}>{heading}</h3>
      <small style={{ color: "var(--muted)" }}>{items.length}</small>
    </div>
    {items.length === 0 && emptyText && <p style={{ color: "var(--muted)", fontSize: "13px" }}>{emptyText}</p>}
    <div style={{ display: "grid", gap: "12px" }}>
      {items.map((item, index) => <article key={item.id} style={{ padding: "16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", border: "1px solid var(--green)", borderRadius: "999px", padding: "2px 9px" }}>{padIndex(index)}</span>
            <strong style={{ overflowWrap: "anywhere" }}>{item.title}</strong>
            {item.badge && <small style={{ color: "var(--muted)", border: "1px solid var(--border)", borderRadius: "6px", padding: "2px 8px" }}>{item.badge}</small>}
            {onToggleStatus && <WorkStatusBadge status={item.workStatus} />}
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {item.details && <button type="button" style={actionButtonStyle} aria-expanded={viewing === item.id} aria-label={`${t("view")}: ${item.title}`} onClick={() => setViewing(viewing === item.id ? null : item.id)}>{viewing === item.id ? t("hide") : t("view")}</button>}
            <button type="button" style={actionButtonStyle} aria-label={`${t("edit")}: ${item.title}`} onClick={() => onEdit(item.id)}>{t("edit")}</button>
            <button type="button" style={actionButtonStyle} aria-label={`${t("duplicate")}: ${item.title}`} onClick={() => onDuplicate(item.id)}>{t("duplicate")}</button>
            {onToggleStatus && <button type="button" style={actionButtonStyle} aria-pressed={item.workStatus === "completed"} onClick={() => onToggleStatus(item.id)}>{t(item.workStatus === "completed" ? "status.markOngoing" : "status.markCompleted")}</button>}
            {extraActions?.(item.id)}
            <button type="button" style={actionButtonStyle} aria-label={`${t("delete")}: ${item.title}`} onClick={() => setPendingDelete(item)}>{t("delete")}</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginTop: "14px" }}>
          {item.rows.map(([label, value]) => <div key={label}>
            <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>{label}</small>
            <strong style={{ fontSize: "14px", overflowWrap: "anywhere" }}>{value}</strong>
          </div>)}
        </div>
        {item.preview && <div style={{ marginTop: "14px" }}>{item.preview}</div>}
        {viewing === item.id && item.details && <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border)" }}>{item.details}</div>}
      </article>)}
    </div>
    {totals && totals.length > 0 && items.length > 1 && <TotalsPanel title={totalsTitle ?? t("common.combinedTotals")} totals={totals} count={items.length} />}
    {onAdd && addLabel && <button type="button" className="btn btn-secondary" onClick={onAdd} style={{ width: "100%", marginTop: "16px", minHeight: "48px", height: "auto", whiteSpace: "normal" }}><Plus size={17} />{addLabel}</button>}
    {pendingDelete && <ConfirmDialog title={t("common.deleteTitle")} confirmLabel={t("delete")}
      message={confirmDelete ? confirmDelete(pendingDelete.title) : t("common.confirmDeleteNamed", { name: pendingDelete.title })}
      onCancel={() => setPendingDelete(null)}
      onConfirm={() => { if (viewing === pendingDelete.id) setViewing(null); onDelete(pendingDelete.id); setPendingDelete(null); }} />}
  </section>;
}
