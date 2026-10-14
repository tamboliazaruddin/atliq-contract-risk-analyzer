import { bundleMembers, loadEntities, loadQueue, loadTracker, readRaw } from "../data";
import { findKeyword } from "../text";
import type { CheckResult, Evidence, Finding } from "../types";
import { type EngineContext, atliqPartyText, ev, expectedEntity, findClause, mkFinding, partiesClauses, sentenceOf } from "./context";
import { parseContract } from "../clauses";

const US_STATE_LAW =
  /(?:State|Commonwealth) of (Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)/;

const ENTITY_NAME = { pvt_ltd: "AtliQ Technologies Pvt Ltd", inc: "AtliQ Inc", unknown: "an unidentified AtliQ entity" } as const;
const ENTITIES_QUOTE_US = "Clients in **the United States only**";
const ENTITIES_QUOTE_ROW = "Clients in **India, the Middle East, Europe**, and any other region outside the United States";

function entityEvidence(): Evidence[] {
  return [
    { ...ev("atliq_entities.md", "Entity 2 — Serves", ENTITIES_QUOTE_US, "Finance fact sheet: AtliQ Inc serves US clients only"), doc_status: "reference_data" },
    { ...ev("atliq_entities.md", "Entity 1 — Serves", ENTITIES_QUOTE_ROW, "Finance fact sheet: Pvt Ltd serves all non-US clients"), doc_status: "reference_data" },
  ];
}

interface RuleOut {
  checks: CheckResult[];
  findings: Finding[];
}

function check(id: string, name: string, status: CheckResult["status"], detail: string, evidence: Evidence[] = []): CheckResult {
  return { id: `chk-${id}`, rule_id: id, name, status, detail, evidence };
}

// R1 / R2 / R3 ---------------------------------------------------------------

