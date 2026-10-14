# AtliQ Contract Risk Analyzer

AI PM capstone project for AtliQ Technologies: an AI-assisted contract review assistant that checks incoming client
and partner contracts against what AtliQ has already signed, how it negotiated before, and fact-based rules —
with every finding backed by verbatim evidence and the final decision left to a human.
Login 
user id: karandeep
password: 123

**Author:** Azaruddin Tamboli, AI Product Manager (AI PM Bootcamp)

| | |
|---|---|
| **Live prototype** | https://atliq-contract-risk-analyzer-codebasic2.vercel.app |
| **Miro board** | _add link here_ |


## Prototype at a glance

- Review queue of 15 incoming drafts, upload of PDF / DOCX / Markdown contracts, split-view review workspace,
  printable report, commitments register, precedent library, rules and audit trail.
- Hybrid engine: deterministic commitment / clause / rule checks plus an LLM layer (Groq `gpt-oss-120b`), with
  word-for-word grounding of every quote.
- Release-gate evals per the PRD (§11): run `npm run eval` inside `prototype/`.

Not legal advice. Built on a fully synthetic dataset.
