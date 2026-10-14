"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { useAudit } from "@/lib/client/store";
import { fmtDateTime } from "@/lib/labels";

const KIND: Record<string, string> = {
  finding_action: "Finding action",
  action_undone: "Action undone",
  decision: "Decision",
  status_change: "Status change",
  review_run: "Review run",
  register_verified: "Register",
  report_exported: "Report exported",
};

export default function AuditPage() {
  const [audit, setAudit] = useAudit();
  const [kind, setKind] = useState("");
  const shown = [...audit].reverse().filter((e) => !kind || e.kind === kind);
  const decisions = audit.filter((e) => e.kind === "decision").length;
  const actions = audit.filter((e) => e.kind === "finding_action");
  const confirmed = actions.filter((e) => e.detail.startsWith("CONFIRM")).length;
  const dismissed = actions.filter((e) => e.detail.startsWith("DISMISS")).length;
  const flagged = actions.filter((e) => e.detail.startsWith("FLAG")).length;
  return (
    <div>
      <PageHeader title="Reports & audit trail" subtitle="Every reviewer action, override, re-review and decision recorded in this browser (demo storage). AI findings and human decisions are kept separate.">
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "atliq-audit-trail.json";
            a.click();
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Download JSON
        </button>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 px-6 pt-5 md:grid-cols-5">
        {[
          ["Events", audit.length],
          ["Decisions", decisions],
          ["Findings confirmed", confirmed],
          ["Dismissed", dismissed],
          ["Flagged for verification", flagged],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="px-6 py-4">
        <div className="mb-2 flex items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600">
            <option value="">All events</option>
            {Object.entries(KIND).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">Reviewer acceptance rate (trust signal): {confirmed + dismissed ? Math.round((confirmed / (confirmed + dismissed)) * 100) : 0}% of decided findings confirmed</span>
          {audit.length > 0 && (
            <button
              onClick={() => {
                if (confirm("Clear the demo audit trail in this browser? This cannot be undone.")) setAudit([]);
              }}
              className="ml-auto text-xs text-slate-400 underline hover:text-red-700"
            >
              Reset demo data
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {shown.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No activity yet. Open a contract from the <Link href="/" className="text-brand-700 underline">review queue</Link> and confirm, dismiss or flag a finding.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">When</th>
                  <th className="px-3 py-2">Who</th>
                  <th className="px-3 py-2">Contract</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((e, i) => (
                  <tr key={i} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{fmtDateTime(e.at)}</td>
                    <td className="px-3 py-2 text-xs">{e.by}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.contract_id.startsWith("C-") || e.contract_id.startsWith("U-") ? (
                        <Link href={`/review/${e.contract_id}`} className="text-brand-700 hover:underline">
                          {e.contract_id}
                        </Link>
                      ) : (
                        e.contract_id
                      )}
                      {e.version ? <span className="text-slate-400"> · v{e.version}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs font-medium text-slate-700">{KIND[e.kind] ?? e.kind}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
