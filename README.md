# AtliQ Contract Risk Analyzer — User Guide

An AI review assistant that checks incoming client and partner contracts against what AtliQ has
**already signed**, how it **negotiated before**, and fact-based **rules**. Every finding is backed by
verbatim evidence, and every decision is made by a human.

> **Review assistant — not legal advice.** The AI never approves, rejects, signs or sends anything.


**Login user id**: karandeep
**password:** 123

**Author:** Azaruddin Tamboli, AI Product Manager (AI PM Bootcamp)

| | |
|---|---|
| **Live prototype** | https://atliq-contract-risk-analyzer-codebasic2.vercel.app |
| **Miro board** | _add link here_ |

## 1. Sign in

Open the live link and sign in with your AtliQ account.

| Role | Who | Can do |
|---|---|---|
| **Authorised signer** | Karandeep (CEO) | Everything, including recording the final decision |
| **Stakeholder** | Bhavin, Dhaval, Jay, Pranav | Review, upload, confirm / dismiss / flag findings, export reports |

Demo credentials are shared privately by the project owner.

## 2. Review queue (home page)

All incoming contracts, sorted by deadline.

- **Deadline** — red means due within 3 days.
- **Attention** — number of Critical (C) and High (H) findings.
- **Bundles** — related documents of one deal are grouped (e.g. Harrington NDA + MSA + BAA), with a
  "Bundle incomplete" warning when a required document isn't signed yet.
- **Search and filters** — by counterparty, document type, status, AtliQ entity, deadline or attention.
- Click a contract to open its review.

## 3. Review a contract (workspace)

The contract is on the left and the AI review on the right. Click any finding to jump to the exact
clause, highlighted in the contract.

| Tab | What you see |
|---|---|
| **Summary** | Key terms (value, payment, liability cap, governing law…) with clause references, and a coverage table showing every clause's review status |
| **Findings** | Prioritised risks: **Potential risk**, **Historical conflict**, **Document gap**, **Unresolved question**. Low-confidence items sit in a separate "Not sure — please verify" section |
| **Commitments** | Conflicts with signed contracts, shown side by side: this contract vs. the signed clause, with its status and end date |
| **Checks** | Fact checks marked **✓ Passed**, **✗ Flagged** or **? Could not verify** (signing entity, governing law, healthcare BAA, GDPR DPA, NDA mutuality, insurance, annexes) |
| **Decision** | Review progress, your final decision and the decision history |

**Reading a finding**
- **Contract clause** — the exact text from the contract. **✓ Verified in source** means the quote was
  found word-for-word.
- **Why it matters** — the explanation, labelled *AI analysis* or *Rule-based analysis*.
- **Evidence** — the source document, its clause and its status (Signed · Active, Expired, Draft, Meeting note…).
- **AtliQ precedent** — how similar clauses were negotiated before (Standard, Deliberate exception,
  Waved through, Walked away).
- **Escalation hints** — who else should look (counsel, Finance, CTO).

**Act on each finding:** **Confirm**, **Dismiss** or **Flag for verification**, with an optional
rationale. Every action is recorded in the audit trail; dismissed findings are kept, not deleted.

**Banners:** a green banner means the first-pass review is complete. A purple **"Incomplete review"**
banner means something could not run (for example AI analysis), so don't treat that review as clean.

## 4. Record the decision

Open the **Decision** tab and choose **Proceed to sign**, **Negotiate**, **Escalate to counsel** or
**Reject**, with a rationale. Only the authorised signer can record it. The decision is saved with
the reviewer's name, the time, the review version and any open items.

## 5. Export the report

Click **Export report** → **Print / save as PDF**. The report includes the summary, key terms, all
findings with evidence, checks, unresolved questions, clause coverage, reviewer actions, the
decision and the audit trail.

## 6. Review a new contract

1. Click **+ New review** and drop in a **PDF (text-based), DOCX, Markdown or TXT** file.
2. Check the auto-detected **Review setup**: contract type, AtliQ signing entity, AtliQ role,
   counterparty country, checks to run. Optionally add a **deal context note** (anything agreed on
   calls that isn't in the contract).
3. Click **Run review** and watch the steps: reading → key terms → commitments register →
   precedents → entity & documents → AI analysis → evidence verification.
4. Unsupported, scanned or password-protected files are refused with a clear message; no partial
   report is produced.
5. To review a revised version, open the contract and use **Review setup / Re-review**. The full
   document is always reviewed again, and earlier versions stay available.

## 7. Knowledge pages

| Page | Purpose |
|---|---|
| **Commitments register** | Everything AtliQ has already promised (non-competes, exclusivity, MFN pricing, IP handed over, data location), with status (Active / Expiring / Expired / Spent) and a "Verified by human" tick |
| **Precedents** | How AtliQ negotiated each clause type before — history, not policy |
| **Rules** | The fact-based checks (R1–R10) and AtliQ's legal entities |
| **Signed library** | All historical source documents and their status |
| **Reports & audit** | Every action, re-review and decision, with a JSON download |

## 8. Good to know (prototype limits)

- Built on a **fully synthetic dataset** (15 incoming drafts, 17 signed contracts).
- **Reviewer actions, decisions and the audit trail are stored in your browser**, not shared between users.
- The free hosting plan limits each live review to about a minute; long contracts may come back
  marked **partial**, with unanalysed clauses labelled.
- AI analysis uses a free model tier with daily limits. When the limit is reached, reviews still
  run on the rule engine and are labelled **incomplete**.

## Repository contents

| File / folder | What's inside |
|---|---|
| `AI_PRD_Contract Risk Analyzer_1.0.docx` | Product requirements document |
| `PROBLEM DISCOVERY & USER RESEARCH.xlsx` | Problem discovery and user research |
| `COST ESTIMATION_Contract Risk Analyzer.xlsx` | Inference, embeddings, infrastructure, cost savings and ROI |
| `prototype/` | Source code, dataset and evals — developer setup in [`prototype/README.md`](prototype/README.md) |

---
*AI PM capstone project by Azaruddin Tamboli.*
