import { QueueTable, type QueueRow } from "@/components/QueueTable";
import { datasetToday } from "@/lib/config";
import { bundleMembers, loadQueue, loadReview, trackerIssues } from "@/lib/data";
import { trackerToLifecycle } from "@/lib/labels";


export default function Home() {
  const queue = loadQueue();
  const rows: QueueRow[] = queue.map((q) => {
    const r = loadReview(q.id);
    return {
      ...q,
      lifecycle: trackerToLifecycle(q.tracker_status),
      counts: r?.counts ?? null,
      attention: r?.attention_score ?? null,
      ai_status: r?.ai.status ?? null,
      completeness: r?.completeness ?? null,
      conflicts: r ? r.findings.filter((f) => f.finding_type === "HISTORICAL_CONFLICT" && f.severity !== "LOW").length : 0,
      bundle_members: q.bundle ? bundleMembers(q.counterparty) : [],
    };
  });
  return <QueueTable rows={rows} today={datasetToday()} issues={trackerIssues()} />;
}
