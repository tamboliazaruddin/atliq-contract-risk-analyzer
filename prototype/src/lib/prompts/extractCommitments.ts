import { z } from "zod";

export const ExtractedCommitment = z.object({
  type: z.string(),
  clause_ref: z.string(),
  quote: z.string(),
  scope: z.string(),
  geographies: z.array(z.string()).default([]),
  binds_affiliates: z.boolean().catch(false),
  end_date_or_rule: z.string().default(""),
});
export const ExtractionResult = z.object({ commitments: z.array(ExtractedCommitment).default([]) });
export type ExtractedCommitment = z.infer<typeof ExtractedCommitment>;

export const EXTRACT_SYSTEM = `You extract restrictive obligations that AtliQ (the supplier / partner / recipient) has accepted in a SIGNED contract, for AtliQ's commitments register.
Extract only obligations that could limit AtliQ's future business or that a later contract could collide with:
NON_COMPETE, EXCLUSIVITY, MFN_PRICING, IP_ASSIGNMENT (incl. pre-existing tools), IP_RETAINED_BY_CONTRACTOR, DATA_LOCATION, NON_SOLICIT, WAIVER (consents received), LD_UNCAPPED or LD_EXCEPTION, STAFFING_COMMITMENT, SUBCONTRACTOR_BAA (engagement-specific coverage), INSURANCE_MINIMUM.
Rules: copy "quote" VERBATIM from the clauses given (max 300 characters, no clause number); give clause_ref exactly as shown in brackets; say whether it binds AtliQ's Affiliates; describe when it ends (date or rule, e.g. "term + 18 months"). Do not invent anything. Mutual standard confidentiality is NOT a restriction.
Reply with one JSON object: {"commitments": [{"type": "...", "clause_ref": "...", "quote": "...", "scope": "...", "geographies": ["..."], "binds_affiliates": true|false, "end_date_or_rule": "..."}]}`;
