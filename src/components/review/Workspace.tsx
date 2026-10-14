"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { logAudit, reviewerName, useDecisions, useFindingActions, useLifecycle } from "@/lib/client/store";
import { ENTITY_LABEL, LIFECYCLE, type Lifecycle } from "@/lib/labels";
import type { Clause, Finding, Precedent, ReviewResult } from "@/lib/types";
import { Chip, CountBadges } from "../ui";
import { ContractPane } from "./ContractPane";
import { ChecksTab, CommitmentsTab, DecisionTab, FindingsTab, type RegisterSummary, SummaryTab } from "./Tabs";

const TABS = ["Summary", "Findings", "Commitments", "Checks", "Decision"] as const;
type Tab = (typeof TABS)[number];

export function Workspace({
  review,
  clauses,
  provenance,
  precedents,
  register,
  lifecycleInitial,
  dealNote,
  versionsUi,
  onOpenSetup,
}: {
  review: ReviewResult;
  clauses: Clause[];
  provenance: string | null;
  precedents: Precedent[];
  register: RegisterSummary[];
  lifecycleInitial: Lifecycle;
  dealNote: string;
  versionsUi: React.ReactNode;
  onOpenSetup: (() => void) | null;
}) {
  const r = review;
  const [tab, setTab] = useState<Tab>("Findings");
  const [selected, setSelected] = useState<Finding | null>(null);
  const { actions, record, undo } = useFindingActions(r.review_id, r.contract_id, r.version);
  const [decisions, setDecisions] = useDecisions(r.contract_id);
  const [status, setStatus] = useLifecycle(r.contract_id, lifecycleInitial);

  useEffect(() => setSelected(null), [r.review_id]);

  const selectClause = (clauseId: string) => {
    const f = r.findings.find((x) => x.contract_clause_id === clauseId);
    if (f) {
      setSelected(f);
      setTab("Findings");
    }
  };
  const jump = (clauseId: string) => {
    const el = document.getElementById(clauseId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("clause-hl-LOW");
    setTimeout(() => el?.classList.remove("clause-hl-LOW"), 1600);
  };
  const reviewed = r.findings.filter((f) => actions[f.id]).length;

  return (
    <div className="flex h-[calc(100vh-29px)] flex-col">
      {/* header */}
      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Link href="/" className="hover:text-slate-800">
                Review queue
              </Link>
              <span>/</span>
              <span>{r.contract_id}</span>
            </div>
            <h1 className="mt-0.5 truncate text-base font-semibold text-slate-900">
              {r.counterparty} — {r.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Chip>{r.config.contract_type}</Chip>
              <Chip>{ENTITY_LABEL[r.config.atliq_entity]}</Chip>
              <Chip>AtliQ as {r.config.atliq_role}</Chip>
              <Chip>{r.config.counterparty_country}</Chip>
              <span className="mx-1 text-slate-300">|</span>
              <CountBadges counts={r.counts} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {versionsUi}
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as Lifecycle)} className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800">
                {LIFECYCLE.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {onOpenSetup && (
              <button onClick={onOpenSetup} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                Review setup / Re-review
              </button>
            )}
            <Link href={`/review/${r.contract_id}/report${r.version > 1 || r.contract_id.startsWith("U-") ? `?v=${r.version}` : ""}`} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Export report
            </Link>
          </div>
        </div>
        {!r.in_scope ? (
          <div className="mt-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <strong>Out of MVP scope.</strong> {r.out_of_scope_reason} Only fact checks were run — this is not a review of the agreement.
          </div>
        ) : r.completeness === "incomplete" ? (
          <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
            <strong>Incomplete review — do not treat as clean.</strong>{" "}
            {r.completeness_notes.slice(0, 2).join(" · ")}
            {r.completeness_notes.length > 2 ? ` · +${r.completeness_notes.length - 2} more (see Checks)` : ""}
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900">
            First-pass review complete ({r.findings.length} findings, {reviewed} reviewed by you). Absence of a finding does not prove a clause is safe.
          </div>
        )}
      </div>

      {/* split view */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 basis-[58%] border-r border-slate-200">
          <ContractPane title={r.title} provenance={provenance} clauses={clauses} findings={r.findings} selected={selected} onSelectClause={selectClause} />
        </div>
        <div className="flex min-w-0 basis-[42%] flex-col bg-slate-50">
          <div className="flex border-b border-slate-200 bg-white px-2">
            {TABS.map((t) => {
              const badge =
                t === "Findings" ? r.findings.length : t === "Commitments" ? r.findings.filter((f) => f.finding_type === "HISTORICAL_CONFLICT").length : t === "Checks" ? r.checks.filter((c) => c.status === "flagged" || c.status === "could_not_verify").length : null;
              return (
                <button key={t} onClick={() => setTab(t)} className={`relative px-3 py-2.5 text-sm ${tab === t ? "font-semibold text-brand-700" : "text-slate-600 hover:text-slate-900"}`}>
                  {t}
                  {badge ? <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{badge}</span> : null}
                  {tab === t && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-brand-600" />}
                </button>
              );
            })}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "Summary" && <SummaryTab r={r} onJump={jump} dealNote={dealNote} />}
            {tab === "Findings" && (
              <FindingsTab
                r={r}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                actions={actions}
                onAction={(f, a, rat) => record(f.id, a, rat, f.title)}
                onUndo={(f) => undo(f.id, f.title)}
                precedents={precedents}
              />
            )}
            {tab === "Commitments" && (
              <CommitmentsTab
                r={r}
                register={register}
                onSelect={(f) => {
                  setSelected(f);
                  setTab("Findings");
                }}
              />
            )}
            {tab === "Checks" && <ChecksTab r={r} />}
            {tab === "Decision" && (
              <DecisionTab
                r={r}
                actions={actions}
                decisions={decisions}
                reportHref={`/review/${r.contract_id}/report${r.version > 1 || r.contract_id.startsWith("U-") ? `?v=${r.version}` : ""}`}
                onDecide={(d, rationale) => {
                  const dec = {
                    decision: d,
                    rationale,
                    by: reviewerName(),
                    at: new Date().toISOString(),
                    review_id: r.review_id,
                    version: r.version,
                    open_critical: r.findings.filter((f) => f.severity === "CRITICAL" && !actions[f.id]).length,
                    unreviewed: r.findings.filter((f) => !actions[f.id]).length,
                  };
                  setDecisions((p) => [...p, dec]);
                  logAudit({ contract_id: r.contract_id, review_id: r.review_id, version: r.version, kind: "decision", detail: `Decision: ${d.replace(/_/g, " ")}${rationale ? ` — ${rationale}` : ""}` });
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
