"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ActionMap } from "@/lib/client/store";
import { CATEGORY_LABEL, DECISION_LABEL, ENTITY_LABEL, SEVERITIES, TYPE_LABEL, fmtDate, fmtDateTime } from "@/lib/labels";
import type { Category, Decision, DecisionKind, Finding, FindingType, Precedent, ReviewResult, ReviewerActionKind, Severity } from "@/lib/types";
import { AiLabel, CheckIcon, CountBadges, DocStatusChip, GroundedBadge, SEV_SOFT, SeverityBadge } from "../ui";
import { FindingCard } from "./FindingCard";
import { useCurrentUser } from "../UserProvider";

export interface RegisterSummary {
  id: string;
  type: string;
  counterparty: string;
  clause_ref: string;
  scope: string;
  status: string;
  end?: string;
  source_file: string;
  checkable: boolean;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function SummaryTab({ r, onJump, dealNote }: { r: ReviewResult; onJump: (clauseId: string) => void; dealNote: string }) {
  const [showCoverage, setShowCoverage] = useState(false);
  const ai = r.ai.status === "completed" || r.ai.status === "partial";
  const [aiPart, detPart] = r.summary.includes("\n\n") ? r.summary.split("\n\n") : ["", r.summary];
  const cov = r.coverage.reduce<Record<string, number>>((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attention score</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{r.attention_score}</div>
          <div className="text-[11px] text-slate-500">ranking aid, not a verdict</div>
        </div>
        <div className="col-span-2 rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Findings by severity</div>
          <div className="mt-2">
            <CountBadges counts={r.counts} />
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {r.findings.filter((f) => f.finding_type === "HISTORICAL_CONFLICT").length} historical conflict(s) · {r.findings.filter((f) => f.finding_type === "DOCUMENT_GAP").length} document gap(s) ·{" "}
            {r.findings.filter((f) => f.finding_type === "UNRESOLVED_QUESTION").length} unresolved question(s)
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Summary</span>
          {ai && aiPart ? <AiLabel /> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Rule-based</span>}
        </div>
        {aiPart && <p className="mb-2 text-sm leading-relaxed text-slate-700">{aiPart}</p>}
        <p className="text-xs leading-relaxed text-slate-600">{detPart}</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Key terms (FR-2)</div>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-slate-100">
            {r.key_terms.map((k) => (
              <tr key={k.key} className="align-top">
                <td className="w-36 px-3 py-2 font-medium text-slate-600">{k.label}</td>
                <td className="px-3 py-2 text-slate-800">
                  {k.status === "missing" ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">Not found — verify</span> : k.status === "ambiguous" ? <span className="text-amber-700">{k.value} (ambiguous)</span> : k.value}
                </td>
                <td className="w-16 px-2 py-2 text-right">
                  {k.clause_id && (
                    <button onClick={() => onJump(k.clause_id!)} className="font-mono text-[10.5px] text-brand-700 hover:underline">
                      {k.clause_ref}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dealNote && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Deal context (tracker / reviewer note — not a contract term)</div>
          <p className="mt-1 text-xs italic text-slate-700">“{dealNote}”</p>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <button onClick={() => setShowCoverage(!showCoverage)} className="flex w-full items-center justify-between px-3 py-2 text-left">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Clause coverage — every clause has a status ({r.coverage.length})</span>
          <span className="text-xs text-slate-500">{showCoverage ? "Hide ▴" : "Show ▾"}</span>
        </button>
        <div className="flex flex-wrap gap-1.5 px-3 pb-2 text-[11px]">
          {cov.flagged ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">{cov.flagged} flagged</span> : null}
          {cov.reviewed_no_issue ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{cov.reviewed_no_issue} AI-reviewed, no issue</span> : null}
          {cov.rule_scan_only ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{cov.rule_scan_only} rule scan only (AI not run)</span> : null}
          {cov.not_analysed ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{cov.not_analysed} not analysed</span> : null}
        </div>
        {showCoverage && (
          <div className="scroll-thin max-h-72 overflow-y-auto border-t border-slate-100">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-50">
                {r.coverage.map((c) => (
                  <tr key={c.clause_id} className="cursor-pointer hover:bg-slate-50" onClick={() => onJump(c.clause_id)}>
                    <td className="w-24 px-3 py-1 font-mono text-[10.5px] text-slate-500">{c.ref}</td>
                    <td className="truncate px-2 py-1 text-slate-600">{c.heading}</td>
                    <td className="px-3 py-1 text-right">
                      {c.status === "flagged" ? (
                        <span className="text-red-700">Flagged ({c.finding_ids.length})</span>
                      ) : c.status === "reviewed_no_issue" ? (
                        <span className="text-emerald-700">No issue found</span>
                      ) : c.status === "rule_scan_only" ? (
                        <span className="text-violet-700">Rule scan only</span>
                      ) : (
                        <span className="text-slate-500">Not analysed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-slate-500">
        Processed in {(r.processing_ms / 1000).toFixed(1)}s · {r.config.contract_type} · {ENTITY_LABEL[r.config.atliq_entity]} as {r.config.atliq_role} · AI: {r.ai.provider === "none" ? "not run" : `${r.ai.provider} / ${r.ai.model} (${r.ai.status})`} · generated{" "}
        {fmtDateTime(r.generated_at)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function FindingsTab({
  r,
  selectedId,
  onSelect,
  actions,
  onAction,
  onUndo,
  precedents,
}: {
  r: ReviewResult;
  selectedId: string | null;
  onSelect: (f: Finding | null) => void;
  actions: ActionMap;
  onAction: (f: Finding, a: ReviewerActionKind, rationale: string) => void;
  onUndo: (f: Finding) => void;
  precedents: Precedent[];
}) {
  const [sev, setSev] = useState<Severity[]>([]);
  const [cat, setCat] = useState<Category | "">("");
  const [type, setType] = useState<FindingType | "">("");
  const [state, setState] = useState("");
  const cats = Array.from(new Set(r.findings.map((f) => f.category)));
  const filtered = r.findings.filter((f) => {
    if (sev.length && !sev.includes(f.severity)) return false;
    if (cat && f.category !== cat) return false;
    if (type && f.finding_type !== type) return false;
    const a = actions[f.id]?.action;
    if (state === "unreviewed" && a) return false;
    if (state && state !== "unreviewed" && a !== state) return false;
    return true;
  });
  const unsure = (f: Finding) => f.confidence === "LOW" || !f.grounded;
  const main = filtered.filter((f) => !unsure(f));
  const notSure = filtered.filter(unsure);
  const card = (f: Finding) => (
    <FindingCard
      key={f.id}
      f={f}
      expanded={selectedId === f.id}
      onToggle={() => onSelect(selectedId === f.id ? null : f)}
      action={actions[f.id]}
      onAction={(a, rat) => onAction(f, a, rat)}
      onUndo={() => onUndo(f)}
      precedents={precedents}
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSev((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${sev.includes(s) ? SEV_SOFT[s] + " ring-1 ring-current" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {s[0] + s.slice(1).toLowerCase()} ({r.counts[s]})
          </button>
        ))}
        <select value={cat} onChange={(e) => setCat(e.target.value as Category)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as FindingType)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">
          <option value="">All types</option>
          {(Object.keys(TYPE_LABEL) as FindingType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">
          <option value="">Any review state</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="confirm">Confirmed</option>
          <option value="dismiss">Dismissed</option>
          <option value="flag">Flagged</option>
        </select>
      </div>
      {r.findings.length === 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          No findings were raised by the configured checks. This is <strong>not</strong> proof that the contract is safe — see Checks for anything that could not be verified
          {r.ai.status !== "completed" ? ", and note the AI clause analysis did not run" : ""}.
        </div>
      )}
      <div className="space-y-2">{main.map(card)}</div>
      {notSure.length > 0 && (
        <div>
          <div className="mb-1.5 mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-violet-700">Not sure — please verify ({notSure.length})</div>
          <div className="space-y-2">{notSure.map(card)}</div>
        </div>
      )}
      {filtered.length === 0 && r.findings.length > 0 && <div className="text-sm text-slate-500">No findings match these filters.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commitments (AtliQ differentiator)
// ---------------------------------------------------------------------------

export function CommitmentsTab({ r, register, onSelect }: { r: ReviewResult; register: RegisterSummary[]; onSelect: (f: Finding) => void }) {
  const conflicts = r.findings.filter((f) => f.finding_type === "HISTORICAL_CONFLICT");
  const matched = new Set(conflicts.map((c) => c.commitment_id).filter(Boolean));
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900">
        Compared against <strong>{register.filter((x) => x.checkable).length}</strong> restrictive commitments AtliQ has already signed and its active client list. Matches are{" "}
        <strong>potential conflicts — not breach determinations</strong>.
      </div>
      {conflicts.length === 0 && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">No potential conflict with signed commitments was found. The register only covers signed contracts in the dataset.</div>}
      {conflicts.map((f) => {
        const ev = f.evidence[0];
        return (
          <div key={f.id} className="rounded-lg border border-slate-200 bg-white">
            <button onClick={() => onSelect(f)} className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left">
              <SeverityBadge s={f.severity} />
              <span className="text-sm font-medium text-slate-900">{f.title}</span>
            </button>
            <div className="grid grid-cols-2 divide-x divide-slate-100">
              <div className="p-3">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  This contract {f.contract_clause_ref}
                  <GroundedBadge ok={f.contract_quote_grounded} />
                </div>
                <div className="contract-text mt-1 text-[12.5px]">“{f.contract_quote}”</div>
              </div>
              <div className="p-3">
                {ev ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {ev.label ?? `${ev.source_file} ${ev.clause_ref}`}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <DocStatusChip s={ev.doc_status} />
                      <GroundedBadge ok={ev.grounded} />
                    </div>
                    <div className="contract-text mt-1 text-[12.5px]">“{ev.quote}”</div>
                  </>
                ) : (
                  <div className="text-xs text-slate-500">No historical source cited — conflict could not be verified.</div>
                )}
              </div>
            </div>
            <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600">{f.explanation}</div>
          </div>
        );
      })}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Restrictions checked</div>
        <ul className="divide-y divide-slate-50 text-xs">
          {register
            .filter((x) => x.checkable)
            .map((c) => (
              <li key={c.id} className="flex items-start gap-2 px-3 py-1.5">
                <CheckIcon s={matched.has(c.id) ? "flagged" : "passed"} />
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-800">{c.counterparty}</span> <span className="text-slate-500">{c.type.toLowerCase().replace(/_/g, " ")} · {c.clause_ref}</span>
                  <div className="truncate text-slate-500">{c.scope}</div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] ${/expired|spent/.test(c.status) ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
                  {c.status[0].toUpperCase() + c.status.slice(1)}
                  {c.end && !/perpetual/.test(c.status) ? ` · ${fmtDate(c.end)}` : ""}
                </span>
              </li>
            ))}
        </ul>
        <div className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          <Link href="/register" className="text-brand-700 hover:underline">
            Open the full commitments register →
          </Link>
        </div>
      </div>

      {r.retrieved.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Related history (retrieved — check status before relying on it)</div>
          <ul className="divide-y divide-slate-50">
            {r.retrieved.map((p, i) => (
              <li key={i} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-slate-800">{p.title}</span>
                  <span className="font-mono text-[10.5px] text-slate-400">{p.clause_ref}</span>
                  <DocStatusChip s={p.doc_status} />
                </div>
                <div className="mt-0.5 line-clamp-3 text-slate-600">{p.text.replace(/\*\*/g, "")}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export function ChecksTab({ r }: { r: ReviewResult }) {
  const [open, setOpen] = useState<string | null>(null);
  const order = { flagged: 0, could_not_verify: 1, passed: 2, not_applicable: 3 };
  const checks = [...r.checks].sort((a, b) => order[a.status] - order[b.status]);
  const n = (s: string) => r.checks.filter((c) => c.status === s).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <CheckIcon s="passed" /> {n("passed")} passed
        </span>
        <span className="flex items-center gap-1">
          <CheckIcon s="flagged" /> {n("flagged")} flagged
        </span>
        <span className="flex items-center gap-1">
          <CheckIcon s="could_not_verify" /> {n("could_not_verify")} could not verify
        </span>
        <span className="flex items-center gap-1">
          <CheckIcon s="not_applicable" /> {n("not_applicable")} not applicable
        </span>
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {checks.map((c) => (
          <li key={c.id} className="px-3 py-2.5">
            <button className="flex w-full items-start gap-2.5 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <CheckIcon s={c.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {c.name}
                  {c.rule_id && <span className="font-mono text-[10px] text-slate-400">{c.rule_id}</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-600">{c.detail}</div>
              </div>
            </button>
            {open === c.id && c.evidence.length > 0 && (
              <ul className="ml-8 mt-2 space-y-1.5">
                {c.evidence.map((e, i) => (
                  <li key={i} className="rounded border border-slate-200 p-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{e.label ?? e.source_file}</span>
                      <DocStatusChip s={e.doc_status} />
                    </div>
                    <div className="contract-text mt-0.5 text-[12px]">“{e.quote.replace(/\*\*/g, "")}”</div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-500">Rules are deterministic facts only (entity, law, required documents, dates, insurance cover). Commercial terms are compared with precedent, not hard thresholds.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decision (FR-11, FR-12)
// ---------------------------------------------------------------------------

export function DecisionTab({
  r,
  actions,
  decisions,
  onDecide,
  reportHref,
}: {
  r: ReviewResult;
  actions: ActionMap;
  decisions: Decision[];
  onDecide: (d: DecisionKind, rationale: string) => void;
  reportHref: string;
}) {
  const [choice, setChoice] = useState<DecisionKind | "">("");
  const [rationale, setRationale] = useState("");
  const user = useCurrentUser();
  const canDecide = user?.role === "signer";
  const stats = useMemo(() => {
    const reviewed = r.findings.filter((f) => actions[f.id]).length;
    const openCritical = r.findings.filter((f) => f.severity === "CRITICAL" && !actions[f.id]).length;
    const flagged = r.findings.filter((f) => actions[f.id]?.action === "flag").length;
    const cnv = r.checks.filter((c) => c.status === "could_not_verify").length;
    return { reviewed, openCritical, flagged, cnv };
  }, [r, actions]);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Review progress</div>
        <div className="mt-1 text-sm text-slate-800">
          <strong>{stats.reviewed}</strong> of {r.findings.length} findings reviewed · <strong>{stats.cnv}</strong> check(s) could not be verified · {stats.flagged} flagged for verification
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-600" style={{ width: `${r.findings.length ? (stats.reviewed / r.findings.length) * 100 : 100}%` }} />
        </div>
        {r.completeness === "incomplete" && (
          <div className="mt-2 rounded bg-violet-50 px-2 py-1.5 text-xs text-violet-900">
            This review is <strong>incomplete</strong>: {r.completeness_notes[0]}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Record your decision</div>
        <p className="mt-0.5 text-xs text-slate-500">The AI does not pre-select or recommend a decision. This is recorded with your name, time, review version and open items.</p>
        {!canDecide && (
          <div className="mt-2 rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-700">
            Only the authorised signer can record the final decision. You can still confirm, dismiss or flag findings and export the report for {"Karandeep"}.
          </div>
        )}
        {stats.openCritical > 0 && (
          <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">
            {stats.openCritical} Critical finding{stats.openCritical > 1 ? "s" : ""} not yet reviewed. (You can still record a decision.)
          </div>
        )}
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {(Object.keys(DECISION_LABEL) as DecisionKind[]).map((k) => (
            <button
              key={k}
              disabled={!canDecide}
              onClick={() => setChoice(k)}
              className={`rounded-md border px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${choice === k ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
            >
              {DECISION_LABEL[k]}
            </button>
          ))}
        </div>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Rationale (recommended) — e.g. which findings drove the decision, what to negotiate"
          className="mt-2 h-20 w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-600"
        />
        <div className="mt-2 flex gap-2">
          <button
            disabled={!choice || !canDecide}
            onClick={() => {
              if (!choice || !canDecide) return;
              onDecide(choice, rationale);
              setChoice("");
              setRationale("");
            }}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            Record decision
          </button>
          <Link href={reportHref} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Export report
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Decision history</div>
        {decisions.length === 0 ? (
          <div className="px-3 py-3 text-xs text-slate-500">No decision recorded yet.</div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {[...decisions].reverse().map((d, i) => (
              <li key={i} className="px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{DECISION_LABEL[d.decision]}</span>
                  <span className="text-slate-500">
                    by {d.by} · {fmtDateTime(d.at)} · v{d.version}
                  </span>
                </div>
                {d.rationale && <div className="mt-0.5 italic text-slate-600">“{d.rationale}”</div>}
                <div className="mt-0.5 text-slate-500">
                  At decision time: {d.unreviewed} unreviewed finding(s), {d.open_critical} open Critical.
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
