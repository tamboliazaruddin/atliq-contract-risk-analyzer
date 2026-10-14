# Build plan — paste one phase prompt at a time into Claude Code

Rules for every phase:
- Start in **Plan mode** (Shift+Tab until "plan mode" shows) → read Claude's plan → approve or correct → let it code.
- After each phase: run the **Check**, then commit: `git add -A && git commit -m "phase N: <name>"`.
- If something breaks, paste the exact error into Claude Code — don't describe it.
- Decisions locked for the MVP (PRD §5.7 / §16 open items):
  1. Model: Claude Sonnet 5.5 via `ANTHROPIC_MODEL` (one-off extraction + review).
  2. Retrieval: pre-extracted, human-verified **commitments register** + **precedent library**, filtered by
     sector / geography / service metadata. No vector DB for 17 signed contracts (scale-up path in PRD).
  3. Storage: dataset reviews pre-generated to `data/derived/reviews/*.json` and committed; reviewer actions,
     decisions and audit trail stored in the browser (localStorage) for the demo; uploads reviewed live in memory.
  4. Rules: `data/derived/rules.json` (read-only Rules page). No rule editor (PRD §13.2 defers it).
  5. Freelancer agreements are not reviewed (client scope), but the "every party touching PHI needs a BAA" check stays.

PRD finding types → used in UI and evals:
`POTENTIAL_RISK` · `HISTORICAL_CONFLICT` · `DOCUMENT_GAP` (confirmed | potential) · `UNRESOLVED_QUESTION`.
Risk categories: liability, indemnity, liquidated_damages, payment, ip, termination, governing_law_entity,
non_compete_exclusivity, pricing_mfn, data_protection, nda_mutuality, insurance, fairness_to_counterparty.
(evals/golden_cases.json uses older labels: CONFLICT_WITH_COMMITMENT→HISTORICAL_CONFLICT,
MISSING_DOCUMENT→DOCUMENT_GAP, ENTITY_LAW_MISMATCH→POTENTIAL_RISK/governing_law_entity,
ONE_SIDED_TERM / PRECEDENT_DEVIATION / FAIRNESS_AS_BUYER→POTENTIAL_RISK. Map them in the eval runner.)

---

## Phase 0 — Orientation (no code)
> Read CLAUDE.md, docs/PRD.md, docs/UI_REFERENCE.md, docs/ASSUMPTIONS.md, docs/BUILD_PLAN.md,
> data/raw/README.md and evals/golden_cases.json. Summarise in 10 bullets what we are building, list every
> conflict between PRD, UI_REFERENCE and CLAUDE.md, and list questions for me. Do not write code.

**Check:** the summary matches the PRD. Answer the questions.

## Phase 1 — Types, data layer, rules (no AI)
> Create src/lib/types.ts with zod schemas: Contract, Commitment, Precedent, Rule, CheckResult
> (status passed|flagged|could_not_verify), Finding (finding_type, category, severity, title, explanation,
> contract_clause_ref, contract_quote, evidence[{source_file, clause_ref, quote, doc_status}], confidence,
> grounded, escalation_hint), KeyTerm, ReviewResult, ReviewerAction, Decision.
> Create src/lib/data.ts to load contract_tracker.csv (handle blanks + duplicate C-010/C-011), list
> data/raw/signed_contracts and data/raw/incoming, map each incoming file to its tracker row, parse the
> deadline from notes, group bundles (same counterparty). Load data/derived/entities.json and rules.json.
> Add scripts/check-data.ts printing the incoming queue with entity, value, deadline, bundle. Plan first.

**Check:** `npx tsx scripts/check-data.ts` lists all 15 incoming drafts, Harrington shown as a bundle.

## Phase 2 — Commitments register (AI extraction + human verification)
> Implement scripts/build-register.ts: for each signed contract call the LLM (prompt in
> src/lib/prompts/extractCommitments.ts) to extract restrictive obligations as zod-validated Commitment JSON:
> non-compete, exclusivity, MFN/pricing, IP assignment incl. pre-existing tools, data location, non-solicit,
> insurance minimums, LD terms, waivers/consents, engagement-specific BAAs. Each item: source_file, clause_ref,
> verbatim quote, scope (services/sector/geography), binds_affiliates, start/end, status computed from
> DATASET_TODAY (active/expired/waived). Grounding check: quote must exist in the file. Write
> data/derived/commitments_register.json (verified_by_human=false). Build the /register page per
> UI_REFERENCE §7 with filters and a "Verified by human" toggle. Plan first.

