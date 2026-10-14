"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUploads } from "@/lib/client/store";
import { LIFECYCLE, type Lifecycle, daysUntil, fmtDate, money } from "@/lib/labels";
import type { QueueItem, Severity } from "@/lib/types";
import { Chip, CountBadges, PageHeader } from "./ui";

export interface QueueRow extends QueueItem {
  lifecycle: Lifecycle;
  counts: Record<Severity, number> | null;
  attention: number | null;
  ai_status: string | null;
  completeness: string | null;
  conflicts: number;
  bundle_members: { contract_id: string; doc_type: string; status: string; signed_date: string }[];
}

function useLifecycleOverrides(ids: string[]) {
  const [map, setMap] = useState<Record<string, Lifecycle>>({});
  useEffect(() => {
    const load = () => {
      const m: Record<string, Lifecycle> = {};
      for (const id of ids) {
        try {
          const v = window.localStorage.getItem(`atliq.v1.status.${id}`);
          if (v) m[id] = JSON.parse(v);
        } catch {
          /* storage unavailable */
        }
      }
      setMap(m);
    };
    load();
    window.addEventListener("atliq-store", load);
    return () => window.removeEventListener("atliq-store", load);
  }, [ids]);
  return map;
}

const STATUS_STYLE: Record<Lifecycle, string> = {
  Received: "bg-slate-100 text-slate-700",
  "In review": "bg-sky-100 text-sky-800",
  Negotiating: "bg-violet-100 text-violet-800",
  Signed: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-rose-100 text-rose-800",
};

function StatusPill({ s }: { s: Lifecycle }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[s]}`}>{s}</span>;
}

function Deadline({ date, today, source }: { date: string | null; today: string; source: string | null }) {
  if (!date) return <span className="text-xs text-slate-400">No date</span>;
  const d = daysUntil(date, today);
  const cls = d < 0 ? "bg-red-600 text-white" : d <= 3 ? "bg-red-100 text-red-800 font-semibold" : d <= 7 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex flex-col rounded px-1.5 py-0.5 text-xs ${cls}`} title={source ? `From tracker notes: "${source}"` : undefined}>
      <span>{fmtDate(date)}</span>
      <span className="text-[10px] opacity-80">{d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `in ${d}d`}</span>
    </span>
  );
}

function RowMenu({ id, inScope }: { id: string; inScope: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Actions">
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <Link href={`/review/${id}`} className="block px-3 py-1.5 hover:bg-slate-50">
            Open review
          </Link>
          {inScope && (
            <Link href={`/review/${id}?setup=1`} className="block px-3 py-1.5 hover:bg-slate-50">
              Re-review
            </Link>
          )}
          <Link href={`/review/${id}/report`} className="block px-3 py-1.5 hover:bg-slate-50">
            View report
          </Link>
        </div>
      )}
    </div>
  );
}

