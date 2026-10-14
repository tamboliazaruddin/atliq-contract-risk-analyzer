import { Card, PageHeader } from "@/components/ui";
import { loadPrecedents } from "@/lib/data";
import { CATEGORY_LABEL } from "@/lib/labels";
import type { Category } from "@/lib/types";


const TAG: Record<string, { label: string; cls: string }> = {
  standard: { label: "Standard", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  deliberate_exception: { label: "Deliberate exception", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  waved_through: { label: "Waved through", cls: "bg-red-50 text-red-700 border-red-200" },
  walked_away: { label: "Walked away", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  softened_for_counterparty: { label: "Softened for vendor", cls: "bg-sky-50 text-sky-700 border-sky-200" },
};

export default function PrecedentsPage() {
  const items = loadPrecedents();
  const cats = Array.from(new Set(items.map((p) => p.category))) as Category[];
  return (
    <div>
      <PageHeader
        title="Precedents"
        subtitle="How AtliQ actually negotiated before — history, not policy. AtliQ has no fixed negotiation policy, so reviews show these as context, never as hard thresholds."
      />
      <div className="space-y-5 px-6 py-5">
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(TAG).map(([k, t]) => (
            <span key={k} className={`rounded border px-2 py-0.5 ${t.cls}`}>
              {t.label}
            </span>
          ))}
        </div>
        {cats.map((c) => (
          <Card key={c}>
            <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-800">{CATEGORY_LABEL[c]}</div>
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-1.5">Counterparty</th>
                  <th className="px-3 py-1.5">They asked</th>
                  <th className="px-3 py-1.5">AtliQ agreed</th>
                  <th className="px-3 py-1.5">Tag</th>
                  <th className="px-3 py-1.5">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items
                  .filter((p) => p.category === c)
                  .map((p) => (
                    <tr key={p.id} className="align-top">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-800">{p.counterparty}</div>
                        <div className="text-[11px] text-slate-500">
                          {p.date} · AtliQ as {p.atliq_role}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{p.they_asked}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {p.atliq_agreed}
                        {p.outcome && <div className="mt-0.5 font-medium text-red-700">Outcome: {p.outcome}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${TAG[p.tag].cls}`}>{TAG[p.tag].label}</span>
                      </td>
                      <td className="max-w-xs px-3 py-2 text-[11px] text-slate-500">
                        <div className="font-mono">{p.source_file}</div>
                        <div className="contract-text mt-0.5 text-[12px] text-slate-600">“{p.quote}”</div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        ))}
        <p className="text-xs text-slate-500">Sources include Jay&apos;s unreviewed negotiation-notes reconstruction; treat as history to inform a negotiation, not as approved policy.</p>
      </div>
    </div>
  );
}
