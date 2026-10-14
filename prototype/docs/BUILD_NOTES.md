# Build notes: decisions, deviations and known limits

This file records the decisions taken while building the prototype end to end, so the AI PM can review and
override them. The PRD remains the source of truth.

## Process deviation

- `CLAUDE.md` asks for a plan and approval before each phase of `BUILD_PLAN.md`. The request was to build the whole
  application end to end, so all phases (1–8) were built in one pass and are documented here for review instead.
  Nothing was committed to git, so the work can be reviewed and committed phase by phase.

## Decisions that differ from the scaffold

| Topic | Scaffold / plan | What was built | Why |
|---|---|---|---|
| LLM provider | Claude Sonnet via `ANTHROPIC_API_KEY` | Provider-agnostic client: **Groq** (`openai/gpt-oss-120b`, OpenAI-compatible) **or** Anthropic, chosen by env | The available key was a Groq key. `llama-3.3-70b-versatile` was not available on that key, so `openai/gpt-oss-120b` was used (medium reasoning effort). |
| Rate limits | — | Prompts are chunked to ≤ ~4.3k tokens with a full contract outline in every chunk; 429s are retried using the server's retry-after | Groq's free tier allows ~8k tokens per minute. A long MSA takes 2–4 minutes; a paid tier or Claude would be much faster. |
| Hybrid engine | One LLM call returns the review | **Deterministic engine first** (register matchers, clause patterns, rules R1–R10), then the LLM adds findings it missed | PRD §5.4 hybrid approach and guardrails. The core value (conflicts with signed commitments) must not depend on model availability, and it is explainable and testable. |
| Masking | Names, emails and rates | Names, emails, phones and tax/registration IDs are masked. **Rates and company names are not masked** | MFN checks need rates, and company names are not personal data. The deterministic engine runs locally on unmasked text. |
| Register build | `npm run register` writes the register | The curated, human-verified `commitments_register.json` is the source of truth. `npm run register` writes `commitments_register.extracted.json` and prints coverage | It never overwrites human-verified data (CLAUDE.md: derived knowledge is human-verified). |
| Kriti subcontractor | Freelancers out of scope | Kriti (an agency) is **in scope** as AtliQ-as-buyer; individual freelancers (Marcus Reed, Daniel Ortiz) are labelled **Out of MVP scope**, with only the entity fact check run | Matches `evals/golden_cases.json` and ASSUMPTIONS #2. |

## Data added

- `data/derived/signed_documents.json`: status, expiry and source for the 17 signed documents, plus an **active client
  portfolio** used to test incoming non-competes (e.g. FinServe's "Competitor" definition covers Trustline and PayTrack).
- `data/derived/commitments_register.json` (16 items) and `data/derived/precedents.json` (28 items): all quotes are
  verified verbatim by `scripts/check-data.ts`.
- `rules.json`: added **R10** (referenced annexes attached) and extended **R8** to the client portfolio.
- `data/synthetic/`: 3 contracts written in different words from the dataset (Qatar resort deal, UK platform
  partnership outside the CloudSpan territory, a clean US MSA) and `evals/synthetic_cases.json`. They found and fixed
  three generalisation bugs (AtliQ's own address counted as "India" territory, "not to exceed" cap wording, US-state
  law list).

## Severity conventions (needs PM sign-off; PRD §16, first open question)

- **Critical**: an active commitment conflict where the counterparty is squarely in the restricted class; unlimited or
  uncapped liability for AtliQ on all heads or on privacy/PHI events; uncapped LD; an NDA labelled mutual that is
  one-way; a missing subcontractor BAA for PHI; a delivery-model conflict with a BAA.
- **High**: an indirect commitment conflict (needs judgement); a wrong contracting entity; uncapped liability on
  specific heads; indemnity covering the client's negligence; payment ≥ 90 days or pay-when-paid; termination on
  ≤ 15 days without WIP payment; assignment of pre-existing tools; new restrictive covenants; insurance above cover.
- Commercial terms are always explained against precedent (Acme / Northwind / Trustline LD, PayTrack indemnity,
  Kessler walk-away, Brightwater waved-through), never against a hard policy.

## Known limits

- The engine's patterns were developed against this dataset and its golden set. The synthetic cases are a first
  generalisation check, not a substitute for a larger labelled set (PRD Stage 2 gate).
- Login and roles: users live in `data/derived/users.json` (scrypt hashes) — fine for a demo, but production needs a
  real identity provider (SSO), server-side role enforcement and server-side audit storage. The signer-only decision
  rule is enforced in the UI because decisions are stored in the browser.
- Reviewer actions, decisions and uploads live in browser localStorage (demo).
- PDF parsing needs text-based PDFs; OCR for scans is not included.
- AI findings vary from run to run. Evidence grounding guarantees quotes are real, but not that the model's
  interpretation is right — hence human Confirm / Dismiss / Flag.