**Check:** `npm run register`; compare with evals/expected_register.json — Al Noor GCC non-compete (to ~Sep 2029,
binds affiliates), Seaside waiver, CloudSpan exclusivity, Crestline MFN, Northwind PipeKit IP, Meridian no-hire,
Orbit (Expired) must all be present. Verify each on /register; fix the JSON by hand where needed and commit it.

## Phase 3 — Precedent library
> Implement scripts/build-precedents.ts from negotiation_notes.md, karandeep_contract_checklist.md and signed
> contracts → data/derived/precedents.json grouped by risk category: counterparty, what they asked, what AtliQ
> agreed, tag standard|deliberate_exception|waved_through, source. History only, no thresholds.
> Build the /precedents page (UI_REFERENCE §7). Plan first.

**Check:** Brightwater = waved_through; Al Noor 10% LD cap = deliberate_exception; Acme/Northwind/Trustline LD = standard.

## Phase 4 — Review engine (core)
> Implement src/lib/review.ts and POST /api/review following PRD §9.3 steps 2–10:
> validate file (pdf-parse/mammoth/md; unreadable → State 2 error); split into numbered clauses; extract key
> terms (FR-2); deterministic checks from rules.json (entity↔region, law↔entity, invoicing entity, required
> documents/BAA flow-down/DPA, NDA reciprocity) returning passed|flagged|could_not_verify; retrieve relevant
> commitments + precedents by metadata; one LLM call (src/lib/prompts/review.ts) returning ReviewResult JSON;
> grounding check on every quote (not found → grounded=false, downgrade to UNRESOLVED_QUESTION); attention
> score; escalation hints (rule-based). Never output an approve/reject recommendation. Plan first.

**Check:** run on Gulf Crown via a small script → HISTORICAL_CONFLICT citing signed_contracts/2025-03-15_al_noor_hospitality_msa.md §12.

## Phase 5 — Pre-generate dataset reviews
> Add scripts/review-all.ts that runs the review for every in-scope incoming contract and writes
> data/derived/reviews/<id>.json; out-of-scope freelancer drafts get a stub "Out of MVP scope". The app reads
> these files so the deployed demo is instant; uploads still run live. Plan first.

**Check:** `npm run review-all` produces 12 review files; spot-check LoopMart (no Critical) and FinServe (mutuality + Trustline conflict).

## Phase 6 — UI (follow docs/UI_REFERENCE.md exactly)
> Build in this order, showing me a text wireframe before each screen:
> (a) app shell + left nav + "not legal advice" banner; (b) Dashboard/Review queue §1 with search, filters,
> bundles, deadline colouring, upload; (c) Review setup panel §2; (d) loading overlay with progress steps §3;
> (e) split-view workspace §4 with tabs Summary/Findings/Commitments/Checks/Decision and click-to-highlight;
> (f) expanded finding card §5 with Confirm/Dismiss/Flag + rationale stored in localStorage audit trail;
> (g) Decision panel + printable report §6; (h) Register, Precedents, Rules pages §7.
> Use Tailwind, severity colours from §8, desktop-first. Plan first.

**Check:** in the browser walk through Gulf Crown, Lakeshore, FinServe, Harrington MSA+BAA, Kriti, LoopMart.

## Phase 7 — Evals (PRD §11 release gates)
> Implement scripts/run-evals.ts using evals/golden_cases.json: material-risk recall (target ≥90%, zero critical
> misses), conflict recall (≥90%), evidence accuracy = grounded findings (≥95%), false positives on
> must_not_flag (≤20%), clean controls (LoopMart, Sunrise SOW-2) with no Critical/High, processing time per
> contract (<5 min). Print a table and save evals/results.json. Add `npm run eval`. Plan first.

**Check:** gates pass. Improve prompts/retrieval, never edit the golden set to pass. Screenshot the table for the deck.

## Phase 8 — Hardening + deploy
> Add masking before LLM calls (src/lib/masking.ts: people names, emails, phone numbers, bank details),
> error and empty states, simple rate limit on /api/review, maxDuration for the route, README run/deploy
> steps. Then guide me through GitHub + Vercel deploy with ANTHROPIC_API_KEY as an env var. Plan first.

**Check:** the Vercel URL works in a private window; a dataset review opens instantly; one live upload completes < 5 min.
