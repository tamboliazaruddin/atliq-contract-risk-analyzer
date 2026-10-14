import type { CheckResult, Finding, Severity } from "../types";

export const SEV_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const WEIGHT: Record<Severity, number> = { CRITICAL: 10, HIGH: 5, MEDIUM: 2, LOW: 1 };
const TYPE_ORDER = ["HISTORICAL_CONFLICT", "DOCUMENT_GAP", "POTENTIAL_RISK", "UNRESOLVED_QUESTION"];

export function sortFindings(f: Finding[], clauseOrder: Map<string, number>): Finding[] {
  return [...f].sort(
    (a, b) =>
      SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) ||
      TYPE_ORDER.indexOf(a.finding_type) - TYPE_ORDER.indexOf(b.finding_type) ||
      (clauseOrder.get(a.contract_clause_id ?? "") ?? 9999) - (clauseOrder.get(b.contract_clause_id ?? "") ?? 9999),
  );
}

export function counts(f: Finding[]) {
  const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  f.forEach((x) => c[x.severity]++);
  return c;
}

/** Attention score: weighted severity plus one point per check that could not be verified. Ranking aid only. */
export function attentionScore(f: Finding[], checks: CheckResult[]): number {
  return f.reduce((s, x) => s + WEIGHT[x.severity], 0) + checks.filter((c) => c.status === "could_not_verify").length;
}

/** Rule-based escalation hints (UI_REFERENCE §5) — who else should look, never what to decide. */
export function escalationHints(f: Finding, ctx: { usHealthcare: boolean; country: string }): string[] {
  const h = new Set<string>();
  const usCounsel = /USA/.test(ctx.country);
  if (f.severity === "CRITICAL" && (f.finding_type === "HISTORICAL_CONFLICT" || f.category === "liability" || f.category === "non_compete_exclusivity")) {
    h.add(`Consider counsel review (${usCounsel ? "Calloway Stern LLP" : "Mehta Rao & Associates"}) — share this contract together with the cited signed agreements.`);
  }
  if (ctx.usHealthcare && (f.category === "data_protection" || f.category === "required_documents" || f.category === "liability")) {
    h.add("Healthcare / PHI: consider Calloway Stern review (they reviewed the CareBridge BAA).");
  }
  if (f.category === "payment") h.add("Check with Finance (cash-flow impact).");
  if (f.category === "governing_law_entity" && /entity|invoic/i.test(f.title)) h.add("Check with Finance — invoicing entity, tax regime and bank account follow the contracting entity.");
  if (f.category === "ip" || /PipeKit|staff|certified|engineer/i.test(f.title + f.explanation)) h.add("Check with Pranav (CTO) — IP reuse, delivery model or staffing.");
  if (f.category === "insurance") h.add("Check with Finance / insurance broker — current cover vs requirement.");
  if (f.category === "pricing_mfn") h.add("Check with Finance — model the retroactive credit exposure.");
  if (f.category === "fairness_to_counterparty") h.add("Discuss with the vendor — AtliQ's own paper; PixelCraft precedent shows how it was softened before.");
  if (f.confidence === "LOW" || !f.grounded) h.add("Not sure — please verify against the source before relying on this finding.");
  return Array.from(h);
}
