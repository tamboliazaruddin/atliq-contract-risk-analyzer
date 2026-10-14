"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { type StoredReview, logAudit, loadReviewVersion, useAudit, useDecisions, useStored, useVersions } from "@/lib/client/store";
import { CATEGORY_LABEL, CHECK_LABEL, DECISION_LABEL, DOC_STATUS_LABEL, ENTITY_LABEL, SEVERITIES, TYPE_LABEL, fmtDateTime } from "@/lib/labels";
import type { Precedent, ReviewResult, ReviewerAction } from "@/lib/types";
import { CheckIcon, CountBadges, SeverityBadge } from "../ui";

export function ReportView({ contractId, datasetReview, precedents }: { contractId: string; datasetReview: ReviewResult | null; precedents: Precedent[] }) {
  const params = useSearchParams();
  const [versions, , ready] = useVersions(contractId);
  const [stored, setStored] = useState<StoredReview | null>(null);
  useEffect(() => {
    if (!ready) return;
    const v = params.get("v");
    const pick = v ? versions.find((x) => String(x.version) === v) : contractId.startsWith("U-") ? versions[versions.length - 1] : undefined;
    if (pick) setStored(loadReviewVersion(pick.key));
  }, [ready, versions, params, contractId]);
  const r = stored?.review ?? datasetReview;
  const [actions] = useStored<Record<string, ReviewerAction>>(`actions.${r?.review_id ?? "none"}`, {});
  const [decisions] = useDecisions(contractId);
  const [audit] = useAudit();

  if (!r) return <div className="p-8 text-sm text-slate-500">{ready ? "No review found for this contract." : "Loading…"}</div>;
  const events = audit.filter((e) => e.contract_id === contractId);
  const unresolved = r.findings.filter((f) => f.finding_type === "UNRESOLVED_QUESTION" || f.confidence === "LOW" || !f.grounded || actions[f.id]?.action === "flag");
  const incompleteChecks = r.checks.filter((c) => c.status === "could_not_verify");
  const actionLabel = (a?: ReviewerAction) => (a ? `${a.action === "flag" ? "Flagged for verification" : a.action === "confirm" ? "Confirmed" : "Dismissed"} by ${a.by}, ${fmtDateTime(a.at)}${a.rationale ? ` — “${a.rationale}”` : ""}` : "Not yet reviewed");

  return (
    <div className="mx-auto max-w-4xl bg-white px-10 py-8 text-[13px] text-slate-800 print:max-w-none print:px-0">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href={`/review/${contractId}${stored ? `?v=${r.version}` : ""}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to workspace
        </Link>
        <button
          onClick={() => {
            logAudit({ contract_id: contractId, review_id: r.review_id, version: r.version, kind: "report_exported", detail: `Report exported (v${r.version})` });
            window.print();
          }}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          Print / save as PDF
        </button>
      </div>

      <header className="border-b-2 border-slate-900 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">AtliQ Contract Risk Analyzer · Review report</div>
        <h1 className="mt-1 text-xl font-semibold">
          {r.counterparty} — {r.title}
        </h1>
        <div className="mt-1 grid grid-cols-2 gap-x-6 text-xs text-slate-600">
          <div>
            Contract: {r.contract_id} · {r.file_name}
          </div>
          <div>
            Review version v{r.version} · {r.review_id}
          </div>
          <div>
            {r.config.contract_type} · {ENTITY_LABEL[r.config.atliq_entity]} as {r.config.atliq_role} · {r.config.counterparty_country}
          </div>
          <div>
            Generated {fmtDateTime(r.generated_at)} · dataset date {r.dataset_today}
          </div>
          <div>AI: {r.ai.provider === "none" ? "not run (rules only)" : `${r.ai.provider} / ${r.ai.model} — ${r.ai.status}`}</div>
          <div>Processing time {(r.processing_ms / 1000).toFixed(1)}s</div>
        </div>
      </header>

      <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Review assistant output — not legal advice. Potential conflicts are not breach determinations. The final decision rests with the authorised signer; the AI did not approve, reject or sign anything.
      </p>
      <p className={`mt-2 rounded px-3 py-2 text-xs ${r.completeness === "complete" ? "bg-emerald-50 text-emerald-900" : "bg-violet-50 text-violet-900"}`}>
        <strong>{r.completeness === "complete" ? "First-pass review complete." : "INCOMPLETE REVIEW — not a clean review."}</strong> {r.completeness_notes.join(" · ")}
      </p>

      <Section title="1. Summary">
        <p className="whitespace-pre-line">{r.summary}</p>
        <div className="mt-2 flex items-center gap-3">
          <CountBadges counts={r.counts} /> <span className="text-xs text-slate-500">Attention score {r.attention_score}</span>
        </div>
      </Section>

      <Section title="2. Key terms">
        <table className="w-full text-xs">
          <tbody>
            {r.key_terms.map((k) => (
              <tr key={k.key} className="border-b border-slate-100 align-top">
                <td className="w-40 py-1 pr-3 font-medium text-slate-600">{k.label}</td>
                <td className="py-1">{k.status === "missing" ? "NOT FOUND — verify" : k.value}</td>
                <td className="w-16 py-1 text-right font-mono text-[10.5px] text-slate-500">{k.clause_ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`3. Findings (${r.findings.length}), prioritised`}>
        {SEVERITIES.map((s) => {
          const fs = r.findings.filter((f) => f.severity === s);
          if (!fs.length) return null;
          return (
            <div key={s} className="mb-3">
              {fs.map((f, i) => (
                <div key={f.id} className="print-avoid mb-3 border-l-4 border-slate-300 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge s={f.severity} />
                    <span className="text-[11px] font-medium text-slate-600">
                      {TYPE_LABEL[f.finding_type]}
                      {f.gap_kind ? ` (${f.gap_kind})` : ""} · {CATEGORY_LABEL[f.category]} · {f.contract_clause_ref} · confidence {f.confidence.toLowerCase()} · {f.grounded ? "verified in source" : "NOT VERIFIED"} · {f.source === "llm" ? "AI" : "rules"}
                    </span>
                  </div>
                  <div className="mt-0.5 font-semibold">
                    {i + 1}. {f.title}
                  </div>
                  <div className="contract-text mt-1 text-[12px] text-slate-700">Contract: “{f.contract_quote}”</div>
                  <div className="mt-1 text-slate-700">{f.explanation}</div>
                  {f.evidence.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-[11.5px] text-slate-600">
                      {f.evidence.map((e, j) => (
                        <li key={j}>
                          {e.label ?? e.source_file} [{DOC_STATUS_LABEL[e.doc_status]}] {e.clause_ref}: “{e.quote.replace(/\*\*/g, "")}” {e.grounded ? "" : "(not verified)"}
                        </li>
                      ))}
                    </ul>
                  )}
                  {f.precedent_ids.length > 0 && (
                    <div className="mt-1 text-[11.5px] text-slate-600">
                      Precedent: {f.precedent_ids.map((id) => precedents.find((p) => p.id === id)).filter(Boolean).map((p) => `${p!.counterparty} (${p!.tag.replace(/_/g, " ")})`).join("; ")}
                    </div>
                  )}
                  {f.needs_info && <div className="mt-1 text-[11.5px] text-sky-800">Still needed: {f.needs_info}</div>}
                  <div className="mt-1 text-[11.5px] font-medium text-slate-800">Reviewer: {actionLabel(actions[f.id])}</div>
                </div>
              ))}
            </div>
          );
        })}
        {r.findings.length === 0 && <p>No findings were raised. This does not prove the contract is safe.</p>}
      </Section>

      <Section title="4. Validation checks">
        <ul className="space-y-1">
          {r.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <CheckIcon s={c.status} />
              <span>
                <strong>{c.name}</strong> — {CHECK_LABEL[c.status]}. <span className="text-slate-600">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="5. Unresolved questions and incomplete checks">
        {unresolved.length === 0 && incompleteChecks.length === 0 ? (
          <p>None recorded.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5">
            {unresolved.map((f) => (
              <li key={f.id}>
                {f.title} ({f.contract_clause_ref}){f.needs_info ? ` — ${f.needs_info}` : ""}
              </li>
            ))}
            {incompleteChecks.map((c) => (
              <li key={c.id}>
                Could not verify: {c.name} — {c.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="6. Clause coverage">
        <div className="columns-2 gap-6 text-[11px]">
          {r.coverage.map((c) => (
            <div key={c.clause_id} className="flex justify-between border-b border-slate-50 py-0.5">
              <span className="font-mono text-slate-500">{c.ref}</span>
              <span>{c.status === "flagged" ? `Flagged (${c.finding_ids.length})` : c.status === "reviewed_no_issue" ? "No issue found" : c.status === "rule_scan_only" ? "Rule scan only" : "Not analysed"}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="7. Decision record (human)">
        {decisions.length === 0 ? (
          <p>No decision recorded.</p>
        ) : (
          <ul className="space-y-1">
            {decisions.map((d, i) => (
              <li key={i}>
                <strong>{DECISION_LABEL[d.decision]}</strong> — {d.by}, {fmtDateTime(d.at)}, on review v{d.version} ({d.unreviewed} unreviewed, {d.open_critical} open Critical){d.rationale ? `: “${d.rationale}”` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="8. Audit trail">
        {events.length === 0 ? (
          <p>No reviewer activity recorded in this browser.</p>
        ) : (
          <ul className="space-y-0.5 text-[11.5px]">
            {events.map((e, i) => (
              <li key={i}>
                {fmtDateTime(e.at)} · {e.by} · {e.version ? `v${e.version} · ` : ""}
                {e.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</h2>
      {children}
    </section>
  );
}
