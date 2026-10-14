import { Suspense } from "react";
import { ReviewLoader, type DatasetReview } from "@/components/review/ReviewLoader";
import { parseContract } from "@/lib/clauses";
import { loadPrecedents, loadQueue, loadReview, readRaw } from "@/lib/data";
import { registerSummary } from "@/lib/kb";
import { trackerToLifecycle } from "@/lib/labels";

export function generateStaticParams() {
  return loadQueue().map((q) => ({ id: q.id }));
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = id.startsWith("C-") ? loadQueue().find((q) => q.id === id) : undefined;
  let dataset: DatasetReview | null = null;
  if (item) {
    const text = readRaw(item.file);
    const parsed = parseContract(text);
    dataset = {
      review: loadReview(item.id),
      clauses: parsed.clauses,
      provenance: parsed.provenance,
      text,
      title: parsed.title,
      counterparty: item.counterparty,
      inScope: item.in_scope,
    };
  }
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading review…</div>}>
      <ReviewLoader
        contractId={id}
        dataset={dataset}
        precedents={loadPrecedents()}
        register={registerSummary()}
        lifecycleInitial={item ? trackerToLifecycle(item.tracker_status) : "In review"}
        dealNote={item?.notes ?? ""}
      />
    </Suspense>
  );
}
