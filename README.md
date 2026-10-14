# AtliQ Contract Risk Analyzer (capstone prototype)

An AI review assistant for AtliQ's founder: it reviews a client or partner contract against AtliQ's own
contract memory (commitments register + precedent library + fact rules) and returns a cited, evidence-checked
review. Humans confirm findings, decide and sign — the AI never does. Not legal advice.

## Run locally
1. Install Node.js 20+ (`node -v`).
2. `npm install`
3. Copy `.env.example` to `.env.local` and add your `ANTHROPIC_API_KEY`.
4. `npm run dev` → http://localhost:3000

## Scripts (filled in during the build phases — see docs/BUILD_PLAN.md)
| Command | What it does |
|---|---|
| `npm run register` | Extract commitments from signed contracts → `data/derived/commitments_register.json` |
| `npm run precedents` | Build precedent library → `data/derived/precedents.json` |
| `npm run review-all` | Pre-generate reviews of the dataset contracts → `data/derived/reviews/` |
| `npm run eval` | Run the golden test set and print release-gate metrics |

## Project map
- `docs/PRD.md` — product requirements (source of truth) · `docs/UI_REFERENCE.md` — UI spec
- `docs/BUILD_PLAN.md` — phase-by-phase prompts for Claude Code · `docs/ASSUMPTIONS.md` — MVP assumptions
- `data/raw/` — provided synthetic dataset (read-only) · `data/derived/` — generated, human-verified knowledge
- `evals/` — golden test cases and expected register
- `src/` — Next.js app (App Router)

## Deploy
Push to GitHub → import the repo in Vercel → set `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATASET_TODAY` → deploy.