export function QueueTable({ rows, today, issues }: { rows: QueueRow[]; today: string; issues: string[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [docType, setDocType] = useState("");
  const [entity, setEntity] = useState("");
  const [window_, setWindow] = useState("");
  const [attention, setAttention] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const overrides = useLifecycleOverrides(ids);
  const [uploads] = useUploads();

  const docTypes = Array.from(new Set(rows.map((r) => r.doc_type))).sort();
  const filtered = rows
    .map((r) => ({ ...r, lifecycle: overrides[r.id] ?? r.lifecycle }))
    .filter((r) => {
      const hay = `${r.counterparty} ${r.title} ${r.doc_type} ${r.file_name} ${r.requested_by}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;
      if (status && r.lifecycle !== status) return false;
      if (docType && r.doc_type !== docType) return false;
      if (entity && r.atliq_entity !== entity) return false;
      if (window_) {
        const d = r.deadline ? daysUntil(r.deadline, today) : null;
        if (window_ === "3" && !(d !== null && d <= 3)) return false;
        if (window_ === "7" && !(d !== null && d <= 7)) return false;
        if (window_ === "14" && !(d !== null && d <= 14)) return false;
        if (window_ === "none" && d !== null) return false;
      }
      if (attention === "critical" && !(r.counts && r.counts.CRITICAL > 0)) return false;
      if (attention === "high" && !(r.counts && r.counts.CRITICAL + r.counts.HIGH > 0)) return false;
      if (attention === "conflict" && r.conflicts === 0) return false;
      if (attention === "clean" && r.counts && r.counts.CRITICAL + r.counts.HIGH > 0) return false;
      return true;
    })
    .sort((a, b) => Number(b.in_scope) - Number(a.in_scope) || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || (b.attention ?? 0) - (a.attention ?? 0));

  // group bundles (same counterparty) under one header, positioned by the earliest member
  const groups: { key: string; rows: typeof filtered }[] = [];
  for (const r of filtered) {
    const key = r.bundle ?? r.id;
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ key, rows: [r] });
  }

  const urgent = filtered.filter((r) => r.deadline && daysUntil(r.deadline, today) <= 3 && r.in_scope).length;
  const critical = filtered.filter((r) => r.counts && r.counts.CRITICAL > 0).length;

  return (
    <div>
      <PageHeader
        title="Review queue"
        subtitle={
          <>
            {rows.length} incoming drafts · <span className="font-medium text-red-700">{urgent} due within 3 days</span> · {critical} with Critical findings · sorted by deadline
          </>
        }
      >
        <Link href="/review/new" className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
          Upload contract
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search counterparty, title, doc type or file name"
          className="w-80 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
        />
        <Select value={status} onChange={setStatus} label="Status" options={LIFECYCLE.map((s) => [s, s])} />
        <Select value={docType} onChange={setDocType} label="Doc type" options={docTypes.map((d) => [d, d])} />
        <Select value={entity} onChange={setEntity} label="AtliQ entity" options={[["Pvt Ltd", "Pvt Ltd"], ["Inc", "Inc"]]} />
        <Select value={window_} onChange={setWindow} label="Deadline" options={[["3", "≤ 3 days"], ["7", "≤ 7 days"], ["14", "≤ 14 days"], ["none", "No deadline"]]} />
        <Select value={attention} onChange={setAttention} label="Attention" options={[["critical", "Has Critical"], ["high", "Critical or High"], ["conflict", "Commitment conflict"], ["clean", "No Critical/High"]]} />
        {(q || status || docType || entity || window_ || attention) && (
          <button
            onClick={() => {
              setQ("");
              setStatus("");
              setDocType("");
              setEntity("");
              setWindow("");
              setAttention("");
            }}
            className="text-xs text-slate-500 underline"
          >
            Clear
          </button>
        )}
        <button onClick={() => setShowIssues(!showIssues)} className="ml-auto text-xs text-slate-500 hover:text-slate-800">
          Tracker data issues ({issues.length}) {showIssues ? "▴" : "▾"}
        </button>
      </div>
      {showIssues && (
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-2 text-xs text-slate-600">
          <ul className="list-disc pl-5">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-6 py-4">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Contract</th>
                <th className="px-3 py-2.5">Counterparty / AtliQ entity</th>
                <th className="px-3 py-2.5">Doc type</th>
                <th className="px-3 py-2.5 text-right">Value (USD)</th>
                <th className="px-3 py-2.5">Deadline</th>
                <th className="px-3 py-2.5">Attention</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <BundleGroup key={g.key} rows={g.rows} today={today} />
              ))}
              {!groups.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    No contracts match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700">Your uploads (this browser)</h2>
        {uploads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
            No uploaded contracts yet. <Link href="/review/new" className="text-brand-700 underline">Upload a PDF, DOCX or Markdown contract</Link> to review it live.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {uploads.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/review/${u.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {u.title}
                      </Link>
                      <div className="text-xs text-slate-500">{u.file_name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{u.counterparty}</td>
                    <td className="px-3 py-2.5 text-slate-600">{u.contract_type}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {u.versions.length} version{u.versions.length > 1 ? "s" : ""} · uploaded {fmtDate(u.created)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link href={`/review/${u.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function BundleGroup({ rows, today }: { rows: (QueueRow & { lifecycle: Lifecycle })[]; today: string }) {
  const first = rows[0];
  const isBundle = !!first.bundle && first.bundle_members.length > 1;
  const signedOthers = first.bundle_members.filter((m) => !rows.some((r) => r.id === m.contract_id));
  const incomplete = isBundle && first.bundle_members.some((m) => m.status !== "Signed" && /BAA|NDA|MSA/.test(m.doc_type)) && first.in_scope;
  return (
    <>
      {isBundle && (
        <tr className="bg-slate-50/70">
          <td colSpan={8} className="px-4 py-1.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Bundle · {first.counterparty}</span>
            <span className="ml-2">
              {first.bundle_members.map((m) => (
                <span key={m.contract_id} className="mr-2">
                  {m.doc_type} <span className={m.status === "Signed" ? "text-emerald-700" : "text-slate-500"}>({m.status}{m.contract_id ? `, ${m.contract_id}` : ""})</span>
                </span>
              ))}
            </span>
            {incomplete && <Chip className="ml-1 border-amber-300 bg-amber-50 text-amber-800">Bundle incomplete</Chip>}
            {signedOthers.length > 0 && !incomplete && <Chip className="ml-1">Under signed {signedOthers.map((s) => s.doc_type).join(", ")}</Chip>}
          </td>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={r.id} className={`hover:bg-slate-50 ${!r.in_scope ? "opacity-70" : ""}`}>
          <td className={`px-4 py-3 ${isBundle ? "pl-8" : ""}`}>
            <Link href={`/review/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">
              {r.title.length > 52 ? r.title.slice(0, 50) + "…" : r.title}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span className="max-w-[260px] truncate" title={r.file_name}>
                {r.file_name}
              </span>
              <span>· {r.requested_by || "—"}</span>
              <span>· {r.id}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {!r.in_scope && <Chip className="border-slate-300 bg-slate-100">Out of MVP scope</Chip>}
              {r.in_scope && r.completeness === "incomplete" && (
                <Chip className="border-violet-200 bg-violet-50 text-violet-700">{r.ai_status === "completed" ? "Open verifications" : "AI not run — rules only"}</Chip>
              )}
              {r.conflicts > 0 && <Chip className="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800">{r.conflicts} commitment conflict{r.conflicts > 1 ? "s" : ""}</Chip>}
            </div>
          </td>
          <td className="px-3 py-3">
            <div className="text-slate-800">{r.counterparty}</div>
            <div className="text-xs text-slate-500">{r.atliq_entity ? `AtliQ ${r.atliq_entity === "Inc" ? "Inc" : "Technologies Pvt Ltd"}` : "Entity not recorded"} · {r.country || "—"}</div>
          </td>
          <td className="px-3 py-3 text-slate-700">{r.doc_type}</td>
          <td className="px-3 py-3 text-right tabular-nums text-slate-700">{money(r.value_usd)}</td>
          <td className="px-3 py-3">
            <Deadline date={r.deadline} today={today} source={r.deadline_source} />
          </td>
          <td className="px-3 py-3">{r.counts ? <CountBadges counts={r.counts} compact /> : <span className="text-xs text-slate-400">Not reviewed</span>}</td>
          <td className="px-3 py-3">
            <StatusPill s={r.lifecycle} />
          </td>
          <td className="px-2 py-3">
            <RowMenu id={r.id} inScope={r.in_scope} />
          </td>
        </tr>
      ))}
    </>
  );
}

function Select({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border px-2 py-1.5 text-sm outline-none focus:border-brand-600 ${value ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"}`}
    >
      <option value="">{label}: all</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