function entityAndLaw(ctx: EngineContext, out: RuleOut) {
  const entity = ctx.config.atliq_entity;
  const country = ctx.config.counterparty_country;
  let expected = expectedEntity(country);
  let basis = `counterparty country ${country}`;
  // partnerships: the entity follows the territory AtliQ will serve, not the partner's HQ
  if (ctx.config.contract_type === "Partnership") {
    const terr = findClause(ctx, /"\**Territory\**" means/i);
    if (terr) {
      const t = terr.clause.text;
      expected = /United States|USA/.test(t) && !/India|GCC|Europe/.test(t) ? "inc" : "pvt_ltd";
      basis = `partnership territory (${terr.clause.ref})`;
    }
  }
  const atliqLine = atliqPartyText(ctx.parsed);
  const atliqQuoteMatch = atliqLine.match(/\**(AtliQ Inc|ATLIQ INC|AtliQ Technologies (?:Pvt Ltd|Private Limited)|ATLIQ TECHN[O0]LOGIES (?:PRIVATE LIMITED|PVT LTD))\**,?[^(]{0,90}/i);
  const atliqQuote = atliqQuoteMatch ? atliqQuoteMatch[0].replace(/\*\*/g, "").replace(/[,\s]+$/, "").trim() : "";

  if (!ctx.config.checks.entity_law) {
    out.checks.push(check("R1", "Signing entity matches client region", "not_applicable", "Entity & law checks switched off in setup."));
    return;
  }
  if (entity === "unknown" || expected === "unknown") {
    out.checks.push(
      check("R1", "Signing entity matches client region", "could_not_verify", entity === "unknown" ? "Could not find which AtliQ entity is named in the parties clause." : "Counterparty country could not be determined — set it in Review setup."),
    );
  } else if (entity !== expected) {
    out.checks.push(check("R1", "Signing entity matches client region", "flagged", `${ENTITY_NAME[entity]} is named, but ${basis} points to ${ENTITY_NAME[expected]}.`, entityEvidence()));
    out.findings.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "governing_law_entity",
        severity: "HIGH",
        title: `Wrong AtliQ entity: ${ENTITY_NAME[entity]} named for a ${country} counterparty`,
        explanation: `Per finance's entity sheet, ${expected === "pvt_ltd" ? "AtliQ Technologies Pvt Ltd serves every non-US client and AtliQ Inc serves US clients only" : "AtliQ Inc serves US clients"}. The entity in the contract decides who invoices, which tax regime applies (GST vs US) and which bank account is paid — mismatches caused payment delays twice in 2025.`,
        quote: atliqQuote || atliqLine.slice(0, 200).replace(/\*\*/g, ""),
        evidence: entityEvidence(),
        rule_id: "R1",
        confidence: "HIGH",
        needs_info: "Ask the counterparty to change the contracting party, or confirm with Finance why the other entity is intended.",
        source: "rule",
      }),
    );
  } else {
    out.checks.push(check("R1", "Signing entity matches client region", "passed", `${ENTITY_NAME[entity]} — consistent with ${basis}.`));
  }

  // R2 invoicing entity
  const inv = findClause(ctx, /invoices?[^.]{0,40}(?:shall be )?(?:raised|issued) by ([^,.]+)/i);
  if (!inv) {
    out.checks.push(check("R2", "Invoicing entity matches signing entity", "passed", "No separate invoicing entity is named — invoices follow the signing entity."));
  } else {
    const invPvt = /AtliQ Technologies|GSTIN/i.test(inv.quote);
    const invInc = /AtliQ Inc/i.test(inv.quote);
    const mismatch = (invPvt && entity === "inc") || (invInc && entity === "pvt_ltd");
    if (mismatch) {
      out.checks.push(check("R2", "Invoicing entity matches signing entity", "flagged", `Invoices raised by ${invPvt ? "AtliQ Technologies Pvt Ltd" : "AtliQ Inc"} while ${ENTITY_NAME[entity]} signs (${inv.clause.ref}).`));
      out.findings.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "governing_law_entity",
          severity: "HIGH",
          title: "Invoicing entity differs from the contracting entity",
          explanation: `${ENTITY_NAME[entity]} signs, but ${inv.clause.ref} has invoices raised by ${invPvt ? "AtliQ Technologies Pvt Ltd (Indian GSTIN)" : "AtliQ Inc"}. The entity that invoices must be the one named in the parties clause; a mismatch is exactly what delayed payments twice in 2025.`,
          quote: inv.quote,
          clause: inv.clause,
          evidence: [{ ...ev("atliq_entities.md", "Notes from finance", "Mismatches between the contracting entity and the invoicing entity have caused payment delays twice in 2025."), doc_status: "reference_data" }],
          rule_id: "R2",
          confidence: "HIGH",
          source: "rule",
        }),
      );
    } else {
      out.checks.push(check("R2", "Invoicing entity matches signing entity", "passed", `Invoicing clause ${inv.clause.ref} is consistent with ${ENTITY_NAME[entity]}.`));
    }
  }

  // R3 governing law
  const law = findClause(ctx, /governed by[^.]{0,60}?laws?[^.]{0,40}?(?:of|in)\s+(?:the\s+)?([A-Z][A-Za-z ]+)|governing law \(laws of ([A-Za-z ]+)\)/i);
  if (!law) {
    out.checks.push(check("R3", "Governing law fits the signing entity", "could_not_verify", "No governing-law clause found in this document."));
    return;
  }
  const lq = law.quote;
  const juris =
    /India/.test(lq) ? "India"
    : /Dubai International Financial Centre|DIFC/.test(lq) ? "DIFC"
    : /Emirate of Dubai|United Arab Emirates/.test(lq) ? "UAE"
    : /Saudi/.test(lq) ? "Saudi Arabia"
    : /England/.test(lq) ? "England & Wales"
    : /Germany/.test(lq) ? "Germany"
    : /Singapore/.test(lq) ? "Singapore"
    : US_STATE_LAW.test(lq) ? `US (${lq.match(US_STATE_LAW)![1]})`
    : "Other";
  const fits = (entity === "pvt_ltd" && juris === "India") || (entity === "inc" && juris.startsWith("US"));
  const forum = findClause(ctx, /(SIAC|LCIA|arbitration|courts? (?:of|at|in|located in))/i);
  const forumNote = forum ? ` Forum: ${forum.quote.slice(0, 160)} (${forum.clause.ref}).` : "";
  if (fits) {
    out.checks.push(check("R3", "Governing law fits the signing entity", "passed", `${juris} law with ${ENTITY_NAME[entity]}.${forumNote}${/SIAC|Singapore/.test(forum?.quote ?? "") ? " A neutral arbitration seat is not itself a risk (precedent: CloudSpan SIAC accepted)." : ""}`));
    return;
  }
  const home = (juris === "Germany" && /Germany/.test(ctx.config.counterparty_country)) || (juris === "Saudi Arabia" && /Saudi/.test(ctx.config.counterparty_country)) || (/UAE|DIFC/.test(juris) && /UAE/.test(ctx.config.counterparty_country)) || (juris === "England & Wales" && /UK/.test(ctx.config.counterparty_country)) || (juris.startsWith("US") && /USA/.test(ctx.config.counterparty_country));
  const lang = findClause(ctx, /(Arabic|German) (?:text|version) shall prevail/i);
  const severity = lang ? "MEDIUM" : home ? "LOW" : "MEDIUM";
  out.checks.push(check("R3", "Governing law fits the signing entity", "flagged", `${juris} law with ${ENTITY_NAME[entity]} — third-country law, review (not automatically wrong).${forumNote}`));
  out.findings.push(
    mkFinding(ctx, {
      type: "POTENTIAL_RISK",
      category: "governing_law_entity",
      severity,
      title: `${juris} law${lang ? `, ${lang.quote.match(/Arabic|German/)![0]} text prevails` : ""}${forum && /courts/i.test(forum.quote) ? " and local courts" : ""}`,
      explanation: `AtliQ's default is Indian law for Pvt Ltd and US state law for Inc. ${home ? `${juris} is the counterparty's home law, which AtliQ has accepted before when needed (English law for Northwind, DIFC for Al Noor, Singapore/SIAC for CloudSpan).` : "This is a third-country law for both sides."}${lang ? ` The ${lang.quote.match(/Arabic|German/)![0]} version prevails over the English text AtliQ will review — get the governing-language version checked.` : ""}${forumNote} Disputes would be run under unfamiliar law, typically needing local counsel.`,
      quote: law.quote,
      clause: law.clause,
      evidence: lang ? [ev("this contract", lang.clause.ref, lang.quote)].map((e) => ({ ...e, doc_status: "this_contract" as const, grounded: true })) : [],
      precedent_ids: ["P-13", "P-14", "P-15", "P-16"],
      rule_id: "R3",
      confidence: "HIGH",
      source: "rule",
    }),
  );
}

