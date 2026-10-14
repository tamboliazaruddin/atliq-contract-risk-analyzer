import { Card, PageHeader } from "@/components/ui";
import { loadEntities, loadRules } from "@/lib/data";


export default function RulesPage() {
  const { rules, dataset_today } = loadRules();
  const { entities, notes } = loadEntities();
  return (
    <div>
      <PageHeader title="Rules" subtitle="Deterministic, fact-based checks only (FR-8, FR-13). Each returns Passed · Flagged · Could not verify. Read-only in the MVP — a rule editor is deferred (PRD §13.2)." />
      <div className="grid gap-5 px-6 py-5 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          {rules.map((r) => (
            <Card key={r.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-white">{r.id}</span>
                <span className="text-sm font-semibold text-slate-900">{r.name}</span>
                <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">applies to: {r.applies_to.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-1.5 text-sm text-slate-700">{r.text}</p>
              <p className="mt-1 text-[11px] text-slate-500">Source: {r.source}</p>
            </Card>
          ))}
          <Card className="px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Today = {dataset_today}</div>
            <p className="mt-1 text-sm text-slate-700">All expiry, deadline and &quot;active vs expired&quot; logic uses the dataset date (configurable via DATASET_TODAY).</p>
          </Card>
          <Card className="border-dashed px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">Not a rule: commercial terms</div>
            <p className="mt-1 text-sm text-slate-700">
              Liability caps, LD, payment days, indemnity and IP positions are compared with <a href="/precedents" className="text-brand-700 underline">precedents</a> — what AtliQ accepted or rejected before — because AtliQ has no fixed negotiation policy.
              If a required policy has not been defined, the review says so instead of assuming a universal checklist.
            </p>
          </Card>
        </div>
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reference data — AtliQ legal entities</div>
          {entities.map((e) => (
            <Card key={e.id} className="px-4 py-3 text-sm">
              <div className="font-semibold text-slate-900">{e.legal_name}</div>
              <div className="mt-1 text-xs text-slate-600">{e.registered_office}</div>
              <div className="mt-2 text-xs">
                <span className="font-medium">Serves:</span> {e.serves_regions.join(", ")}
              </div>
              <div className="text-xs">
                <span className="font-medium">Home law:</span> {e.home_law}
              </div>
            </Card>
          ))}
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
