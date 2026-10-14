# UI reference — LegalOn Review (competitor) → AtliQ Contract Risk Analyzer

Screenshots: `docs/competitor-ui/01…07`. Use LegalOn's **layout patterns**; do NOT copy its branding, logo,
colours or wording. Every AtliQ screen must trace to a PRD requirement (FR-x).

Guiding difference: LegalOn checks **one document against generic alerts and fixed playbook rules**.
AtliQ's risk sits **outside the document** (what AtliQ already signed) and AtliQ has **no fixed negotiation
policy** (client meeting 1). So we keep LegalOn's ergonomics and add a **Commitments** layer, **precedent
history instead of hard rules**, a third **"Can't verify"** state, and **human review actions with an audit trail**.

---

## 1. Dashboard  (LegalOn: 01, 02 → AtliQ: FR-3)

**LegalOn pattern**
- Left nav: primary "Review" button; Search; Dashboard; My templates; LegalOn templates; Reporting; Configuration; My Playbooks; LegalOn in Word; Help Center. Collapsible (`«`).
- Top bar: page title, search box ("Search by file name, contract title, or party name"), Filter dropdown, Upload button.
- Table: checkbox | File name (+ uploader name + status chip "Counterparty draft") | Folders | Contract title | Counterparty / Internal party (stacked) | Uploaded (date-time) | kebab (⋯). Reload, pagination "1–4 / 4", tooltip on long file names.

**AtliQ version — "Review Queue"**
- Left nav: **New review** (primary) · Review queue · Commitments register · Precedents · Rules (read-only) · Reports. Drop templates and Word add-in (out of scope).
- Top bar: search (counterparty, title, doc type) · filters: Status, Doc type, AtliQ entity, Deadline window, Attention · **Upload contract**.
- Table columns: Contract (file name + requested-by + status chip) | Counterparty / **AtliQ entity** (stacked) | Doc type | Value (USD) | **Deadline** (red if ≤ 3 days, from tracker notes) | **Attention** (Critical/High counts badge) | Status (Received · In review · Negotiating · Signed · Rejected) | ⋯ (Open, Re-review, View report).
- Group rows of one deal as a **bundle** (e.g. Harrington: NDA signed · MSA in review · BAA in review) with a "Bundle incomplete" chip.
- Default sort: deadline ascending. Demo opens logged in as Karandeep (no login screen).

## 2. Review setup panel  (LegalOn: 03 → AtliQ: FR-4, FR-13)

**LegalOn pattern**: document preview in centre ("Show original / Show as text"), status dropdown, right
panel "Review details": restore previous review (Quick restore), Review type checkboxes (LegalOn Alerts / My
Playbooks), **Contract type auto-detected** (dropdown), **Your position** ([US] Customer), playbook checkboxes,
"Update review" button.

**AtliQ version — right panel "Review setup"**
- Contract type: auto-detected, editable (MSA, SOW, NDA, Partnership, BAA, DPA, Pilot, Services).
- **AtliQ signing entity** (auto-detected from parties clause): AtliQ Technologies Pvt Ltd / AtliQ Inc.
- **AtliQ role**: Supplier · Partner · Buyer · Mutual (NDA).
- Counterparty country/region (auto) — drives entity/law rules.
- Checks to run (all on by default, shown so the reviewer sees what will be checked): Clause risks · Commitments conflicts · Precedent comparison · Entity & governing law · Required documents (bundle) · NDA mutuality.
- **Deal context note** (free text): anything agreed on calls/WhatsApp (assumption from client meeting 1).
- Previous versions list (v1, v2…) instead of "Quick restore"; re-review always runs on the full document.
- Button: **Run review**.

## 3. Loading state  (LegalOn: 04 → AtliQ: NFR performance, behaviour states)

