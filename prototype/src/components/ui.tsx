import type { ReactNode } from "react";
import { CHECK_LABEL, DOC_STATUS_LABEL, SEVERITY_LABEL, TYPE_LABEL } from "@/lib/labels";
import type { CheckStatus, Confidence, DocStatus, FindingType, Severity } from "@/lib/types";

export const SEV_STYLE: Record<Severity, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-amber-400 text-amber-950",
  LOW: "bg-slate-200 text-slate-700",
};
export const SEV_SOFT: Record<Severity, string> = {
  CRITICAL: "border-red-200 bg-red-50 text-red-800",
  HIGH: "border-orange-200 bg-orange-50 text-orange-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-900",
  LOW: "border-slate-200 bg-slate-50 text-slate-700",
};
export const SEV_BAR: Record<Severity, string> = { CRITICAL: "bg-red-600", HIGH: "bg-orange-500", MEDIUM: "bg-amber-400", LOW: "bg-slate-400" };

export function SeverityBadge({ s, className = "" }: { s: Severity; className?: string }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${SEV_STYLE[s]} ${className}`}>{SEVERITY_LABEL[s]}</span>;
}

export function CountBadges({ counts, compact = false }: { counts: Record<Severity, number>; compact?: boolean }) {
  const items = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Severity[]).filter((s) => counts[s] > 0 && (!compact || s === "CRITICAL" || s === "HIGH"));
  if (!items.length) return <span className="text-xs text-slate-400">{compact ? "No Critical/High" : "No findings"}</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map((s) => (
        <span key={s} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${SEV_STYLE[s]}`} title={SEVERITY_LABEL[s]}>
          {counts[s]} {compact ? SEVERITY_LABEL[s][0] : SEVERITY_LABEL[s]}
        </span>
      ))}
    </span>
  );
}

const TYPE_STYLE: Record<FindingType, string> = {
  POTENTIAL_RISK: "border-slate-300 text-slate-700 bg-white",
  HISTORICAL_CONFLICT: "border-fuchsia-300 text-fuchsia-800 bg-fuchsia-50",
  DOCUMENT_GAP: "border-sky-300 text-sky-800 bg-sky-50",
  UNRESOLVED_QUESTION: "border-violet-300 text-violet-800 bg-violet-50",
};

export function TypeTag({ t, gap }: { t: FindingType; gap?: "confirmed" | "potential" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_STYLE[t]}`}>
      {TYPE_LABEL[t]}
      {t === "DOCUMENT_GAP" && gap ? ` · ${gap}` : ""}
    </span>
  );
}

const CHECK_STYLE: Record<CheckStatus, { icon: string; cls: string }> = {
  passed: { icon: "✓", cls: "bg-emerald-100 text-emerald-700" },
  flagged: { icon: "✗", cls: "bg-red-100 text-red-700" },
  could_not_verify: { icon: "?", cls: "bg-violet-100 text-violet-700" },
  not_applicable: { icon: "–", cls: "bg-slate-100 text-slate-400" },
};

export function CheckIcon({ s }: { s: CheckStatus }) {
  const st = CHECK_STYLE[s];
  return (
    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${st.cls}`} title={CHECK_LABEL[s]}>
      {st.icon}
    </span>
  );
}

export function GroundedBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700" title="Quote found word-for-word in the source">
      ✓ Verified in source
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800" title="Quote could not be found word-for-word in the source">
      ⚠ Not verified
    </span>
  );
}

const DOC_STYLE: Partial<Record<DocStatus, string>> = {
  signed_active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  signed_expiring: "bg-amber-50 text-amber-800 border-amber-200",
  signed_expired: "bg-slate-100 text-slate-500 border-slate-200",
  signed_spent: "bg-slate-100 text-slate-500 border-slate-200",
  draft_in_review: "bg-sky-50 text-sky-700 border-sky-200",
  negotiation_note: "bg-violet-50 text-violet-700 border-violet-200",
  meeting_note: "bg-violet-50 text-violet-700 border-violet-200",
  tracker_note: "bg-slate-50 text-slate-600 border-slate-200",
};

export function DocStatusChip({ s }: { s: DocStatus }) {
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${DOC_STYLE[s] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}>{DOC_STATUS_LABEL[s]}</span>;
}

export function ConfidencePill({ c }: { c: Confidence }) {
  const cls = c === "HIGH" ? "text-emerald-700 bg-emerald-50" : c === "MEDIUM" ? "text-amber-800 bg-amber-50" : "text-violet-800 bg-violet-100";
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>Confidence: {c[0] + c.slice(1).toLowerCase()}</span>;
}

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ${className}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function AiLabel() {
  return <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">AI analysis</span>;
}
