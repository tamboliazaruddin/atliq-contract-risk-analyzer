"use client";

import { useState } from "react";
import { CATEGORY_LABEL, fmtDateTime } from "@/lib/labels";
import type { Finding, Precedent, ReviewerAction, ReviewerActionKind } from "@/lib/types";
import { AiLabel, ConfidencePill, DocStatusChip, GroundedBadge, SEV_BAR, SeverityBadge, TypeTag } from "../ui";

const ACTION_STYLE: Record<ReviewerActionKind, { label: string; cls: string; done: string }> = {
  confirm: { label: "Confirm", cls: "border-emerald-300 text-emerald-700 hover:bg-emerald-50", done: "bg-emerald-600 text-white" },
  dismiss: { label: "Dismiss", cls: "border-slate-300 text-slate-700 hover:bg-slate-50", done: "bg-slate-600 text-white" },
  flag: { label: "Flag for verification", cls: "border-violet-300 text-violet-700 hover:bg-violet-50", done: "bg-violet-600 text-white" },
};

const TAG_LABEL: Record<string, string> = {
  standard: "Standard",
  deliberate_exception: "Deliberate exception",
  waved_through: "Waved through",
  walked_away: "Walked away",
  softened_for_counterparty: "Softened for vendor",
};

export function ActionBadge({ a }: { a?: ReviewerAction }) {
  if (!a) return <span className="text-[11px] text-slate-400">Unreviewed</span>;
  const s = ACTION_STYLE[a.action];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${s.done}`}>{a.action === "flag" ? "Flagged" : a.action === "confirm" ? "Confirmed" : "Dismissed"}</span>;
}

export function FindingCard({
  f,
  expanded,
  onToggle,
  action,
  onAction,
  onUndo,
  precedents,
  readOnly = false,
}: {
  f: Finding;
  expanded: boolean;
  onToggle: () => void;
  action?: ReviewerAction;
  onAction: (a: ReviewerActionKind, rationale: string) => void;
  onUndo: () => void;
  precedents: Precedent[];
  readOnly?: boolean;
}) {
  const [rationale, setRationale] = useState("");
  const precs = f.precedent_ids.map((id) => precedents.find((p) => p.id === id)).filter(Boolean) as Precedent[];
  const engine = f.source === "llm" ? "AI analysis" : f.source === "context" ? "Context alert (meeting notes)" : "Rule-based analysis";
  const unsure = f.confidence === "LOW" || !f.grounded;
  return (
    <div className={`overflow-hidden rounded-lg border bg-white transition ${expanded ? "border-brand-600 shadow-md" : "border-slate-200 hover:border-slate-300"} ${action?.action === "dismiss" ? "opacity-60" : ""}`}>
      <button onClick={onToggle} className="flex w-full items-stretch text-left">
        <span className={`w-1 shrink-0 ${SEV_BAR[f.severity]}`} />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge s={f.severity} />
            <TypeTag t={f.finding_type} gap={f.gap_kind} />
            <span className="text-[11px] text-slate-500">{CATEGORY_LABEL[f.category]}</span>
            <span className="ml-auto flex items-center gap-1.5">
              {!f.grounded && <GroundedBadge ok={false} />}
              <ActionBadge a={action} />
            </span>
          </div>
          <div className="mt-1 text-[13.5px] font-medium leading-snug text-slate-900">{f.title}</div>
          {!expanded && (
            <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
              <span className="font-mono text-[10.5px] text-slate-400">{f.contract_clause_ref}</span> · {f.explanation}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3 text-sm">
          <section>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contract clause · {f.contract_clause_ref}</span>
              <GroundedBadge ok={f.contract_quote_grounded} />
            </div>
            <blockquote className="contract-text rounded-md border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-[13px]">“{f.contract_quote}”</blockquote>
          </section>

          <section>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Why it matters to AtliQ</span>
              {f.source === "llm" ? <AiLabel /> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{engine}</span>}
            </div>
            <p className="leading-relaxed text-slate-700">{f.explanation}</p>
            {f.needs_info && (
              <p className="mt-1.5 rounded bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
                <strong>Still needed to confirm:</strong> {f.needs_info}
              </p>
            )}
          </section>

          {f.evidence.length > 0 && (
            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evidence</div>
              <ul className="space-y-2">
                {f.evidence.map((e, i) => (
                  <li key={i} className="rounded-md border border-slate-200 p-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium text-slate-800">{e.label ?? e.source_file}</span>
                      <DocStatusChip s={e.doc_status} />
                      <span className="ml-auto">
                        <GroundedBadge ok={e.grounded} />
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-slate-400">
                      {e.source_file} · {e.clause_ref}
                    </div>
                    <div className="contract-text mt-1 text-[12.5px]">“{e.quote}”</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {precs.length > 0 && (
            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">AtliQ precedent (history, not policy)</div>
              <ul className="space-y-1 text-xs text-slate-700">
                {precs.map((p) => (
                  <li key={p.id} className="flex gap-2">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${p.tag === "waved_through" ? "bg-red-50 text-red-700" : p.tag === "deliberate_exception" ? "bg-amber-50 text-amber-800" : p.tag === "walked_away" ? "bg-slate-200 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {TAG_LABEL[p.tag]}
                    </span>
                    <span>
                      <strong>{p.counterparty}</strong> ({p.date}): {p.atliq_agreed}
                      {p.outcome ? ` — ${p.outcome}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <ConfidencePill c={f.confidence} />
            {unsure && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">Not sure — please verify</span>}
          </div>

          {f.escalation_hints.length > 0 && (
            <section className="rounded-md bg-amber-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Escalation hints</div>
              <ul className="mt-0.5 list-disc pl-4 text-xs text-amber-900">
                {f.escalation_hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </section>
          )}

          {!readOnly && (
            <section className="border-t border-slate-100 pt-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reviewer action (human decision)</div>
              {action ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <ActionBadge a={action} />
                  <span>
                    by {action.by} · {fmtDateTime(action.at)}
                  </span>
                  {action.rationale && <span className="italic">“{action.rationale}”</span>}
                  <button onClick={onUndo} className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50">
                    Undo
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="Optional rationale (kept in the audit trail)"
                    className="h-14 w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-600"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(Object.keys(ACTION_STYLE) as ReviewerActionKind[]).map((k) => (
                      <button key={k} onClick={() => onAction(k, rationale)} className={`rounded-md border px-2.5 py-1 text-xs font-medium ${ACTION_STYLE[k].cls}`}>
                        {ACTION_STYLE[k].label}
                      </button>
                    ))}
                    <button disabled className="ml-auto cursor-not-allowed rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-400" title="Redlining is deferred (PRD §13.2)">
                      Suggest wording (later)
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
