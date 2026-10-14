import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums (PRD §9.2 finding types, BUILD_PLAN risk categories)
// ---------------------------------------------------------------------------

export const Severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type Severity = z.infer<typeof Severity>;

export const FindingType = z.enum(["POTENTIAL_RISK", "HISTORICAL_CONFLICT", "DOCUMENT_GAP", "UNRESOLVED_QUESTION"]);
export type FindingType = z.infer<typeof FindingType>;

export const Category = z.enum([
  "liability",
  "indemnity",
  "liquidated_damages",
  "payment",
  "ip",
  "termination",
  "governing_law_entity",
  "non_compete_exclusivity",
  "pricing_mfn",
  "data_protection",
  "nda_mutuality",
  "insurance",
  "fairness_to_counterparty",
  "required_documents",
  "other",
]);
export type Category = z.infer<typeof Category>;

export const Confidence = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Confidence = z.infer<typeof Confidence>;

/** Status of a source document, so drafts / expired records are never treated as active commitments (PRD §7.2). */
export const DocStatus = z.enum([
  "signed_active",
  "signed_expired",
  "signed_expiring",
  "signed_spent",
  "draft_in_review",
  "negotiation_note",
  "meeting_note",
  "tracker_note",
  "reference_data",
  "this_contract",
]);
export type DocStatus = z.infer<typeof DocStatus>;