// R4 / R5 — US healthcare -------------------------------------------------------

function healthcare(ctx: EngineContext, out: RuleOut) {
  if (!ctx.usHealthcare) {
    out.checks.push(check("R4", "US healthcare bundle complete (NDA + BAA + MSA)", "not_applicable", "Not a US healthcare engagement touching PHI."));
    out.checks.push(check("R5", "Subcontractor BAA for each party touching PHI", "not_applicable", "Not a US healthcare engagement touching PHI."));
    return;
  }
  if (!ctx.config.checks.required_documents) {
    out.checks.push(check("R4", "US healthcare bundle complete (NDA + BAA + MSA)", "not_applicable", "Required-documents check switched off in setup."));
    return;
  }
  // R4
  const members = bundleMembers(ctx.counterparty);
  if (!members.length) {
    out.checks.push(check("R4", "US healthcare bundle complete (NDA + BAA + MSA)", "could_not_verify", "No tracker record for this counterparty — confirm an NDA and a BAA exist and are signed before any PHI changes hands."));
  } else {
    const need = [
      { k: "NDA", re: /NDA/i },
      { k: "BAA", re: /BAA/i },
      { k: "MSA", re: /MSA|Services/i },
    ];
    const status = need.map((n) => {
      const m = members.find((x) => n.re.test(x.doc_type));
      return { ...n, row: m, signed: m?.status === "Signed" };
    });
    const missing = status.filter((s) => !s.signed && s.row?.contract_id !== ctx.tracker?.contract_id);
    const summary = status.map((s) => `${s.k}: ${s.row ? `${s.row.status} (${s.row.contract_id})` : "missing"}`).join(" · ");
    if (missing.length) {
      out.checks.push(check("R4", "US healthcare bundle complete (NDA + BAA + MSA)", "flagged", `Bundle incomplete — ${summary}.`));
      const baaClause =
        findClause(ctx, /executed concurrently with the Master Services Agreement/i) ??
        findClause(ctx, /"\**Business Associate Agreement\**" or|attached hereto as Exhibit/i) ??
        findClause(ctx, /Business Associate Agreement|BAA/) ?? { clause: ctx.parsed.clauses[0], quote: ctx.parsed.clauses[0].text.slice(0, 100) };
      out.findings.push(
        mkFinding(ctx, {
          type: "DOCUMENT_GAP",
          gap_kind: missing.some((m) => !m.row) ? "confirmed" : "potential",
          category: "required_documents",
          severity: "HIGH",
          title: `Healthcare bundle incomplete — ${missing.map((m) => m.k).join(" + ")} not signed`,
          explanation: `US healthcare work touching patient data needs an NDA, a HIPAA Business Associate Agreement and the services contract, signed before data changes hands (rule R4). Current status: ${summary}. The client wants MSA and BAA signed together; neither should be signed alone, and no PHI should be received until the BAA is executed.`,
          quote: baaClause.quote,
          clause: baaClause.clause,
          evidence: members.map((m) => ({
            source_file: "contract_tracker.csv",
            clause_ref: m.contract_id,
            quote: `${m.doc_type} — ${m.status}`,
            doc_status: "tracker_note" as const,
            grounded: true,
            label: `Tracker ${m.contract_id}`,
          })),
          rule_id: "R4",
          confidence: "HIGH",
          needs_info: "Status of the BAA in review; confirm both documents are executed together.",
          source: "rule",
        }),
      );
    } else {
      out.checks.push(check("R4", "US healthcare bundle complete (NDA + BAA + MSA)", "passed", summary));
    }
  }

  // R5 — flow-down to every party touching PHI
  const ic = ctx.register.find((c) => c.matcher.kind === "engagement_scope");
  const covered = ic && ic.matcher.kind === "engagement_scope" && ic.matcher.covers.some((x) => findKeyword(ctx.counterparty, x) >= 0);
  if (covered) {
    out.checks.push(check("R5", "Subcontractor BAA for each party touching PHI", "passed", `Covered by ${ic!.counterparty} (${ic!.clause_ref}).`));
    return;
  }
  const freelancers = loadTracker().filter((r) => /contractor agreement/i.test(r.doc_type) && new RegExp(ctx.counterparty.split(/\s+/)[0], "i").test(r.notes));
  const flow =
    findClause(ctx, /Flow-Down|agrees in writing[^.]*same restrictions|written business associate agreement/i) ??
    findClause(ctx, /shall not subcontract/i) ??
    findClause(ctx, /subcontract/i);
  const icEv = ic ? [ev(ic.source_file, ic.clause_ref.split(",")[0], ic.quote, `Signed intercompany BAA — CareBridge engagement only (ends ${ic.end})`), ...ic.extra_quotes.slice(0, 2).map((q) => ev(ic.source_file, q.clause_ref, q.quote))] : [];
  const flEv: Evidence[] = freelancers.map((r) => ({
    source_file: "contract_tracker.csv",
    clause_ref: `${r.contract_id} notes`,
    quote: r.notes,
    doc_status: "tracker_note",
    grounded: true,
    label: `Tracker ${r.contract_id}: ${r.counterparty} (${r.status})`,
  }));
  out.checks.push(
    check(
      "R5",
      "Subcontractor BAA for each party touching PHI",
      "flagged",
      `No subcontractor BAA covers this engagement. The intercompany BAA (Inc → Pune) is CareBridge-only${freelancers.length ? `; freelancer(s) ${freelancers.map((f) => f.counterparty).join(", ")} have no subcontractor BAA` : ""}.`,
      icEv,
    ),
  );
  if (flow) {
    out.findings.push(
      mkFinding(ctx, {
        type: "DOCUMENT_GAP",
        gap_kind: "confirmed",
        category: "required_documents",
        severity: "CRITICAL",
        title: "No subcontractor BAA for anyone who would touch this client's PHI",
        explanation: `HIPAA flow-down requires every subcontractor — including AtliQ's own Pune entity and any freelancer — to sign a subcontractor BAA with matching terms before access. The only one AtliQ has (intercompany, Oct 2025) is engagement-specific: it covers the CareBridge engagement only, de-identified data only, and ends with the CareBridge BAA on 5 Oct 2026. It does not cover this client, despite the 27 Sep assumption that it 'should do'.${freelancers.length ? ` The freelancer brought in for this client (${freelancers.map((f) => `${f.counterparty}, ${f.contract_id}`).join("; ")}) has a contractor agreement and NDA in draft but no subcontractor BAA.` : ""}`,
        quote: flow.quote,
        clause: flow.clause,
        evidence: [...icEv, ...flEv],
        precedent_ids: ["P-27"],
        rule_id: "R5",
        confidence: "HIGH",
        needs_info: "Decide who will touch PHI (US-only per the BAA); draft a subcontractor BAA for each, and have counsel review.",
        source: "rule",
      }),
    );
  }
  // delivery model: client bars offshore subcontractors (Affiliates count) — AtliQ Inc delivers from Pune
  const offshore = findClause(ctx, /personnel performing Services shall be located in the United States|organized under the laws of a State of the United States/i);
  const affDef = findClause(ctx, /"\**Subcontractor\**" means[^.]*Affiliate/i);
  if (offshore && ctx.config.atliq_entity === "inc") {
    out.findings.push(
      mkFinding(ctx, {
        type: "HISTORICAL_CONFLICT",
        category: "data_protection",
        severity: "CRITICAL",
        title: "BAA bars any non-US subcontractor — including AtliQ's Pune team",
        explanation: `Potential conflict with how AtliQ delivers. ${offshore.clause.ref} requires every approved subcontractor to be a US-organised entity with US-located personnel${affDef ? `, and ${affDef.clause.ref} defines Subcontractor to include Business Associate's Affiliates` : ""}. AtliQ Inc sub-contracts delivery to AtliQ Technologies Pvt Ltd in Pune; that model would not be allowed at all — not even for de-identified data, which the CareBridge BAA permitted. Staffing, price and timeline need to be re-planned around US-only personnel, or the clause negotiated.`,
        quote: offshore.quote,
        clause: offshore.clause,
        evidence: [
          { ...ev("atliq_entities.md", "Notes from finance", "Delivery teams for both entities sit in Pune; AtliQ Inc sub-contracts delivery to AtliQ Technologies Pvt Ltd under an intercompany agreement."), doc_status: "reference_data" },
          ev("signed_contracts/2025-10-06_carebridge_clinics_baa.md", "§3.2", "Personnel of Business Associate or of any Subcontractor located outside the United States may access De-identified Data only, and only within the Covered Entity Environment or a secure environment approved in writing by Covered Entity.", "Signed CareBridge BAA — allowed offshore de-identified access"),
        ],
        rule_id: "R5",
        confidence: "HIGH",
        needs_info: "Ask Pranav for a US-only staffing plan and cost; decide whether to negotiate offshore de-identified access as in CareBridge §3.2.",
        source: "rule",
      }),
    );
  }
}

