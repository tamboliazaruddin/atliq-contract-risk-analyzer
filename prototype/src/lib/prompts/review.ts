import { z } from "zod";
import { Category, Confidence, FindingType, Severity } from "../types";

export const LlmFinding = z.object({
  finding_type: FindingType.catch("POTENTIAL_RISK"),
  category: Category.catch("other"),
  severity: Severity.catch("MEDIUM"),
  title: z.string().min(3).max(160),
  explanation: z.string().min(10).max(1200),
  clause_ref: z.string().default(""),
  contract_quote: z.string().default(""),
  evidence: z
    .array(z.object({ source_file: z.string(), clause_ref: z.string().default(""), quote: z.string() }))
    .default([]),
  confidence: Confidence.catch("MEDIUM"),
});
export type LlmFinding = z.infer<typeof LlmFinding>;

export const LlmReview = z.object({
  summary: z.string().default(""),
  findings: z.array(LlmFinding).default([]),
  clause_review: z.array(z.object({ ref: z.string(), status: z.enum(["issue", "ok"]).catch("ok") })).default([]),
});
export type LlmReview = z.infer<typeof LlmReview>;

export const REVIEW_SYSTEM = `You are the clause-review component of the AtliQ Contract Risk Analyzer, a review assistant for Karandeep, CEO and sole signer at AtliQ Technologies (an IT services company with no legal team). You produce a first-pass, evidence-based risk review. A human makes every decision.

HARD RULES
1. Never approve, reject, recommend signing/not signing, or claim to give legal advice. Describe risks and what to verify.
2. Every finding must quote the contract VERBATIM: copy an exact, contiguous span (max 300 characters) from the CONTRACT block into "contract_quote", and give its clause ref exactly as shown in [brackets].
3. Evidence from history must be copied VERBATIM from the HISTORY / COMMITMENTS blocks, with the exact source_file shown there. Never invent documents, clauses, commitments or numbers. If you cannot quote it, do not cite it.
4. If you are unsure whether something is a risk, still report it (over-flagging is preferred to missing a risk) but set confidence "LOW" and finding_type "UNRESOLVED_QUESTION".
5. Potential conflicts with past commitments are "potential conflicts", never "breaches".
6. AtliQ has no fixed negotiation policy. Compare commercial terms with the PRECEDENTS given (what AtliQ accepted or rejected before); do not invent thresholds.
7. Do NOT repeat items listed under ALREADY FLAGGED — the deterministic engine has them. Look for anything else a careful reviewer would raise.
8. Judge risk from AtliQ's side of the table (see ROLE). When AtliQ is the BUYER, also flag terms that are unfair to the smaller counterparty (category "fairness_to_counterparty") — AtliQ prefers balanced deals.
9. You may see only PART of the contract. Judge only the clauses shown. Never report a term as missing or absent if the OUTLINE lists a section that could contain it — other parts are reviewed separately.
10. Read carefully who grants or owes what to whom. AtliQ's standard positions are NOT risks: the client owning deliverables made specifically for it after payment; AtliQ keeping its pre-existing tools and licensing them to the client; mutual obligations.
12. Prefer fewer, material findings. Do not flag routine boilerplate (payment currency, assignment needing consent, transition help at agreed rates, invoicing mechanics, data-residency duties that are normal for the client's country) unless it creates real exposure for AtliQ.
11. In contract_quote copy the clause text only — do not include the bracketed ref or the clause number.

SEVERITY: CRITICAL = could threaten the company or collide with an existing commitment; HIGH = material money/IP/liability exposure or clearly one-sided; MEDIUM = worth negotiating; LOW = note for awareness.
CATEGORIES: liability, indemnity, liquidated_damages, payment, ip, termination, governing_law_entity, non_compete_exclusivity, pricing_mfn, data_protection, nda_mutuality, insurance, fairness_to_counterparty, required_documents, other.
FINDING TYPES: POTENTIAL_RISK, HISTORICAL_CONFLICT, DOCUMENT_GAP, UNRESOLVED_QUESTION.

Reply with ONE JSON object only:
{"summary": "3-4 plain-English sentences on what this contract is and its main risks for AtliQ (no sign/reject advice; empty string if told to skip)",
 "findings": [{"finding_type": "...", "category": "...", "severity": "...", "title": "short title", "explanation": "why it matters to AtliQ in at most 3 sentences, citing precedent where relevant", "clause_ref": "ref as shown, without brackets", "contract_quote": "exact text", "evidence": [{"source_file": "...", "clause_ref": "...", "quote": "exact text"}], "confidence": "HIGH|MEDIUM|LOW"}]}
At most 4 findings per request, most material first; return an empty list if nothing beyond ALREADY FLAGGED is worth raising. Use HIGH or CRITICAL only for exposure that could cost a material share of the contract value, lose AtliQ's IP, or create a compliance breach; routine client protections (removal of personnel, re-performance of defects, audit rights, dispute withholding, standard warranties) are MEDIUM at most. Keep evidence to items you can quote exactly.`;

export function buildReviewPrompt(p: {
  title: string;
  counterparty: string;
  role: string;
  entity: string;
  contractType: string;
  country: string;
  dealContext: string;
  alreadyFlagged: string[];
  commitments: string[];
  precedents: string[];
  history: string[];
  contractBlock: string;
  outline: string;
  chunkNote: string;
  wantSummary: boolean;
}): string {
  return `CONTRACT: ${p.title}
COUNTERPARTY: ${p.counterparty} (${p.country})
TYPE: ${p.contractType}
ROLE: AtliQ is the ${p.role.toUpperCase()} — signing entity ${p.entity}
TODAY: 2026-09-28
${p.dealContext ? `DEAL CONTEXT NOTE (from the reviewer / seller, not part of the contract): ${p.dealContext}\n` : ""}${p.chunkNote}
${p.wantSummary ? "" : "Skip the summary (return an empty string) — another part produces it.\n"}
ALREADY FLAGGED OR SETTLED (do not repeat or contradict):
${p.alreadyFlagged.length ? p.alreadyFlagged.map((x) => `- ${x}`).join("\n") : "- (none)"}

COMMITMENTS AtliQ HAS ALREADY SIGNED (from the commitments register):
${p.commitments.join("\n") || "- (none relevant)"}

PRECEDENTS (how AtliQ negotiated before — history, not rules):
${p.precedents.join("\n")}

HISTORY (retrieved passages; status matters — drafts and notes are not binding):
${p.history.join("\n") || "- (none)"}

OUTLINE OF THE WHOLE CONTRACT (sections that exist, even if not shown below):
${p.outline}

CONTRACT (clause refs in brackets):
${p.contractBlock}`;
}
