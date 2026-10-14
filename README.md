# AtliQ Contract Risk Analyzer (capstone prototype)

An AI review assistant for AtliQ's founder. It reviews an incoming client or partner contract against **AtliQ's own
contract memory**:

- a **commitments register**: non-competes, exclusivity, MFN pricing, IP handed over, data-location rules and
  engagement-specific BAAs extracted from the 17 signed contracts, including expired ones;
- a **precedent library**: how AtliQ negotiated similar clauses before;
- deterministic **fact rules**: entity ↔ region, governing law, required companion documents, insurance and annexes.

It returns one cited, evidence-checked review in a split-view workspace. Humans confirm findings, decide and sign;
the AI never does. **Not legal advice.**

Source of truth: [`docs/PRD.md`](docs/PRD.md) · UI spec: [`docs/UI_REFERENCE.md`](docs/UI_REFERENCE.md) ·
build decisions: [`docs/BUILD_NOTES.md`](docs/BUILD_NOTES.md).

## Run locally

1. Node.js 20+ (`node -v`).
2. `npm install`
3. Copy `.env.example` to `.env.local` and add an LLM key (`GROQ_API_KEY` or `ANTHROPIC_API_KEY`).
   Without a key, the app still runs, but reviews are deterministic only and clearly marked **incomplete**.
4. `npm run users` — creates the demo accounts (Karandeep = authorised signer; Bhavin, Dhaval, Jay, Pranav =
   stakeholders) with random passwords written to `DEMO_ACCOUNTS.local.txt` (git-ignored), and adds `AUTH_SECRET`
   to `.env.local`. Re-run any time to reset passwords (`npm run users -- jay` resets one).
5. `npm run dev` → http://localhost:3000 → sign in.

## What's in the app

| Screen | PRD | What it does |
|---|---|---|
| **Sign in** `/login` | NFR security | Every page and API route requires a signed-in user (middleware). Signed HTTP-only session cookie (8 h), scrypt-hashed passwords, rate-limited sign-in, sign out. Only the **authorised signer** can record a final decision; stakeholders can review, upload, confirm/dismiss/flag findings. Actions and the audit trail record the signed-in user. |
| **Review queue** `/` | FR-3 | 15 incoming drafts from the tracker: search, filters (status, doc type, entity, deadline, attention), deadline colouring, deal **bundles** (Harrington NDA + MSA + BAA), attention badges, tracker data-quality issues, your uploads |
| **New review** `/review/new` | FR-1, FR-4 | Upload a PDF / DOCX / MD / TXT file → validation (unsupported, empty, password-protected, scanned or garbled files are refused, State 2) → auto-detected **review setup** you can edit → live review with visible progress steps |
| **Workspace** `/review/[id]` | FR-2, FR-5–FR-10 | Contract on the left (click a finding to scroll to and highlight the exact quote); tabs: **Summary** (key terms with clause refs, coverage table), **Findings** (filters, "Not sure — please verify" section, Confirm / Dismiss / Flag with rationale), **Commitments** (side-by-side "this contract vs signed contract" quotes, restrictions checked, retrieved history), **Checks** (Passed / Flagged / Could not verify), **Decision** |
| **Report** `/review/[id]/report` | FR-11 | Printable report: findings, evidence, checks, unresolved questions, coverage, reviewer actions, decision, audit trail |
| **Commitments register** `/register` | FR-5, FR-7 | What AtliQ has already promised, with status (Active / Expiring / Expired / Spent / Perpetual), verbatim source, and a "Verified by human" toggle |
| **Precedents** `/precedents` | FR-4 | History by clause type, tagged Standard / Deliberate exception / Waved through / Walked away / Softened for vendor |
| **Rules** `/rules` | FR-13 | Read-only deterministic rules R1–R10 and entity reference data |
| **Signed library** `/library` | FR-5 | The authorised historical sources and their document status |
| **Reports & audit** `/audit` | FR-12 | Every reviewer action, re-review, status change and decision; reviewer acceptance rate |

## How a review works (PRD §9.3)

1. **Read & validate** the file. Anything unreadable fails visibly, and no partial report is produced.
2. **Extract key terms** with clause references. Missing fields are flagged.
3. **Commitments register**: every active restriction is tested with an explicit matcher (sector + geography +
   service keyword groups, MFN rate comparison, asset reuse). New restrictive covenants are tested against
   AtliQ's **existing clients**, and vendor agreements against the **upstream client contract**. Meeting-note
   alerts are surfaced (e.g. PHI already shared before a BAA).
