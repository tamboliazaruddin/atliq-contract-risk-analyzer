import type { KeyTerm } from "../types";
import { type EngineContext, findClause } from "./context";

const ENTITY_NAME = { pvt_ltd: "AtliQ Technologies Pvt Ltd", inc: "AtliQ Inc", unknown: "Not identified" } as const;

function term(key: string, label: string, hit: { clause: { ref: string; id: string }; quote: string } | null, value?: string): KeyTerm {
  if (!hit) return { key, label, value: "Not found in document", status: "missing" };
  return { key, label, value: value ?? hit.quote, clause_ref: hit.clause.ref, clause_id: hit.clause.id, quote: hit.quote, status: "found" };
}

/** Deterministic key-term extraction with clause references (FR-2). The LLM may refine values; refs stay grounded. */
export function extractKeyTerms(ctx: EngineContext): KeyTerm[] {
  const t: KeyTerm[] = [];
  t.push({ key: "counterparty", label: "Counterparty", value: ctx.counterparty, status: ctx.counterparty.startsWith("Unknown") ? "ambiguous" : "found" });
  const entityHit = findClause(ctx, /ATLIQ INC|AtliQ Inc|ATLIQ TECHN[O0]LOGIES|AtliQ Technologies/);
  t.push({
    key: "atliq_entity",
    label: "AtliQ signing entity",
    value: `${ENTITY_NAME[ctx.config.atliq_entity]} (as "${ctx.atliqTerm}")`,
    clause_ref: entityHit?.clause.ref,
    clause_id: entityHit?.clause.id,
    status: ctx.config.atliq_entity === "unknown" ? "missing" : "found",
  });

  const money = /((?:USD|EUR|INR|US\$|€|\$)\s?[\d,]+(?:\.\d+)?)/;
  const value =
    findClause(ctx, /(?:Contract Value|total (?:fixed )?(?:fee|fees|remuneration|charges)|Total Contract Value|Fees for SOW-1 total|total Fees)[^.]*?(?:USD|EUR|INR|\$|€)\s?[\d,]+/i) ??
    findClause(ctx, /(?:fees?|price|charges|remuneration)\b[^.]{0,40}?(?:USD|EUR|INR|GBP|\$|€|£)\s?[\d,]{4,}/i) ??
    findClause(ctx, /\*\*Total(?: Fees)?\*\*[^\n]*\*\*[\d,]+\*\*/i);
  const vm = value?.quote.match(money) ?? value?.clause.text.match(/\*\*([\d,]+)\*\*/);
  t.push(term("value", "Contract value", value, vm ? vm[1].replace(/\*\*/g, "") : undefined));

  const termSections = ctx.parsed.clauses.filter((c) => /\bterm\b|duration|commencement/i.test(c.heading));
  const termRe = /(?:continue|remain in force|valid|commences?|runs? for|in force for)[^.]{0,80}?(?:\(\d+\)\s*(?:years?|months?)|until)|until (?:completion|acceptance|terminated)/i;
  const termHit = (termSections.length ? findClause(ctx, termRe, termSections) : null) ?? findClause(ctx,/(?:continue|remain in force|valid|commences?)[^.]{0,80}?(?:for|period of)\s+(?:an initial term of\s+)?(?:a period of\s+)?[\w-]+\s*\(\d+\)\s*(?:years?|months?)|until (?:completion|acceptance)|for a period of [\w-]+ \(\d+\) (?:years|months)/i);
  t.push(term("term", "Term", termHit));

  const pay = findClause(ctx, /(?:shall pay|will pay|are payable|is payable|payable within|pay (?:each|all|undisputed)|(?:shall|will) settle)[^.]*days/i);
  const pd = pay?.quote.match(/\((\d{1,3})\)\s*days|(\d{1,3})\s*days/);
  t.push(term("payment", "Payment terms", pay, pd ? `${pd[1] ?? pd[2]} days — ${pay!.quote}` : undefined));

  const ld = findClause(ctx, /liquidated damages|contractual penalty|service credit equal to/i);
  // no delay-damages clause is a fact about the contract, not a failed extraction
  t.push(ld ? term("ld", "Delay damages / LD", ld) : { key: "ld", label: "Delay damages / LD", value: "None in this contract", status: "found" });

  const cap = findClause(ctx, /aggregate liability|total liability|total aggregate liability|liability shall be limited|liable without limitation/i);
  t.push(term("liability_cap", "Liability cap", cap));

  const law = findClause(ctx, /governed by|governing law \(laws of/i);
  t.push(term("governing_law", "Governing law", law));

  const forum = findClause(ctx, /arbitration|courts? (?:of|at|in|located in)|place of jurisdiction/i);
  t.push(term("jurisdiction", "Disputes / jurisdiction", forum));

  const tc = findClause(ctx, /terminat\w*[^.]{0,80}(?:for convenience|for any reason or no reason)|(?:may|can) (?:end|terminate) this Agreement (?:on|by giving|upon) [^.]{0,30}notice/i);
  t.push(term("termination", "Termination for convenience", tc));

  const ipHit = findClause(ctx, /become the property|shall vest|shall own|works? made for hire|right of use|Upon (?:full )?payment[^.]*own|retain(?:s)? (?:all )?(?:right|ownership)/i);
  t.push(term("ip", "IP ownership", ipHit));

  if (ctx.config.contract_type === "NDA") {
    const dur = findClause(ctx, /(?:obligations|Agreement)[^.]{0,80}(?:continue|survive|remain in force)[^.]*(?:years|perpetuity)/i);
    t.push(term("confidentiality_term", "Confidentiality period", dur));
    // commercial fields do not apply to an NDA — only flag them if actually present
    const commercial = new Set(["value", "payment", "ld", "liability_cap", "ip"]);
    return t.filter((k) => !commercial.has(k.key) || k.status === "found");
  }
  if (ctx.config.contract_type === "BAA") {
    const commercial = new Set(["value", "payment", "ld", "ip", "termination"]);
    return t.filter((k) => !commercial.has(k.key) || k.status === "found");
  }
  return t;
}
