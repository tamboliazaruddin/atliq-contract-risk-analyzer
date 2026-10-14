# AtliQ Contract Risk Analyzer — instructions for Claude Code

You are helping an AI Product Manager build a capstone prototype. **`docs/PRD.md` is the source of truth.**
If anything in this file conflicts with the PRD, follow the PRD and tell the user about the conflict.
**`docs/UI_REFERENCE.md` is the UI spec** (competitor LegalOn screens in `docs/competitor-ui/`, adapted to
AtliQ). Read it before any UI work; follow its layouts, not LegalOn's branding.

## How to work with me (approval gates)
1. Before writing code for any phase, show a short plan (files to create/change, approach) and **wait for my approval**.
2. Work one phase at a time from `docs/BUILD_PLAN.md`. Do not start the next phase until I say so.
3. Never take autonomous product decisions (scope, thresholds, wording of flags). Ask me.
4. After each phase: run `npm run build` (and `npm run eval` once it exists) and report results honestly.
5. Keep changes small. Do not rewrite files you were not asked to touch.

## Product in one paragraph
A web portal for Karandeep (founder, sole signer at AtliQ) that reviews an incoming **client or partner contract**
against AtliQ's own contract memory — a **commitments register** (non-competes, exclusivity, MFN/pricing promises,
IP handed over, data-location rules, extracted from signed contracts, including expired ones) and a **precedent
library** (how AtliQ negotiated similar clauses before) — and returns one easy-to-read, **cited** review brief in
under 5 minutes, with no clause skipped. Humans approve, negotiate and sign. The AI never does.

## Non-negotiable guardrails (enforce in code AND prompts)
- The AI **never** approves, rejects, signs, sends anything to a counterparty, or claims to give legal advice.
  The UI shows "Review assistant — not legal advice. Decision rests with the signer."
- **Every finding must cite evidence**: the clause reference in the incoming contract AND, for cross-contract
  findings, the source file + clause in `data/raw/`. A finding without a citation must be dropped or downgraded to
  "Needs verification".
- **Grounding check in code**: verify each quoted snippet actually exists in the source text (normalised substring
  match). If not found → mark `grounded: false` and show it as "Not verified".
- **Uncertainty is explicit**: low-confidence items go into a separate "Not sure — please verify" section.
- **Over-flag rather than miss** (client preference), but rank by severity so critical items come first.
- **No hard-coded negotiation thresholds** (client has no fixed policy). Show precedent/history, not rules.
  Deterministic checks are allowed only for facts: entity ↔ region, governing law ↔ entity, required companion
  documents, dates/expiry.
- **Coverage**: the brief includes a clause coverage table listing every clause/section of the contract with a status.
- **Re-review**: a re-uploaded/negotiated version is always reviewed in full, never as a diff only.
- **Confidentiality**: mask counterparty personal names, emails and rates before sending text to the LLM where
  practical (`src/lib/masking.ts`); never log full contract text to the console in production.
- Expired restrictions are still shown (labelled "Expired") — the client asked for this.

## Scope (MVP)
- In: client and partner contracts + NDAs from `data/raw/incoming/` (and synthetic ones in `data/synthetic/`).
- Out: freelancer/employee contracts (Marcus Reed, Daniel Ortiz drafts are out of scope — may be shown as
  "out of scope" if uploaded), government contracts, mobile app, non-English, live WhatsApp/Slack sync,
  client credit/legitimacy checks. Login is not needed for the demo (app opens as Karandeep).
- Lifecycle kept simple: Received → In review → Negotiating → Signed / Rejected (status set by a human).

## Tech stack
- Next.js 15 (App Router, TypeScript, `src/` dir), Tailwind CSS v4.
- Anthropic SDK (`@anthropic-ai/sdk`), model from `ANTHROPIC_MODEL` env var. Use structured JSON output
  validated with **zod** (`src/lib/types.ts`). Retry once on invalid JSON, then fail visibly.
- `pdf-parse` / `mammoth` for PDF/DOCX → text on upload.
- No database for the MVP: JSON files in `data/derived/` (register, precedents, rules, pre-generated reviews);
  reviewer actions, decisions and audit trail live in browser localStorage for the demo.
  On Vercel the filesystem is read-only at runtime → pre-generate `data/derived/*.json` locally and commit them;
  new uploads are reviewed in-memory and returned to the browser.
- Deploy: local → GitHub → Vercel (free tier). `ANTHROPIC_API_KEY` set in Vercel env vars, never committed.

## Folder map
- `data/raw/` — the provided dataset, **read-only**. Never edit these files.
- `data/derived/` — generated + human-verified knowledge: `commitments_register.json`, `precedents.json`,
  `entities.json`. Each record carries `source_file`, `clause_ref`, `quote`, `verified_by_human`.
- `data/synthetic/` — extra test contracts we create for edge cases.
- `evals/` — `golden_cases.json` (expected findings per test contract) + eval runner output.
- `scripts/` — offline jobs run with `npx tsx` (build register, build precedents, run evals).
- `src/lib/` — loaders, LLM client, prompts, deterministic checks, masking, scoring, types.
- `src/app/` — pages: `/` queue, `/review/[id]` brief, `/register` commitments register; API routes under `/api`.

## Commands
- `npm run dev` — local app at http://localhost:3000
- `npm run build` — must pass before every commit
- `npm run register` — extract commitments from signed contracts → `data/derived/commitments_register.json`
- `npm run precedents` — build precedent library from negotiation notes + signed contracts
- `npm run review-all` — pre-generate reviews of dataset contracts → `data/derived/reviews/`
- `npm run eval` — run golden test cases and print recall / precision per category

## Today's date for the dataset
Treat "today" as **2026-09-28** for all expiry / deadline logic (configurable via `DATASET_TODAY`).
