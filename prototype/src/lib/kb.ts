import type { RegisterSummary } from "@/components/review/Tabs";
import { datasetToday } from "./config";
import { commitmentStatus, loadRegister } from "./data";

/** Register rows for the client (no matcher internals). */
export function registerSummary(): RegisterSummary[] {
  const today = datasetToday();
  return loadRegister().map((c) => ({
    id: c.id,
    type: c.type,
    counterparty: c.counterparty,
    clause_ref: c.clause_ref,
    scope: c.scope,
    status: commitmentStatus(c, today),
    end: c.end,
    source_file: c.source_file,
    checkable: c.matcher.kind !== "none",
  }));
}
