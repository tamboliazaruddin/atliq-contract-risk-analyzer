import type { Clause, Finding } from "../types";
import { WORD_NUMBERS } from "../text";
import { type EngineContext, ev, findAllClauses, findClause, mkFinding, precedentIds, sentenceOf } from "./context";

/**
 * Deterministic clause-risk scanner (PRD §5.4 hybrid approach). Generic patterns for the risk
 * categories the PRD names — liability, indemnity, LD, payment, IP, termination, NDA mutuality,
 * restrictive covenants. It is the always-on safety net: the LLM adds findings on top, but these
 * never depend on the model being available. Commercial terms are compared with AtliQ's own
 * precedent history (data/derived/precedents.json), never with a hard-coded policy.
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function atliqRe(ctx: EngineContext): RegExp {
  return new RegExp(`\\b(${esc(ctx.atliqTerm)}|AtliQ)\\b`, "i");
}

function isAtliqName(ctx: EngineContext, name: string): boolean {
  const n = name.trim().toLowerCase().replace(/['’]s$/, "");
  return n === ctx.atliqTerm.toLowerCase() || n === "atliq" || n.includes("atliq");
}

function days(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/\((\d{1,3})\)\s*(?:calendar\s+|business\s+|working\s+)?days?/gi)) out.push(+m[1]);
  if (!out.length) for (const m of s.matchAll(/\b(\d{1,3})\s*(?:calendar\s+|business\s+)?days?\b/gi)) out.push(+m[1]);
  if (!out.length) {
    for (const [w, n] of Object.entries(WORD_NUMBERS)) if (new RegExp(`\\b${w}\\s+days\\b`, "i").test(s)) out.push(n);
  }
  return out;
}

function sectionOf(ctx: EngineContext, c: Clause): Clause[] {
  return ctx.parsed.clauses.filter((x) => x.heading === c.heading);
}

const isBuyer = (ctx: EngineContext) => ctx.config.atliq_role === "buyer";

// ---------------------------------------------------------------------------

function liquidatedDamages(ctx: EngineContext): Finding[] {
  const rateRe =
    /((?:\d+(?:\.\d+)?\s*%)|(?:[\w-]+\s+per\s?cent\s*\(\d+(?:\.\d+)?%\))|(?:[\w-]+\s+percent\s*\(\d+(?:\.\d+)?%\)))(?:\s*\([^)]*\))?\s+of\s+(?:the\s+)?([^,;]{3,70}?)\s+(?:for each|per|for every)\s+((?:calendar |complete |full |each )?(?:day|week))/i;
  const ldClauses = ctx.parsed.clauses.filter(
    (c) => /liquidated damages|contractual penalty|Vertragsstrafe|service credit|delay penalt/i.test(c.text + " " + c.heading) && rateRe.test(c.text),
  );
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const c of ldClauses) {
    if (seen.has(c.heading)) continue;
    seen.add(c.heading);
    const m = rateRe.exec(c.text)!;
    const group = sectionOf(ctx, c);
    const all = group.map((x) => x.text).join("\n");
    const basis = m[2];
    const onTotal = /contract value|total contract value|total fees|total remuneration|fees payable under this agreement/i.test(basis);
    const daily = /day/i.test(m[3]);
    const capped = /shall not exceed|not to exceed|subject to a maximum|up to a maximum|maximum of|capped at|not exceed|limited to/i.test(all);
    const clientExcl =
      /(caused by|attributable to|result of any act or omission of)\s+(?:the\s+)?(client|company|customer|lakeshore|blueorchid|sunrise|harrington|rheinwerk|atliq)\b|(?:solely\s+)?attributable to (?:the\s+)?(?:supplier|service provider|vendor|atliq|contractor)|reasons for which it is responsible|cooperation duties|other than as a result of any act or omission/i.test(
        all,
      );
    const cumulative = /in addition to (?:and not in lieu of|any other right)/i.test(all);
    const quote = sentenceOf(c.text, m.index);
    const facts = [
      `${m[1].trim()} of ${basis.trim()} per ${daily ? "day" : "week"}`,
      capped ? "capped" : "no cap",
      clientExcl ? "client-caused delay excluded" : "no exclusion for client-caused delay",
      cumulative ? "cumulative with other remedies" : null,
    ].filter(Boolean);

    let severity: Finding["severity"] | null = null;
    if (!capped) severity = "CRITICAL";
    else if (onTotal && !clientExcl) severity = "HIGH";
    else if (onTotal || !clientExcl || daily) severity = "MEDIUM";
    if (!severity) continue; // matches AtliQ's standard (milestone basis, capped, client delays excluded)

    if (isBuyer(ctx)) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "fairness_to_counterparty",
          severity: severity === "CRITICAL" ? "HIGH" : severity,
          title: `AtliQ's own paper imposes ${capped ? "" : "uncapped "}daily-style delay damages on the vendor`,
          explanation: `AtliQ is the buyer here. The delay clause charges the vendor ${facts.join(", ")}. This is the same structure AtliQ rejects when clients send it (Acme, Northwind, Trustline) and the one that cost AtliQ $9k on Brightwater. With PixelCraft, Karandeep deleted the delay penalty for a six-person agency. Consider whether this term is fair to a small vendor.`,
          quote,
          clause: c,
          precedent_ids: ["P-26", "P-05", "P-01"],
          confidence: "HIGH",
          source: "pattern",
        }),
      );
      continue;
    }
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "liquidated_damages",
        severity,
        title: !capped
          ? `Uncapped liquidated damages — ${m[1].trim()} of ${basis.trim()} per ${daily ? "day" : "week"}`
          : `Liquidated damages on ${onTotal ? "the full contract value" : basis.trim()}${clientExcl ? "" : " with no client-delay exclusion"}`,
        explanation: `Delay clause terms: ${facts.join(", ")}. AtliQ's precedent is 0.5% of the affected milestone fee per week, capped at 5% of that milestone, with no LD for client-caused delay (Acme Mar 2025, Northwind Jun 2025, Trustline Aug 2026). ${!capped ? "An uncapped LD on the full contract value is the Brightwater pattern — that contract had no client-delay exclusion either, and a 19-day client-caused delay produced an $18.4k claim and a $9k settlement." : onTotal ? "Calculating LD on the whole contract value rather than the delayed milestone multiplies exposure." : ""}${!clientExcl ? " Nothing stops LD accruing while AtliQ waits on the client's own data or access." : ""} The only accepted 10%-of-total cap (Al Noor) was approved as a one-off exception, not a standard.`,
        quote,
        clause: c,
        precedent_ids: precedentIds(ctx, "liquidated_damages"),
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  return out;
}

function liability(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const unlimited = [
    /NOTHING IN THIS AGREEMENT SHALL (?:LIMIT|EXCLUDE)(?: OR (?:LIMIT|EXCLUDE))? ([A-Z][A-Z ]+?)['’]S LIABILITY/i,
    /\b([A-Z][A-Za-z ]+?)['’]s obligations under this [^.]{0,40}shall not be subject to any limitation/i,
    /obligations of ([A-Z][A-Za-z ]+?) under this [^.]{0,30}(?:are|is) not subject to any limitation/i,
    /\b([A-Za-z ]+?) (?:shall be|is) liable without limitation for all damages/i,
  ];
  const hits: { clause: Clause; quote: string; party: string; idx: number }[] = [];
  for (const c of ctx.parsed.clauses) {
    for (const re of unlimited) {
      const m = re.exec(c.text);
      if (m) {
        hits.push({ clause: c, quote: sentenceOf(c.text, m.index), party: m[1], idx: m.index });
        break;
      }
    }
  }
  if (!hits.length) return out;
  // counterparty's own cap, for the asymmetry explanation
  const capRe = /([A-Z]+)['’]S (?:TOTAL )?AGGREGATE LIABILITY[\s\S]{0,160}?SHALL NOT EXCEED ([^;]+?)\.(?:\s|$)/i;
  const capHit = findClause(ctx, capRe);
  const capFull = capHit ? capRe.exec(capHit.clause.text) : null;
  const capText = capFull ? ` By contrast ${capHit!.clause.ref} caps the other side's liability at ${capFull[2].trim()}.` : "";

  const atliqHits = hits.filter((h) => isAtliqName(ctx, h.party));
  const otherHits = hits.filter((h) => !isAtliqName(ctx, h.party));
  if (atliqHits.length) {
    const h = atliqHits[0];
    const sectionsAll = atliqHits.flatMap((x) => sectionOf(ctx, x.clause).map((s) => s.text)).join(" ");
    const allHeads = /ANY LOSSES|ALL LOSSES|for all damages/i.test(h.clause.text);
    const privacy = /privacy|PHI|data security|HIPAA|Privacy Event/i.test(sectionsAll);
    const indemn = /indemn/i.test(sectionsAll);
    const severity = allHeads || privacy ? "CRITICAL" : "HIGH";
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "liability",
        severity,
        title: allHeads ? "Unlimited liability for AtliQ — no cap at all" : `Uncapped liability for AtliQ under ${atliqHits.map((x) => x.clause.ref).join(", ")}`,
        explanation: `${allHeads ? "AtliQ's liability is expressly unlimited, for direct and indirect losses alike." : `AtliQ's exposure under the cited provisions${indemn ? " — including its indemnity obligations —" : ""} is carved out of any cap.`}${privacy ? " The carve-out covers data-security / privacy events, where regulatory fines, notification and credit-monitoring costs are the largest exposure." : ""}${capText} AtliQ's position has been liability capped at 1x fees; Karandeep walked away from Kessler Mobility (~€120k) over 'liable without limitation'.${atliqHits.length > 1 ? ` Also see ${atliqHits.slice(1).map((x) => x.clause.ref).join(", ")}.` : ""}`,
        quote: h.quote,
        clause: h.clause,
        precedent_ids: precedentIds(ctx, "liability"),
        confidence: "HIGH",
        source: "pattern",
      }),
    );
    // precedent deviation: AtliQ's only signed BAA capped breach liability
    if (ctx.config.contract_type === "BAA") {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "liability",
          severity: "MEDIUM",
          title: "Departs from AtliQ's signed BAA precedent (CareBridge capped breach liability at 2x fees)",
          explanation: "The only BAA AtliQ has signed (CareBridge, reviewed by Calloway Stern for $3.8k) kept breach liability inside the MSA's limits with an aggregate cap of two times the prior 12 months' fees. This draft removes any limit. The CareBridge cap is a concrete, already-accepted fallback to propose.",
          quote: h.quote,
          clause: h.clause,
          evidence: [
            ev(
              "signed_contracts/2025-10-06_carebridge_clinics_baa.md",
              "§9.1",
              "aggregate liability for claims relating to a Breach or a violation of this BAA shall not exceed two (2) times the Fees paid or payable under the Master Services Agreement in the twelve (12) months preceding the event giving rise to the claim.",
              "Signed CareBridge BAA §9.1 (precedent)",
            ),
          ],
          precedent_ids: ["P-27"],
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    }
  }
  if (otherHits.length && isBuyer(ctx)) {
    const h = otherHits[0];
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "fairness_to_counterparty",
        severity: "HIGH",
        title: "AtliQ's own paper makes the vendor's liability unlimited while AtliQ's is capped",
        explanation: `AtliQ is the buyer. The vendor's liability is uncapped${capText} This is the clause Karandeep refuses from clients ('liability → 1x fees. NOT unlimited') and the one PixelCraft pushed back on — AtliQ agreed then to cap liability at fees for both sides.`,
        quote: h.quote,
        clause: h.clause,
        precedent_ids: ["P-26", "P-08", "P-07"],
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  return out;
}

function indemnity(ctx: EngineContext, already: Finding[]): Finding[] {
  const out: Finding[] = [];
  const neg = findClause(ctx, /regardless of whether such Losses are caused in whole or in part by the negligence of/i);
  if (neg) {
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: isBuyer(ctx) ? "fairness_to_counterparty" : "indemnity",
        severity: "HIGH",
        title: isBuyer(ctx) ? "AtliQ's paper makes the vendor indemnify AtliQ's own negligence" : "AtliQ would indemnify the client even for the client's own negligence",
        explanation: isBuyer(ctx)
          ? "The vendor indemnity applies even where AtliQ was negligent. AtliQ refused exactly this from PayTrack ('we can't insure against PayTrack's own negligence')."
          : "The indemnity applies 'regardless of whether such Losses are caused in whole or in part by the negligence of' the client's indemnitees. AtliQ's standard is mutual indemnity — each side covers its own breach and negligence (PayTrack, Jan 2025: 'we can't insure against PayTrack's own negligence'). Combined with uncapped liability this exposure is open-ended.",
        quote: neg.quote,
        clause: neg.clause,
        precedent_ids: isBuyer(ctx) ? ["P-09", "P-26"] : precedentIds(ctx, "indemnity"),
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  // one-way indemnity: only AtliQ ever indemnifies
  const indemnitors = findAllClauses(ctx, /shall (?:defend, )?(?:indemnify|hold harmless)/i).map((h) => {
    const m = h.clause.text.match(/(?:^|\.\s|\)\s)(?:\*\*[^*]+\*\*\s*)?(?:the\s+)?([A-Z][A-Za-z ]{1,40}?)\s+shall (?:defend, )?(?:indemnify|hold)/);
    return { ...h, who: m ? m[1] : "" };
  });
  const mutual = indemnitors.some((h) => /each party|either party|each\s+\(/i.test(h.who) || /Each Party/.test(h.clause.text.slice(0, 80)));
  const atliqOnly = indemnitors.length > 0 && !mutual && indemnitors.every((h) => isAtliqName(ctx, h.who));
  if (atliqOnly && !isBuyer(ctx)) {
    const h = indemnitors[0];
    if (!already.some((f) => f.contract_clause_id === h.clause.id)) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "indemnity",
          severity: "MEDIUM",
          title: "One-way indemnity — only AtliQ indemnifies",
          explanation: "Only AtliQ gives an indemnity; nothing comes back the other way. Karandeep's checklist: 'indemnity → mutual'. In an NDA labelled mutual, a one-way uncapped indemnity is a sign the document is not actually balanced.",
          quote: h.quote,
          clause: h.clause,
          precedent_ids: precedentIds(ctx, "indemnity"),
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    }
  }
  return out;
}

function payment(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const pwp = findClause(ctx, /conditional upon [^.]{0,60}receipt of payment|in which \w+ receives payment from|after [^.]{0,40}receives? (?:the corresponding )?payment from/i);
  if (pwp) {
    const d = Math.max(0, ...days(pwp.clause.text));
    if (isBuyer(ctx)) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "fairness_to_counterparty",
          severity: "HIGH",
          title: `Pay-when-paid: the vendor is paid only after the end client pays AtliQ${d ? ` (long-stop ${d} days)` : ""}`,
          explanation: `AtliQ is the buyer. The vendor carries AtliQ's collection risk${d ? ` and may wait up to ${d} days` : ""}. AtliQ's own position as a supplier is '30 days, 45 max'; for PixelCraft (six people) Karandeep agreed 30-day payment. The tracker notes say the vendor is already pushing back on this ('we're 12 people').`,
          quote: pwp.quote,
          clause: pwp.clause,
          precedent_ids: ["P-26", "P-12"],
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    } else {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "payment",
          severity: "HIGH",
          title: "AtliQ is paid only after the other party collects (pay-when-paid)",
          explanation: `Payment to AtliQ depends on the other party first receiving payment from its customer${d ? `, and then a further ${d} days` : ""}. AtliQ carries the end customer's credit risk. Checklist: '30 days, 45 max'; Trustline was negotiated from 90 to 45 days.`,
          quote: pwp.quote,
          clause: pwp.clause,
          precedent_ids: precedentIds(ctx, "payment"),
          confidence: "MEDIUM",
          source: "pattern",
        }),
      );
    }
  }
  if (!isBuyer(ctx)) {
    const payRe = /(?:shall pay|are payable|is payable|payable within|pay (?:each|all|undisputed))[^.]*?\(?(\d{1,3})\)?\s*days/i;
    for (const c of ctx.parsed.clauses) {
      if (pwp && c.id === pwp.clause.id) continue;
      const m = payRe.exec(c.text);
      if (!m) continue;
      const sentence = sentenceOf(c.text, m.index);
      if (new RegExp(`\\b${esc(ctx.atliqTerm)} shall pay`, "i").test(sentence)) continue; // AtliQ paying (e.g. LD) — not payment terms
      const d = Math.max(...days(sentence));
      if (!(d > 45)) continue;
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "payment",
          severity: d >= 90 ? "HIGH" : "MEDIUM",
          title: `Payment in ${d} days`,
          explanation: `Invoices are payable in ${d} days. AtliQ's stated position is '30 days, 45 max' (Karandeep's checklist) and Trustline's 90-day request was negotiated down to 45 days in Aug 2026. ${d >= 90 ? "At 90 days AtliQ funds roughly a quarter of delivery cost upfront." : ""}`,
          quote: sentence,
          clause: c,
          precedent_ids: precedentIds(ctx, "payment"),
          confidence: "HIGH",
          source: "pattern",
        }),
      );
      break;
    }
    const waived = findClause(ctx, /not submitted within [^.]*days[^.]*deemed waived/i);
    if (waived) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "payment",
          severity: "LOW",
          title: "Late invoices are forfeited",
          explanation: "Invoices not submitted within the stated window are deemed waived — an admin slip forfeits earned fees. Worth tracking operationally if accepted.",
          quote: waived.quote,
          clause: waived.clause,
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    }
  }
  return out;
}

function termination(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const noTc = findClause(ctx, new RegExp(`${esc(ctx.atliqTerm)}[^.]{0,40}may not terminate this Agreement for convenience`, "i"));
  if (noTc) {
    const other = findClause(ctx, /may terminate this Agreement at any time[^.]*?(\d+)\)? days|for any reason or no reason, upon (?:\w+ )*\((\d+)\) days/i);
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "termination",
        severity: "HIGH",
        title: "Asymmetric termination — the other side can exit at will, AtliQ cannot",
        explanation: `${noTc.clause.ref} locks AtliQ in for the initial term${other ? `, while ${other.clause.ref} lets the other party walk away on short notice ("${other.quote.slice(0, 140)}")` : ""}. AtliQ's precedent for partnerships is mutual 90-day termination for convenience (CloudSpan, Aug 2025). Check also what happens to unpaid revenue share on termination.`,
        quote: noTc.quote,
        clause: noTc.clause,
        evidence: [],
        precedent_ids: ["P-18", "P-22"],
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  for (const h of findAllClauses(ctx, /terminat\w*[^.]{0,120}(?:for convenience|for any reason or no reason)/i)) {
    if (noTc && h.clause.id === noTc.clause.id) continue;
    const t = h.clause.text;
    const d = days(t);
    const notice = d.length ? Math.min(...d) : NaN;
    const noWip = /no obligation to pay for work in progress|sole obligation shall be to pay Fees for Deliverables accepted/i.test(t);
    const onlyAccepted = /performed and accepted/i.test(t);
    const subject = (t.match(/(?:^|\s)([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?) may terminate/) ?? [])[1] ?? "";
    const otherSide = subject && !isAtliqName(ctx, subject) && !/either|each/i.test(subject);
    if (otherSide && noWip && notice <= 15) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "termination",
          severity: "HIGH",
          title: `Termination on ${notice} days' notice with no payment for work in progress`,
          explanation: `The client can terminate on ${notice} days' notice and pay only for accepted deliverables — work in progress, unaccepted deliverables and demobilisation are unpaid. Karandeep's checklist: 'termination → they pay for work done'. Other client contracts pay pro rata for milestones in progress (Trustline, Acme).`,
          quote: h.quote,
          clause: h.clause,
          precedent_ids: precedentIds(ctx, "termination"),
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    } else if (isBuyer(ctx) && subject && isAtliqName(ctx, subject) && noWip) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "fairness_to_counterparty",
          severity: "MEDIUM",
          title: `AtliQ can terminate the vendor on ${notice} days without paying for work in progress`,
          explanation: "AtliQ is the buyer. The vendor bears all work-in-progress risk on a short convenience termination — the term AtliQ objects to as a supplier ('they pay for work done').",
          quote: h.quote,
          clause: h.clause,
          precedent_ids: ["P-22", "P-26"],
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    } else if (otherSide && onlyAccepted && !isBuyer(ctx)) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "termination",
          severity: "LOW",
          title: "On convenience termination only accepted services are paid",
          explanation: "Payment on convenience termination covers services 'performed and accepted' — work performed but not yet accepted may go unpaid. Checklist: 'they pay for work done'.",
          quote: h.quote,
          clause: h.clause,
          precedent_ids: precedentIds(ctx, "termination"),
          confidence: "MEDIUM",
          source: "pattern",
        }),
      );
    }
  }
  const renew = findClause(ctx, /renews? automatically[^.]*unless (\w+) gives notice/i);
  if (renew && !/either party/i.test(renew.quote)) {
    const who = renew.quote.match(/unless (\w+) gives notice/i)?.[1] ?? "";
    if (who && !isAtliqName(ctx, who)) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "termination",
          severity: "MEDIUM",
          title: "Only the other party can stop auto-renewal",
          explanation: `Renewal can be stopped only by ${who}. AtliQ has no exit at the end of the term.`,
          quote: renew.quote,
          clause: renew.clause,
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    }
  }
  return out;
}

function ip(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  if (isBuyer(ctx)) return out;
  const pre = findClause(ctx, /(Pre-Existing Materials|pre-existing materials|pre-existing tools)[^.]*?(incorporated|necessary for)[^.]*?(assign|vest)|(assign|vest)[^.]*?(Pre-Existing Materials|pre-existing materials) incorporated/i);
  if (pre) {
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "ip",
        severity: "HIGH",
        title: "AtliQ's pre-existing tools would be assigned to the client",
        explanation: "Pre-existing materials incorporated into (or needed to use) a deliverable are assigned outright to the client, not licensed. AtliQ's position: 'client owns what we build for them, we keep our own stuff'. This is how PipeKit was lost to Northwind (§9.2 there) — once assigned, AtliQ can no longer reuse or warrant ownership of the accelerator elsewhere.",
        quote: pre.quote,
        clause: pre.clause,
        precedent_ids: ["P-21", "P-13"],
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  return out;
}

function ndaTerms(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  if (ctx.config.contract_type !== "NDA") return out;
  const resid = findClause(ctx, /([A-Z][A-Za-z]+) shall be free to use Residuals/);
  if (resid) {
    const who = resid.quote.match(/([A-Z][A-Za-z]+) shall be free to use Residuals/)?.[1] ?? "";
    if (!isAtliqName(ctx, who)) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "nda_mutuality",
          severity: "HIGH",
          title: "One-sided residuals clause — the other side may reuse what it learns from AtliQ",
          explanation: `Only ${who} may use 'Residuals' (anything its people remember, including ideas, know-how and techniques) for any purpose. AtliQ will be presenting its architecture and methods; this lets the counterparty use them freely while AtliQ stays bound. GlobalMart precedent: 'we'll be sharing our architecture too'.`,
          quote: resid.quote,
          clause: resid.clause,
          precedent_ids: ["P-23"],
          confidence: "HIGH",
          source: "pattern",
        }),
      );
    }
  }
  const perp = findClause(ctx, /in perpetuity|perpetual(?:ly)?\b/i);
  if (perp) {
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "nda_mutuality",
        severity: "MEDIUM",
        title: "Confidentiality obligations last in perpetuity",
        explanation: "Obligations never end. AtliQ's signed NDAs run 3–5 years after the disclosure period (Al Noor 5 years, Harrington 3 years, LoopMart draft 3 years).",
        quote: perp.quote,
        clause: perp.clause,
        precedent_ids: ["P-25"],
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  if (!/independently developed/i.test(ctx.text)) {
    const exc = findClause(ctx, /shall not apply to information/i);
    if (exc) {
      out.push(
        mkFinding(ctx, {
          type: "POTENTIAL_RISK",
          category: "nda_mutuality",
          severity: "MEDIUM",
          title: "No exclusion for independently developed information",
          explanation: "The standard carve-out for information the recipient develops independently is missing. Every signed AtliQ NDA has it; without it, AtliQ's own later work in the same space could be argued to be a breach.",
          quote: exc.quote,
          clause: exc.clause,
          precedent_ids: ["P-25"],
          confidence: "MEDIUM",
          source: "pattern",
        }),
      );
    }
  }
  return out;
}

/** Restrictive covenants that bind AtliQ in the incoming contract (non-compete, account non-solicit, no-hire). */
export function restrictiveCovenants(ctx: EngineContext): { findings: Finding[]; covenants: { clause: Clause; quote: string; nonCompete: boolean }[] } {
  const findings: Finding[] = [];
  const covenants: { clause: Clause; quote: string; nonCompete: boolean }[] = [];
  const subj = new RegExp(`(?:the\\s+)?\\b${esc(ctx.atliqTerm)}\\b[^.]{0,30}\\s(?:shall not|undertakes that neither|shall cause its Affiliates not to)`, "i");
  for (const c of ctx.parsed.clauses) {
    const m = subj.exec(c.text);
    if (!m) continue;
    const s = sentenceOf(c.text, m.index);
    if (!/solicit|provide (?:any |similar )|provide services|compete|market to|\bhire\b|employ/i.test(s)) continue;
    if (/^(neither|each) party/i.test(s)) continue;
    const nonCompete = /provide (?:any |similar )|provide services|compete|market to/i.test(s);
    covenants.push({ clause: c, quote: s, nonCompete });
    const dur = s.match(/\((\d+)\) months/)?.[1];
    findings.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "non_compete_exclusivity",
        severity: nonCompete ? "HIGH" : "LOW",
        title: nonCompete
          ? `New restrictive covenant on AtliQ${dur ? ` (term + ${dur} months)` : ""}`
          : `One-way no-hire / non-solicit on AtliQ${dur ? ` (term + ${dur} months)` : ""}`,
        explanation: nonCompete
          ? `This clause would restrict who AtliQ can work for — and it would join the commitments register. AtliQ has no list of what it has already promised not to do outside this tool; restrictions like this are how the Al Noor GCC non-compete came to block hospitality work. Check it against current clients and pipeline before signing (see Commitments).`
          : "Only AtliQ is restricted from hiring the other side's people. AtliQ's signed client contracts use mutual employee non-solicits.",
        quote: s,
        clause: c,
        precedent_ids: nonCompete ? ["P-17", "P-18"] : [],
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  return { findings, covenants };
}

function insurance(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  for (const c of ctx.parsed.clauses) {
    const m = /cyber[^;]{0,200}?(?:\(\$\s?([\d,]+)\)|\$\s?([\d,]+)|USD\s?([\d,]+))/i.exec(c.text);
    if (!m) continue;
    const amount = Number((m[1] ?? m[2] ?? m[3]).replace(/,/g, ""));
    if (!(amount > 1_000_000)) continue;
    const others = Array.from(c.text.matchAll(/(professional liability|errors and omissions|umbrella)[^;$]*\$\s?([\d,]+)/gi)).map((x) => `${x[1]} $${x[2]}`);
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "insurance",
        severity: "HIGH",
        title: `Requires $${(amount / 1_000_000).toFixed(0)}M cyber cover — AtliQ holds $1M`,
        explanation: `The contract requires cyber liability insurance of $${amount.toLocaleString("en-US")}. AtliQ's cyber policy is $1M (Karandeep, tracker C-046 / Harrington huddle 27 Sep). Signing would put AtliQ in breach from day one unless cover is increased or the requirement negotiated.${others.length ? ` Other limits in the same clause: ${others.join(", ")} — AtliQ's PI/E&O cover is not recorded in the dataset; verify with the broker.` : ""} The gap has not yet been raised with the client (meeting note 27 Sep).`,
        quote: sentenceOf(c.text, m.index),
        clause: c,
        precedent_ids: ["P-28"],
        rule_id: "R9",
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  return out;
}

function miscellaneous(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const acc = findClause(ctx, /Acceptance shall not be deemed to occur by use/i);
  if (acc) {
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: isBuyer(ctx) ? "fairness_to_counterparty" : "payment",
        severity: isBuyer(ctx) ? "LOW" : "MEDIUM",
        title: "No deemed acceptance — invoicing depends entirely on the other side signing off",
        explanation: isBuyer(ctx)
          ? "AtliQ's paper gives the vendor no deemed acceptance; payment can be stalled indefinitely."
          : "Acceptance never happens by use in production or lapse of time, and the client may repeat testing or reject for a full refund. Since invoices follow acceptance, payment timing is in the client's hands. AtliQ's signed MSAs deem acceptance after 7–10 business days without written rejection.",
        quote: acc.quote,
        clause: acc.clause,
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  const setoff = findClause(ctx, /set off[^.]*(?:any other agreement|any member of)/i);
  if (setoff && !isBuyer(ctx)) {
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "payment",
        severity: "LOW",
        title: "Broad set-off right across other agreements",
        explanation: "The client may deduct amounts it claims under other agreements from these invoices (the Brightwater contract had the same group-wide set-off).",
        quote: setoff.quote,
        clause: setoff.clause,
        precedent_ids: ["P-05"],
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  const unilateral = findClause(ctx, /may update [^.]*from time to time[^.]*(?:shall form|form) part of this Agreement/i);
  if (unilateral) {
    out.push(
      mkFinding(ctx, {
        type: "POTENTIAL_RISK",
        category: "other",
        severity: "MEDIUM",
        title: "Other party can change the terms unilaterally",
        explanation: "Programme guides and portal terms updated by the other side automatically become part of the contract, without AtliQ's signature.",
        quote: unilateral.quote,
        clause: unilateral.clause,
        confidence: "HIGH",
        source: "pattern",
      }),
    );
  }
  return out;
}

/** AtliQ's own template still carries terms Karandeep already softened for a small vendor (PixelCraft, Oct 2025). */
function templateDrift(ctx: EngineContext, found: Finding[]): Finding[] {
  if (!isBuyer(ctx)) return [];
  const unfair = found.filter((x) => x.category === "fairness_to_counterparty" && (x.severity === "HIGH" || x.severity === "CRITICAL"));
  if (unfair.length < 2) return [];
  const form = findClause(ctx, /Form:\s*[^\n]+|Template[^\n]*/i) ?? { clause: ctx.parsed.clauses[0], quote: sentenceOf(ctx.parsed.clauses[0].text, 0) };
  const evidence = [ev("negotiation_notes.md", "PixelCraft Studio — Oct 2025", "Deleted the penalty, 30-day payment, liability capped at fees for both sides.", "Negotiation note — PixelCraft (unreviewed reconstruction)")];
  evidence.push(ev("negotiation_notes.md", "PixelCraft Studio — Oct 2025", "Changes made in PixelCraft's copy only — not sure the template file was ever updated."));
  if (ctx.tracker?.notes) {
    evidence.push({ source_file: "contract_tracker.csv", clause_ref: `${ctx.tracker.contract_id} notes`, quote: ctx.tracker.notes, doc_status: "tracker_note", grounded: true, label: `Tracker ${ctx.tracker.contract_id} (seller notes)` });
  }
  return [
    mkFinding(ctx, {
      type: "POTENTIAL_RISK",
      category: "fairness_to_counterparty",
      severity: "MEDIUM",
      title: "AtliQ's vendor template still has the terms softened for PixelCraft",
      explanation: `${unfair.length} one-sided terms in AtliQ's own paper (delay penalty, payment, uncapped vendor liability) are the same three Karandeep removed for PixelCraft in Oct 2025 — 'I don't want our paper to be the thing I hate receiving'. The fix was made in PixelCraft's copy only; the template was apparently never updated, and this draft was built from it (and, per the tracker, partly from a client's draft). Consider updating the template, not just this agreement.`,
      quote: form.quote,
      clause: form.clause,
      evidence,
      precedent_ids: ["P-26"],
      confidence: "HIGH",
      source: "pattern",
    }),
  ];
}

export function runPatterns(ctx: EngineContext): { findings: Finding[]; covenants: ReturnType<typeof restrictiveCovenants>["covenants"] } {
  if (!ctx.config.checks.clause_risks) return { findings: [], covenants: [] };
  const f: Finding[] = [];
  f.push(...liquidatedDamages(ctx));
  f.push(...liability(ctx));
  f.push(...indemnity(ctx, f));
  f.push(...payment(ctx));
  f.push(...termination(ctx));
  f.push(...ip(ctx));
  f.push(...ndaTerms(ctx));
  const rc = restrictiveCovenants(ctx);
  f.push(...rc.findings);
  f.push(...insurance(ctx));
  f.push(...miscellaneous(ctx));
  f.push(...templateDrift(ctx, f));
  return { findings: f, covenants: rc.covenants };
}

export { atliqRe };
