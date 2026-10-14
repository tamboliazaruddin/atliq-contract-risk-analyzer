import { Suspense } from "react";
import { ReportView } from "@/components/review/ReportView";
import { loadPrecedents, loadQueue, loadReview } from "@/lib/data";

export function generateStaticParams() {
  return loadQueue().map((q) => ({ id: q.id }));
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const review = id.startsWith("C-") ? loadReview(id) : null;
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading report…</div>}>
      <ReportView contractId={id} datasetReview={review} precedents={loadPrecedents()} />
    </Suspense>
  );
}
