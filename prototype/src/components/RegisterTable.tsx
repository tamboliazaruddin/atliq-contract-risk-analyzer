"use client";

import { Fragment, useState } from "react";
import { logAudit, reviewerName, useRegisterVerified } from "@/lib/client/store";
import { fmtDate, fmtDateTime } from "@/lib/labels";
import { GroundedBadge, PageHeader } from "./ui";

export interface RegisterRow {
  id: string;
  type: string;
  counterparty: string;
  scope: string;
  sectors: string[];
  geographies: string[];
  binds_affiliates: boolean;
  atliq_entity: string;
  end: string | null;
  end_note: string | null;
  status: string;
  source_file: string;
  clause_ref: string;
  quote: string;
  grounded: boolean;
  checkable: boolean;
  conflict_note: string;
}

const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expiring: "bg-amber-50 text-amber-800 border-amber-200",
  perpetual: "bg-sky-50 text-sky-700 border-sky-200",
  expired: "bg-slate-100 text-slate-500 border-slate-200",
  spent: "bg-slate-100 text-slate-500 border-slate-200",
  waived: "bg-slate-100 text-slate-500 border-slate-200",
};

export function RegisterTable({ rows, today }: { rows: RegisterRow[]; today: string }) {
  const [verified, setVerified] = useRegisterVerified();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const types = Array.from(new Set(rows.map((r) => r.type)));
  const shown = rows.filter((r) => (!type || r.type === type) && (!status || r.status === status) && (!q || `${r.counterparty} ${r.scope} ${r.geographies.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const restrictive = rows.filter((r) => r.checkable && !/expired|spent/.test(r.status)).length;
  return (
    <div>
      <PageHeader
        title="Commitments register"
        subtitle={
          <>
            What AtliQ has already promised — extracted from {new Set(rows.map((r) => r.source_file)).size} signed documents. {restrictive} active restrictions are checked automatically against every new contract. Dataset date {today}.
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search counterparty, scope, geography" className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600">
          <option value="">Type: all</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600">
          <option value="">Status: all</option>
          {["active", "expiring", "perpetual", "expired", "spent"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-500">
          {Object.keys(verified).length} of {rows.length} verified by a human
        </span>
      </div>
      <div className="px-6 py-4">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-3 py-2.5">Counterparty</th>
                <th className="px-3 py-2.5">Scope</th>
                <th className="px-3 py-2.5">Geography</th>
                <th className="px-3 py-2.5">Binds affiliates</th>
                <th className="px-3 py-2.5">Until</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5">Verified by human</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer align-top hover:bg-slate-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="px-4 py-2.5">
                      <div className="text-xs font-semibold text-slate-800">{r.type.replace(/_/g, " ")}</div>
                      <div className="font-mono text-[10px] text-slate-400">{r.id}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-800">{r.counterparty}</td>
                    <td className="max-w-md px-3 py-2.5 text-xs text-slate-600">{r.scope}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{r.geographies.join(", ") || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{r.binds_affiliates ? <span className="font-semibold text-red-700">Yes — both entities</span> : "No"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600" title={r.end_note ?? ""}>
                      {r.end ? fmtDate(r.end) : r.status === "perpetual" ? "Perpetual" : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLS[r.status] ?? ""}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {r.source_file.replace("signed_contracts/", "")}
                      <div className="font-mono text-[10px] text-slate-400">{r.clause_ref}</div>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          className="accent-brand-600"
                          checked={!!verified[r.id]}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setVerified((p) => {
                              const n = { ...p };
                              if (on) n[r.id] = { by: reviewerName(), at: new Date().toISOString() };
                              else delete n[r.id];
                              return n;
                            });
                            logAudit({ contract_id: "register", kind: "register_verified", detail: `${on ? "Verified" : "Un-verified"} ${r.id} (${r.counterparty} ${r.type})` });
                          }}
                        />
                        {verified[r.id] ? <span className="text-emerald-700">{fmtDateTime(verified[r.id].at)}</span> : <span className="text-slate-400">Not yet</span>}
                      </label>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={9} className="px-6 py-3">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Verbatim source · {r.source_file} {r.clause_ref} <GroundedBadge ok={r.grounded} />
                        </div>
                        <div className="contract-text mt-1">“{r.quote}”</div>
                        <div className="mt-1 text-xs text-slate-600">
                          {r.end_note && <span className="mr-3">{r.end_note}</span>}
                          {r.checkable ? <span className="text-fuchsia-700">Checked against every new contract — {r.conflict_note}</span> : <span>Informational (delivery constraint / history) — {r.conflict_note}</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Expired and spent items stay visible (client request). Quotes are verified word-for-word against the source file. Regenerate an AI extraction to compare against this register with <code>npm run register</code>.
        </p>
      </div>
    </div>
  );
}
