import type { Category, CheckStatus, DocStatus, FindingType, Severity } from "./types";

// Client-safe display labels (no fs imports).

export const SEVERITY_LABEL: Record<Severity, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export const TYPE_LABEL: Record<FindingType, string> = {
  POTENTIAL_RISK: "Potential risk",
  HISTORICAL_CONFLICT: "Historical conflict",
  DOCUMENT_GAP: "Document gap",
  UNRESOLVED_QUESTION: "Unresolved question",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  liability: "Liability",
  indemnity: "Indemnity",
  liquidated_damages: "Liquidated damages",
  payment: "Payment",
  ip: "Intellectual property",
  termination: "Termination",
  governing_law_entity: "Entity & governing law",
  non_compete_exclusivity: "Non-compete / exclusivity",
  pricing_mfn: "Pricing / MFN",
  data_protection: "Data protection",
  nda_mutuality: "NDA mutuality",
  insurance: "Insurance",
  fairness_to_counterparty: "Fairness to counterparty",
  required_documents: "Required documents",
  other: "Other",
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  signed_active: "Signed · Active",
  signed_expired: "Signed · Expired",
  signed_expiring: "Signed · Expiring soon",
  signed_spent: "Signed · Spent",
  draft_in_review: "Draft · not binding",
  negotiation_note: "Negotiation note",
  meeting_note: "Meeting note",
  tracker_note: "Tracker note",
  reference_data: "Reference data",
  this_contract: "This contract",
};

export const CHECK_LABEL: Record<CheckStatus, string> = {
  passed: "Passed",
  flagged: "Flagged",
  could_not_verify: "Could not verify",
  not_applicable: "Not applicable",
};

export const LIFECYCLE = ["Received", "In review", "Negotiating", "Signed", "Rejected"] as const;
export type Lifecycle = (typeof LIFECYCLE)[number];

export function trackerToLifecycle(s: string): Lifecycle {
  if (/signed/i.test(s)) return "Signed";
  if (/reject/i.test(s)) return "Rejected";
  if (/awaiting|negotiat/i.test(s)) return "Negotiating";
  if (/review/i.test(s)) return "In review";
  return "Received";
}

export const DECISION_LABEL = {
  proceed_to_sign: "Proceed to sign",
  negotiate: "Negotiate",
  escalate_to_counsel: "Escalate to counsel",
  reject: "Reject",
} as const;

export const ENTITY_LABEL = { pvt_ltd: "AtliQ Technologies Pvt Ltd", inc: "AtliQ Inc", unknown: "Unknown" } as const;

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined }).replace("Sept", "Sep");
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
}

export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US")}`;
}