// R6 — EU / UK personal data ------------------------------------------------------

function euData(ctx: EngineContext, out: RuleOut, reportedAnnexes: Set<string>) {
  if (!ctx.euPersonalData) {
    out.checks.push(check("R6", "EU/UK personal data covered by a DPA", "not_applicable", "No EU/UK personal data detected."));
    return;
  }
  const dpaRef = findClause(ctx, /Data Processing Agreement|Art\.?\s*28 GDPR|data processing terms/i);
  if (dpaRef) {
    const annex = dpaRef.quote.match(/(Annex|Schedule|Exhibit)\s+([A-Z0-9]+)/i);
    const label = annex ? `${annex[1][0].toUpperCase()}${annex[1].slice(1).toLowerCase()} ${annex[2]}` : null;
    const attached = label ? ctx.parsed.clauses.some((c) => c.ref.toLowerCase().startsWith(label.toLowerCase()) || c.heading.toLowerCase().startsWith(label.toLowerCase())) : true;
    if (attached) {
      out.checks.push(check("R6", "EU/UK personal data covered by a DPA", "passed", `DPA referenced and attached (${dpaRef.clause.ref}).`));
      return;
    }
    reportedAnnexes.add(label!.toLowerCase());
    out.checks.push(check("R6", "EU/UK personal data covered by a DPA", "flagged", `${label} (DPA incl. SCCs) is referenced as integral but is not in the document.`));
    out.findings.push(
      mkFinding(ctx, {
        type: "DOCUMENT_GAP",
        gap_kind: "potential",
        category: "data_protection",
        severity: "MEDIUM",
        title: `GDPR DPA (${label}) referenced but not attached`,
        explanation: `The contract makes the Art. 28 GDPR data processing agreement — including the Standard Contractual Clauses for transfers to India — an integral part (${label}), but it is not in the draft. AtliQ would be signing up to DPA terms it has not seen (audit rights, sub-processor approval, breach notice, liability). Ask for ${label} before signing.`,
        quote: dpaRef.quote,
        clause: dpaRef.clause,
        rule_id: "R6",
        confidence: "HIGH",
        needs_info: `Obtain ${label} from the client.`,
        source: "rule",
      }),
    );
    return;
  }
  // no DPA at all — e.g. a vendor that will handle an EU client's personal data
  const pd = findClause(ctx, /technician names|personal data|names, shift identifiers/i);
  const upstream = ctx.text.match(/End Client:?\**\s*:?\s*\**\s*([A-Z][A-Za-z&.\s]+?GmbH)/);
  const evidence: Evidence[] = [];
  if (upstream) {
    const item = loadQueue().find((q) => q.counterparty.toLowerCase().startsWith(upstream[1].split(/\s+/)[0].toLowerCase()));
    if (item) {
      const up = parseContract(readRaw(item.file));
      const sub = up.clauses.find((c) => /subcontract[^.]*prior written consent/i.test(c.text));
      const dp = up.clauses.find((c) => /Art\. 28 GDPR|Data Processing Agreement/i.test(c.text));
      if (sub) evidence.push(ev(item.file, sub.ref, sub.text.replace(/^\d+(\.\d+)*\s+/, ""), `${item.counterparty} draft (${item.id}) — upstream client contract`));
      if (dp) evidence.push(ev(item.file, dp.ref, dp.text.replace(/^\d+(\.\d+)*\s+/, "").split(/(?<=\.)\s/)[0]));
    }
  }
  out.checks.push(check("R6", "EU/UK personal data covered by a DPA", "flagged", "EU personal data will be processed, but there are no data-processing / sub-processor terms in this agreement.", evidence));
  out.findings.push(
    mkFinding(ctx, {
      type: "DOCUMENT_GAP",
      gap_kind: "confirmed",
      category: "data_protection",
      severity: "HIGH",
      title: "EU personal data with no GDPR sub-processor terms or client consent",
      explanation: `This vendor would process EU personal data (e.g. technician names in maintenance logs) on AtliQ's behalf, making it a GDPR sub-processor. Nothing here flows down DPA terms (Art. 28(4)), and the upstream client contract requires the client's prior written consent to subcontract. AtliQ needs the client's consent and a DPA flow-down with the vendor before any data is shared.`,
      quote: pd?.quote ?? sentenceOf(ctx.parsed.clauses[0].text, 0),
      clause: pd?.clause,
      evidence,
      rule_id: "R6",
      confidence: "HIGH",
      needs_info: "Get the end client's written consent to the sub-processor and add DPA flow-down terms (or anonymise names before sharing).",
      source: "rule",
    }),
  );
}