LegalOn: blurred page, spinner, "Loading initial review results…", Cancel.
**AtliQ**: same overlay but with **visible progress steps** (Reading document → Extracting terms →
Checking commitments register → Comparing precedents → Validating entity & documents → Verifying evidence)
and elapsed time; Cancel. On failure show behaviour **State 2** ("Could not read this file — upload a
supported or corrected file") — never a partial report that looks complete.

## 4. Review workspace — split view  (LegalOn: 05 → AtliQ: FR-9, FR-6, FR-7)

**LegalOn pattern**: left = document (editor) with the relevant clause **highlighted**; right = "Review
results by type", Filter Alerts, playbook name, cards with **Met / Unmet** icons, Expand, Revise.

**AtliQ version**
- Left (≈60%): read-only contract text with clause numbers; clicking a finding scrolls to and highlights the
  clause (colour by severity). No editor/Save (amendments are out of scope).
- Right (≈40%) tabs: **Summary** · **Findings** · **Commitments** · **Checks** · **Decision**.
  - **Summary**: key terms table (parties, entity, value, term, payment days, LD, liability cap, governing law,
    jurisdiction) each with clause ref (FR-2); attention score; counts by severity.
  - **Findings**: filter by severity (Critical/High/Medium/Low) and category; cards show severity, category,
    title, 1-line why; finding type tag: Potential risk · Historical conflict · Document gap · Unresolved question.
  - **Commitments** (AtliQ differentiator, FR-5/FR-7): each conflict card shows **two quotes side by side** —
    "This contract §x" vs "Signed: Al Noor MSA §12.1 (Active until ~Sep 2029)" — with status chip
    Active / Expired / Waived, and wording "Potential conflict — not a breach determination".
  - **Checks** (replaces Met/Unmet): every configured check with **✓ Passed · ✗ Flagged · ? Could not verify**
    (third state is mandatory, PRD §9 / guardrail 6). E.g. "Signing entity matches region", "Governing law
    fits entity", "BAA present for US healthcare", "Subcontractor BAA for each party touching PHI", "DPA for EU
    personal data", "NDA obligations reciprocal".
  - **Decision**: see §6.
- Persistent banner: "Review assistant — not legal advice. Final decision rests with the authorised signer."

## 5. Finding detail (expanded card)  (LegalOn: 06 → AtliQ: FR-10, §9.2)

**LegalOn pattern**: Acceptable fallback language · Complete / Undo · Source language ("Consider revising
4. (INVOICES)…") · Escalations or Approvals ("Contact the Finance Department if…") · Revise.

**AtliQ expanded card**
- **Contract clause** (verbatim quote, clause ref) — visually distinct from AI text.
- **Why it matters to AtliQ** (AI explanation, labelled "AI analysis").
- **Evidence** — source file + clause + quote, with **"✓ Verified in source"** or **"⚠ Not verified"** badge (grounding check).
- **AtliQ precedent** (instead of fallback language): e.g. "Uncapped LD rejected: Acme (Mar 2025), Northwind
  (Jun 2025), Trustline (Aug 2026). Accepted once without review: Brightwater (Nov 2025) — led to $9k settlement."
- **Confidence** (High/Medium/Low) + "Not sure — please verify" when low.
- **Escalation hint** (rule-based, like LegalOn's): "Consider counsel review" for Critical conflicts or
  healthcare/PHI; "Check with Finance" for payment > 45 days; "Check with Pranav (CTO)" for IP/reuse or staffing.
- **Reviewer actions**: Confirm · Dismiss · Flag for verification — each with optional rationale; shows who/when;
  Undo. Dismissed findings stay in the audit trail. (LegalOn "Revise"/redline = deferred, PRD §13.2 — show
  at most a disabled "Suggest wording (later)".)

## 6. Decision panel  (no LegalOn equivalent → FR-11, FR-12)
- Progress: "12 of 15 findings reviewed · 2 checks could not be verified".
- Decision options recorded by a human: Proceed to sign · Negotiate · Escalate to counsel · Reject — with rationale.
- Blocked hint (not a block): "3 Critical findings unreviewed" shown before recording.
- **Export report** (print-friendly page / PDF) with findings, evidence, checks, unresolved questions, reviewer actions, version.
- The AI never pre-selects a decision.

## 7. Playbooks → AtliQ "Precedents" + "Rules"  (LegalOn: 07 → AtliQ: FR-4, FR-13)

**LegalOn pattern**: playbook groups (Construction, NDA Mutual, General Terms) each a list of plain-language
rules ("The contract must be governed by the laws of California"), Add playbook alert, per-rule Edit / Copy /
Move / Delete.

**AtliQ split (because there is no fixed policy)**
- **Rules** (deterministic facts only, read-only list in MVP, sourced from `data/derived/rules.json`):
  entity ↔ region, governing law ↔ entity, BAA for US healthcare + flow-down, DPA for EU personal data, NDA
  reciprocity, Today = 2026-09-28. Same plain-language row style as LegalOn. Editing UI deferred (PRD §13.2).
- **Precedents** (history, not rules): grouped by clause type (LD, liability, indemnity, payment, law, IP,
  non-compete, exclusivity, NDA mutuality); each row = counterparty · what they asked · what AtliQ agreed ·
  tag **Standard / Deliberate exception / Waved through** · source.
- **Commitments register** page: table of restrictions from signed contracts (type, counterparty, scope,
  geography, binds affiliates, until, status Active/Expired/Waived, source) with "Verified by human" toggle.

## 8. Visual language (ours, not LegalOn's)
- Clean, neutral, dense-but-calm like LegalOn; white surfaces, thin dividers, cards with subtle border.
- Severity colours: Critical red, High orange, Medium amber, Low slate; Passed green; Could-not-verify violet/grey.
- Highlight colour on document = severity tint of the selected finding.
- Desktop-first (web portal only per client), min width 1280px; must still not break at 1024px.