export const CheckStatus = z.enum(["passed", "flagged", "could_not_verify", "not_applicable"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const AtliqEntity = z.enum(["pvt_ltd", "inc", "unknown"]);
export type AtliqEntity = z.infer<typeof AtliqEntity>;

export const AtliqRole = z.enum(["supplier", "partner", "buyer", "mutual"]);
export type AtliqRole = z.infer<typeof AtliqRole>;

export const ContractType = z.enum(["MSA", "SOW", "NDA", "Partnership", "BAA", "DPA", "Pilot", "Services", "Subcontractor", "Contractor", "Other"]);
export type ContractType = z.infer<typeof ContractType>;

// ---------------------------------------------------------------------------
// Contract structure
// ---------------------------------------------------------------------------

export const Clause = z.object({
  id: z.string(), // stable anchor id, e.g. "c-12-2"
  ref: z.string(), // human ref, e.g. "§12.2" or "Schedule 2"
  heading: z.string(), // section heading the clause sits under
  text: z.string(),
  line: z.number(), // 1-based start line in the source text
});
export type Clause = z.infer<typeof Clause>;

export const Evidence = z.object({
  source_file: z.string(), // path relative to data/raw, or "this contract"
  clause_ref: z.string(),
  quote: z.string(),
  doc_status: DocStatus,
  grounded: z.boolean().default(false),
  label: z.string().optional(), // e.g. "Signed: Al Noor MSA §12.1 (Active until ~Sep 2029)"
});
export type Evidence = z.infer<typeof Evidence>;

export const Finding = z.object({
  id: z.string(),
  finding_type: FindingType,
  gap_kind: z.enum(["confirmed", "potential"]).optional(), // DOCUMENT_GAP only
  category: Category,
  severity: Severity,
  title: z.string(),
  explanation: z.string(), // AI / engine analysis — labelled as such in the UI
  contract_clause_ref: z.string(),
  contract_clause_id: z.string().optional(),
  contract_quote: z.string(),
  contract_quote_grounded: z.boolean().default(false),
  evidence: z.array(Evidence).default([]),
  precedent_ids: z.array(z.string()).default([]),
  commitment_id: z.string().optional(),
  rule_id: z.string().optional(),
  confidence: Confidence,
  grounded: z.boolean().default(false), // all quotes verified in source
  escalation_hints: z.array(z.string()).default([]),
  needs_info: z.string().optional(), // what is still needed to confirm (gaps / questions)
  source: z.enum(["rule", "pattern", "register", "llm", "context"]),
});
export type Finding = z.infer<typeof Finding>;

export const CheckResult = z.object({
  id: z.string(),
  rule_id: z.string().optional(),
  name: z.string(),
  status: CheckStatus,
  detail: z.string(),
  evidence: z.array(Evidence).default([]),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const KeyTerm = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  clause_ref: z.string().optional(),
  clause_id: z.string().optional(),
  quote: z.string().optional(),
  status: z.enum(["found", "missing", "ambiguous"]),
});
export type KeyTerm = z.infer<typeof KeyTerm>;

export const CoverageRow = z.object({
  clause_id: z.string(),
  ref: z.string(),
  heading: z.string(),
  status: z.enum(["flagged", "reviewed_no_issue", "rule_scan_only", "not_analysed"]),
  finding_ids: z.array(z.string()).default([]),
});
export type CoverageRow = z.infer<typeof CoverageRow>;

export const RetrievedPassage = z.object({
  source_file: z.string(),
  title: z.string(),
  clause_ref: z.string(),
  text: z.string(),
  doc_status: DocStatus,
  score: z.number(),
});
export type RetrievedPassage = z.infer<typeof RetrievedPassage>;

export const ReviewConfig = z.object({
  contract_type: ContractType,
  atliq_entity: AtliqEntity,
  atliq_role: AtliqRole,
  counterparty_country: z.string(),
  checks: z.object({
    clause_risks: z.boolean(),
    commitments: z.boolean(),
    precedents: z.boolean(),
    entity_law: z.boolean(),
    required_documents: z.boolean(),
    nda_mutuality: z.boolean(),
  }),
  deal_context: z.string().default(""),
});
export type ReviewConfig = z.infer<typeof ReviewConfig>;

export const StepTiming = z.object({
  step: z.string(),
  status: z.enum(["done", "failed", "skipped"]),
  ms: z.number(),
  note: z.string().optional(),
});
export type StepTiming = z.infer<typeof StepTiming>;

export const ReviewResult = z.object({
  review_id: z.string(),
  contract_id: z.string(), // tracker id or "upload-…"
  file_name: z.string(),
  title: z.string(),
  counterparty: z.string(),
  version: z.number().default(1),
  text_hash: z.string(),
  generated_at: z.string(),
  dataset_today: z.string(),
  in_scope: z.boolean(),
  out_of_scope_reason: z.string().optional(),
  config: ReviewConfig,
  ai: z.object({
    provider: z.string(),
    model: z.string(),
    status: z.enum(["completed", "partial", "not_run", "failed"]),
    note: z.string().optional(),
  }),
  completeness: z.enum(["complete", "incomplete"]),
  completeness_notes: z.array(z.string()).default([]),
  summary: z.string(),
  key_terms: z.array(KeyTerm),
  findings: z.array(Finding),
  checks: z.array(CheckResult),
  coverage: z.array(CoverageRow),
  retrieved: z.array(RetrievedPassage).default([]),
  attention_score: z.number(),
  counts: z.object({ CRITICAL: z.number(), HIGH: z.number(), MEDIUM: z.number(), LOW: z.number() }),
  timings: z.array(StepTiming).default([]),
  processing_ms: z.number(),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

// ---------------------------------------------------------------------------
// Knowledge base (data/derived)
// ---------------------------------------------------------------------------

/** How the engine decides whether an incoming contract may collide with a commitment. */
export const Matcher = z.discriminatedUnion("kind", [
  // every group must have at least one keyword hit somewhere in the contract
  z.object({
    kind: z.literal("keyword_groups"),
    groups: z.array(z.object({ name: z.string(), any: z.array(z.string()) })),
    // when this matches the parties / recitals, the counterparty itself is squarely in scope (direct conflict)
    direct_regex: z.string().optional(),
  }),
  // incoming rate card lower than the protected rate card for the same roles
  z.object({ kind: z.literal("mfn_rates"), rates: z.record(z.string(), z.number()), currency: z.string() }),
  // a named asset of AtliQ already assigned away
  z.object({ kind: z.literal("asset_reuse"), assets: z.array(z.string()) }),
  // a covered engagement list — used for engagement-specific documents (e.g. subcontractor BAA)
  z.object({ kind: z.literal("engagement_scope"), covers: z.array(z.string()), applies_when: z.array(z.string()) }),
  z.object({ kind: z.literal("none") }),
]);
export type Matcher = z.infer<typeof Matcher>;

export const Commitment = z.object({
  id: z.string(),
  type: z.enum([
    "NON_COMPETE",
    "EXCLUSIVITY",
    "MFN_PRICING",
    "IP_ASSIGNMENT",
    "IP_RETAINED_BY_CONTRACTOR",
    "DATA_LOCATION",
    "NON_SOLICIT",
    "WAIVER",
    "LD_EXCEPTION",
    "LD_UNCAPPED",
    "STAFFING_COMMITMENT",
    "SUBCONTRACTOR_BAA",
    "INSURANCE_MINIMUM",
  ]),
  counterparty: z.string(),
  source_file: z.string(),
  clause_ref: z.string(),
  quote: z.string(),
  extra_quotes: z.array(z.object({ clause_ref: z.string(), quote: z.string() })).default([]),
  scope: z.string(),
  sectors: z.array(z.string()).default([]),
  geographies: z.array(z.string()).default([]),
  binds_affiliates: z.boolean(),
  atliq_entity: z.string(),
  start: z.string().optional(),
  end: z.string().optional(), // ISO date; open-ended when absent
  end_note: z.string().optional(),
  status_override: z.enum(["active", "expired", "waived", "spent", "perpetual"]).optional(),
  related_ids: z.array(z.string()).default([]),
  matcher: Matcher,
  conflict_severity: Severity,
  conflict_note: z.string(),
  verified_by_human: z.boolean().default(false),
});
export type Commitment = z.infer<typeof Commitment>;

export const PrecedentTag = z.enum(["standard", "deliberate_exception", "waved_through", "walked_away", "softened_for_counterparty"]);
export type PrecedentTag = z.infer<typeof PrecedentTag>;

export const Precedent = z.object({
  id: z.string(),
  category: Category,
  counterparty: z.string(),
  date: z.string(),
  atliq_role: AtliqRole,
  they_asked: z.string(),
  atliq_agreed: z.string(),
  tag: PrecedentTag,
  outcome: z.string().optional(),
  source_file: z.string(),
  quote: z.string(),
  verified_by_human: z.boolean().default(false),
});
export type Precedent = z.infer<typeof Precedent>;

export const SignedDoc = z.object({
  file: z.string(), // relative to data/raw
  counterparty: z.string(),
  doc_type: z.string(),
  atliq_entity: z.string(),
  tracker_ids: z.array(z.string()).default([]),
  signed: z.string().optional(),
  expiry: z.string().optional(),
  status_override: DocStatus.optional(),
  sector: z.string(),
  country: z.string(),
  stored: z.string(),
  notes: z.string().optional(),
});
export type SignedDoc = z.infer<typeof SignedDoc>;

/** Active client relationships — used to test incoming non-competes against who AtliQ already serves. */
export const PortfolioClient = z.object({
  counterparty: z.string(),
  sector_keywords: z.array(z.string()),
  country: z.string(),
  relationship: z.string(),
  source_file: z.string(),
  clause_ref: z.string(),
  quote: z.string(),
  active_until: z.string().optional(),
  status: z.enum(["active", "pipeline", "ended"]),
});
export type PortfolioClient = z.infer<typeof PortfolioClient>;

export const Rule = z.object({
  id: z.string(),
  name: z.string(),
  text: z.string(),
  applies_to: z.string(),
  source: z.string(),
});
export type Rule = z.infer<typeof Rule>;

// ---------------------------------------------------------------------------
// Queue / tracker
// ---------------------------------------------------------------------------

export const TrackerRow = z.object({
  contract_id: z.string(),
  counterparty: z.string(),
  doc_type: z.string(),
  atliq_entity: z.string(),
  client_country: z.string(),
  requested_by: z.string(),
  received_date: z.string(),
  status: z.string(),
  signed_date: z.string(),
  expiry_date: z.string(),
  value_usd: z.string(),
  file_location: z.string(),
  restrictive_clauses: z.string(),
  notes: z.string(),
});
export type TrackerRow = z.infer<typeof TrackerRow>;

export const QueueItem = z.object({
  id: z.string(), // tracker id
  file: z.string(), // relative to data/raw
  file_name: z.string(),
  title: z.string(),
  counterparty: z.string(),
  doc_type: z.string(),
  atliq_entity: z.string(),
  country: z.string(),
  requested_by: z.string(),
  received: z.string(),
  value_usd: z.number().nullable(),
  deadline: z.string().nullable(),
  deadline_source: z.string().nullable(),
  tracker_status: z.string(),
  notes: z.string(),
  bundle: z.string().nullable(),
  in_scope: z.boolean(),
  duplicate_of: z.string().nullable(),
});
export type QueueItem = z.infer<typeof QueueItem>;

// ---------------------------------------------------------------------------
// Human-in-the-loop (stored in browser localStorage for the demo)
// ---------------------------------------------------------------------------

export const ReviewerActionKind = z.enum(["confirm", "dismiss", "flag"]);
export type ReviewerActionKind = z.infer<typeof ReviewerActionKind>;

export const ReviewerAction = z.object({
  finding_id: z.string(),
  action: ReviewerActionKind,
  rationale: z.string().default(""),
  by: z.string(),
  at: z.string(),
});
export type ReviewerAction = z.infer<typeof ReviewerAction>;

export const DecisionKind = z.enum(["proceed_to_sign", "negotiate", "escalate_to_counsel", "reject"]);
export type DecisionKind = z.infer<typeof DecisionKind>;

export const Decision = z.object({
  decision: DecisionKind,
  rationale: z.string(),
  by: z.string(),
  at: z.string(),
  review_id: z.string(),
  version: z.number(),
  open_critical: z.number(),
  unreviewed: z.number(),
});
export type Decision = z.infer<typeof Decision>;