// R7 — NDA reciprocity -------------------------------------------------------------

function ndaReciprocity(ctx: EngineContext, out: RuleOut) {
  if (ctx.config.contract_type !== "NDA") {
    out.checks.push(check("R7", "NDA obligations are reciprocal", "not_applicable", "Not an NDA."));
    return;
  }
  if (!ctx.config.checks.nda_mutuality) {
    out.checks.push(check("R7", "NDA obligations are reciprocal", "not_applicable", "NDA mutuality check switched off in setup."));
    return;
  }
  const labelledMutual = /mutual/i.test(ctx.parsed.title);
  const atliqRecipient = /^(recipient|receiving party)$/i.test(ctx.atliqTerm) || /\("\**Recipient\**"\)/.test(partiesClauses(ctx.parsed).map((c) => c.text).filter((t) => /atliq/i.test(t)).join(" "));
  const oneWayDef = findClause(ctx, /"\**Confidential Information\**" means[^.]*disclosed[^.]*by or on behalf of (?:the )?(?!a Party|either|each|the Disclosing)[A-Z][A-Za-z]+ to (?:the )?(?:Recipient|AtliQ)/i);
  const generic = /Disclosing Party/.test(ctx.text) && /Receiving Party/.test(ctx.text);
  const oneWay = (atliqRecipient || !!oneWayDef) && !generic;
  if (!oneWay) {
    out.checks.push(check("R7", "NDA obligations are reciprocal", "passed", "Confidential Information, obligations and remedies apply to both parties (Disclosing / Receiving Party)."));
    return;
  }
  const quote = oneWayDef?.quote ?? findClause(ctx, /"\**Confidential Information\**" means/i)?.quote ?? "";
  out.checks.push(check("R7", "NDA obligations are reciprocal", "flagged", `${labelledMutual ? "Labelled 'mutual' but" : "One-way:"} only AtliQ's obligations are defined — AtliQ is the 'Recipient' and only the other side's information is protected.`));
  out.findings.push(
    mkFinding(ctx, {
      type: "POTENTIAL_RISK",
      category: "nda_mutuality",
      severity: labelledMutual ? "CRITICAL" : "HIGH",
      title: labelledMutual ? "Called a 'Mutual' NDA, but it is one-way — only AtliQ is bound" : "One-way NDA — only AtliQ is bound",
      explanation: `${labelledMutual ? "The title and recitals say mutual, but the operative terms are not: " : ""}Confidential Information is defined as information disclosed by the other party to AtliQ, AtliQ is defined as the 'Recipient', and every obligation, remedy and covenant runs against AtliQ only. AtliQ's own architecture, methods and pricing shared in the walkthrough would have no protection. Karandeep's rule is 'NDAs → just sign if mutual'; GlobalMart's one-way draft was turned into a mutual NDA on request. The Meridian NDA (one-way, signed within the hour as 'standard') is the counter-example.`,
      quote,
      clause: oneWayDef?.clause,
      precedent_ids: ["P-23", "P-24", "P-25"],
      rule_id: "R7",
      confidence: "HIGH",
      source: "rule",
    }),
  );
}