4. **Clause patterns**: liability, indemnity, LD, payment, termination, IP, NDA mutuality, restrictive covenants and
   insurance. Results are compared with **precedent, never hard thresholds**. When AtliQ is the buyer, unfair terms are
   flagged as *fairness to counterparty*.
5. **Fact rules** R1–R10 (entity, invoicing entity, governing law, US healthcare bundle, PHI flow-down, EU DPA, NDA
   reciprocity, insurance cover, attached annexes).
6. **AI clause analysis** (Groq `openai/gpt-oss-120b` or Claude). Contract text is masked (names, emails, phones, IDs)
   and sent in chunks with a full outline; the model looks for anything the engine missed.
7. **Verify evidence**: every quote is checked word-for-word against its source. Unverifiable AI findings become
   *Unresolved questions*, shown as "⚠ Not verified". Every clause gets a coverage status, every check an explicit
   status, and the review is labelled **complete** or **incomplete**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` | App |
| `npm run review-all` | Pre-generate reviews of the 15 incoming drafts → `data/derived/reviews/` (`-- --no-ai`, `-- C-025`, `-- --reuse-ai`) |
| `npm run eval` | Release-gate evals (PRD §11) on `evals/golden_cases.json` + `evals/synthetic_cases.json` → `evals/results.json` (`-- --live` re-runs every review) |
| `npm run register` | AI extraction of commitments from signed contracts → `commitments_register.extracted.json`, compared with the human-verified register |
| `npm run precedents` | Checks the precedent library: verbatim quotes and coverage of the negotiation notes |
| `npx tsx scripts/check-data.ts` | Prints the queue (entity, value, deadline, bundle) and grounding-checks every register/precedent quote |
| `npx tsx scripts/show-review.ts C-025` | Prints a pre-generated review |
| `npx tsx scripts/try-file.ts <file> [--ai]` | Reviews any local file |

## Project map

- `data/raw/`: the provided synthetic dataset (read-only).
- `data/derived/`: human-verified knowledge (`commitments_register.json`, `precedents.json`,
  `signed_documents.json`, `rules.json`, `entities.json`) and pre-generated `reviews/`.
- `data/synthetic/`: three extra test contracts added for generalisation testing.
- `src/lib/engine/`: deterministic engine (`context`, `register`, `patterns`, `rules`, `keyterms`, `scoring`).
- `src/lib/review.ts`: orchestrator; `llm.ts` provider client; `prompts/`; `masking.ts`; `retrieval.ts` (BM25 over
  signed contracts and notes); `parse.ts` (PDF/DOCX/MD).
- `src/app/`: pages and API routes (`/api/setup`, `/api/review` streams progress as NDJSON).
- `evals/`: golden cases, synthetic cases, results.

## Deploy (Vercel free / Hobby plan)

1. Push this repo to GitHub (private is fine — Vercel Hobby supports private repos).
2. In Vercel: **Add New → Project → Import** the repo. Framework preset: Next.js (auto). No build settings to change.
3. **Environment variables** (Production): `GROQ_API_KEY`, `GROQ_MODEL=openai/gpt-oss-120b`, `DATASET_TODAY=2026-09-28`,
   `AUTH_SECRET` (a new random string of 32+ characters — e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
4. Deploy. Sign in with the demo accounts from `DEMO_ACCOUNTS.local.txt` (only the hashes in `data/derived/users.json`
   are in the repo; keep the passwords file private).

Notes for the free plan:
- The dataset and the pre-generated reviews in `data/derived/reviews/` are committed and read from disk, so the
  15 dataset reviews open instantly.
- Functions are limited to 60 s on Hobby, so a **live upload** runs the full rule engine and as much AI analysis as
  fits in ~48 s; anything left is marked **"Not analysed"** and the review is labelled **partial** (never shown as
  complete). Short contracts usually finish fully.
- Groq's free tier has per-minute and per-day token limits; when they are reached, reviews still run and are
  labelled "AI not run — incomplete".
- Reviewer actions, decisions and the audit trail are stored in each browser (demo), not on the server.