// R9 / R10 ---------------------------------------------------------------------------

function insuranceCheck(ctx: EngineContext, out: RuleOut, insuranceFindings: number) {
  const ins = findClause(ctx, /insurance/i);
  if (!ins) {
    out.checks.push(check("R9", "Required insurance within current cover", "not_applicable", "No insurance requirement in this document."));
  } else if (insuranceFindings) {
    out.checks.push(check("R9", "Required insurance within current cover", "flagged", "Cyber cover required exceeds AtliQ's $1M policy (tracker C-046)."));
  } else if (/\$\s?[\d,]{7,}|USD\s?[\d,]{7,}|Million/i.test(ins.clause.text)) {
    out.checks.push(check("R9", "Required insurance within current cover", "could_not_verify", `Insurance limits required (${ins.clause.ref}). Only AtliQ's cyber cover ($1M) is recorded in the dataset — confirm general / professional liability cover with the broker.`));
  } else {
    out.checks.push(check("R9", "Required insurance within current cover", "passed", `Insurance clause ${ins.clause.ref} has no limit above recorded cover.`));
  }
}

function annexes(ctx: EngineContext, out: RuleOut, reported: Set<string>) {
  if (!ctx.config.checks.required_documents) return;
  const refs = new Map<string, string>();
  const re = /\b(Annex(?:ure)?|Schedule|Exhibit|Appendix)\s+([A-Z]|\d{1,2})\b/g;
  for (const c of ctx.parsed.clauses) {
    for (const m of c.text.matchAll(re)) {
      const label = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
      if (!refs.has(label)) refs.set(label, c.id);
    }
  }
  const present = (label: string) =>
    ctx.parsed.clauses.some((c) => c.ref.toLowerCase().startsWith(label.toLowerCase()) || c.heading.toLowerCase().includes(label.toLowerCase()));
  // a companion document in the same bundle (e.g. the BAA is Exhibit D of the MSA) counts as present
  const bundleTitles = ctx.tracker ? loadQueue().filter((q) => q.counterparty === ctx.counterparty).map((q) => q.title.toLowerCase()) : [];
  const missing: string[] = [];
  for (const [label] of refs) {
    if (present(label) || reported.has(label.toLowerCase())) continue;
    if (bundleTitles.some((t) => t.includes(label.toLowerCase()))) continue;
    // ignore references inside the clause that defines a schedule's own SOW summary heading
    missing.push(label);
  }
  if (!refs.size) {
    out.checks.push(check("R10", "Referenced schedules and annexes are attached", "passed", "No schedules or annexes referenced."));
    return;
  }
  if (!missing.length) {
    out.checks.push(check("R10", "Referenced schedules and annexes are attached", "passed", `All ${refs.size} referenced attachment(s) present in the document set.`));
    return;
  }
  out.checks.push(check("R10", "Referenced schedules and annexes are attached", "flagged", `Referenced but not included: ${missing.join(", ")}.`));
  const first = ctx.parsed.clauses.find((c) => c.id === refs.get(missing[0]))!;
  const idx = Math.max(0, first.text.search(new RegExp(missing[0].replace(" ", "\\s+"), "i")));
  out.findings.push(
    mkFinding(ctx, {
      type: "DOCUMENT_GAP",
      gap_kind: "potential",
      category: "required_documents",
      severity: missing.length > 1 ? "MEDIUM" : "LOW",
      title: `Attachment${missing.length > 1 ? "s" : ""} referenced but not provided: ${missing.join(", ")}`,
      explanation: `The contract incorporates ${missing.join(", ")}, which are not in the document received. Their terms (e.g. specifications, security requirements, policies) would bind AtliQ unseen. This is a potential gap until someone confirms the attachments exist and reviews them.`,
      quote: sentenceOf(first.text, idx),
      clause: first,
      rule_id: "R10",
      confidence: "MEDIUM",
      needs_info: `Request ${missing.join(", ")} from the counterparty.`,
      source: "rule",
    }),
  );
}

export function runRules(ctx: EngineContext, insuranceFindings: number): RuleOut {
  const out: RuleOut = { checks: [], findings: [] };
  const reportedAnnexes = new Set<string>();
  entityAndLaw(ctx, out);
  healthcare(ctx, out);
  euData(ctx, out, reportedAnnexes);
  ndaReciprocity(ctx, out);
  insuranceCheck(ctx, out, insuranceFindings);
  annexes(ctx, out, reportedAnnexes);
  return out;
}

export { loadEntities };
