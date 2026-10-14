import { clauseForQuote, type ParsedContract } from "../clauses";
import { datasetToday } from "../config";
import { docStatusFor, loadPrecedents, loadRegister, loadSignedDocs, readRaw, rawExists } from "../data";
import { isGrounded, normalise } from "../text";
import type {
  AtliqEntity,
  AtliqRole,
  Category,
  Clause,
  Commitment,
  Confidence,
  ContractType,
  Evidence,
  Finding,
  FindingType,
  PortfolioClient,
  Precedent,
  ReviewConfig,
  Severity,
  TrackerRow,
} from "../types";

export interface EngineContext {
  parsed: ParsedContract;
  text: string; // contract body used for grounding
  config: ReviewConfig;
  counterparty: string;
  tracker: TrackerRow | null;
  fileRel: string | null; // dataset path (incoming/…) when reviewing a dataset file
  today: string;
  atliqTerm: string; // how the contract refers to AtliQ ("Contractor", "Vendor", "Partner", …)
  counterpartyTerm: string;
  register: Commitment[];
  precedents: Precedent[];
  portfolio: PortfolioClient[];
  usHealthcare: boolean;
  euPersonalData: boolean;
}

// ---------------------------------------------------------------------------
// Detection helpers (used for auto-detected review setup and for uploads)
// ---------------------------------------------------------------------------

const ATLIQ_INC = /\bATLIQ INC\b|\bAtliQ Inc\b\.?/;
const ATLIQ_PVT = /ATLIQ TECHN[O0]LOGIES (PRIVATE LIMITED|PVT\.? LTD)|AtliQ Technologies (Private Limited|Pvt\.? Ltd)/i;

export function partiesClauses(parsed: ParsedContract): Clause[] {
  const head = parsed.clauses.filter((c) => /part|preamble|between|recital|background/i.test(c.heading + " " + c.ref)).slice(0, 12);
  return head.length ? head : parsed.clauses.slice(0, 6);
}

/** Party segments: one per party, even when both parties sit in a single paragraph. */
function partySegments(parsed: ParsedContract): string[] {
  const head = partiesClauses(parsed).map((c) => c.text).join("\n");
  return head.split(/\n|(?<=\)),\s+and\s+|;\s+and\s+|\)\s+and\s+(?=\*\*)/);
}

/** The party paragraph that names AtliQ, and its defined term, e.g. ("**Contractor**"). */
export function atliqPartyText(parsed: ParsedContract): string {
  const lines = partySegments(parsed);
  const hit = lines.find((l) => ATLIQ_INC.test(l) || ATLIQ_PVT.test(l));
  if (hit) return hit;
  const m = parsed.body.slice(0, 4000).split("\n").find((l) => ATLIQ_INC.test(l) || ATLIQ_PVT.test(l));
  return m ?? "";
}

function definedTerms(s: string): string[] {
  return Array.from(s.matchAll(/\(\s*(?:the\s+|hereinafter\s+)?(?:"|“)\**([A-Z][A-Za-z ]+?)\**(?:"|”)/g)).map((m) => m[1].trim());
}

export function detectEntity(parsed: ParsedContract): AtliqEntity {
  const t = atliqPartyText(parsed);
  if (ATLIQ_PVT.test(t)) return "pvt_ltd";
  if (ATLIQ_INC.test(t)) return "inc";
  return "unknown";
}

export function detectAtliqTerm(parsed: ParsedContract): string {
  const t = atliqPartyText(parsed);
  const terms = definedTerms(t).filter((x) => !/^(Party|Parties|Agreement)$/i.test(x));
  // prefer the role word over "AtliQ" (e.g. "AtliQ" or the "Recipient" → Recipient)
  const role = terms.find((x) => !/atliq/i.test(x));
  return role ?? terms[0] ?? "AtliQ";
}

export function detectCounterpartyTerm(parsed: ParsedContract): string {
  const lines = partySegments(parsed).filter((l) => !ATLIQ_INC.test(l) && !ATLIQ_PVT.test(l));
  for (const l of lines) {
    const terms = definedTerms(l).filter((x) => !/^(Party|Parties|Agreement|Effective Date)$/i.test(x));
    if (terms.length) return terms.find((x) => /client|company|customer|covered|vendor|contractor/i.test(x)) ?? terms[0];
  }
  return "Client";
}

export function detectCounterpartyName(parsed: ParsedContract): string {
  const head = partiesClauses(parsed).map((c) => c.text).join("\n");
  // prefer a bold name introduced as a party: "**Name**, a company …" / "**Name**, an Illinois corporation"
  for (const m of head.matchAll(/\*\*([^*]{3,90})\*\*,?\s+(?:a|an|the)\s/g)) {
    const name = m[1].trim().replace(/,$/, "");
    if (!ATLIQ_INC.test(name) && !ATLIQ_PVT.test(name) && !/^(Agreement|Effective Date)$/i.test(name)) return name;
  }
  for (const m of head.matchAll(/\*\*([^*]{3,90})\*\*/g)) {
    const name = m[1].trim();
    if (ATLIQ_INC.test(name) || ATLIQ_PVT.test(name)) continue;
    if (/^(Agreement|Party|Parties|Client|Company|Customer|Effective Date|Vendor|Supplier|Partner|Recipient|Discloser|Covered Entity|Business Associate|BY AND BETWEEN|AND|BETWEEN)$/i.test(name)) continue;
    if (name.length < 4 || /^\d/.test(name)) continue;
    return name.replace(/,$/, "").split(/\s[—–|]\s/)[0].trim();
  }
  // plain text (PDF / DOCX uploads carry no markdown): "between Acme Corp, a Delaware corporation … and AtliQ Inc, a …"
  const flat = (head + "\n" + parsed.body.slice(0, 3000)).replace(/\*\*/g, "").replace(/\s+/g, " ");
  for (const m of flat.matchAll(/(?:between|and|BETWEEN|AND)[:\s]+(?:\(\d\)\s*)?([A-Z][A-Za-z0-9&.'’ -]{2,80}?),\s+(?:a|an)\s/g)) {
    const name = m[1].trim();
    if (!ATLIQ_INC.test(name) && !ATLIQ_PVT.test(name) && !/atliq/i.test(name)) return name;
  }
  return "Unknown counterparty";
}

const COUNTRY_PATTERNS: [string, RegExp][] = [
  [
    "USA",
    /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Florida|Georgia corporation|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey corporation|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington corporation|Wisconsin|Wyoming|Delaware corporation[^.]*San Francisco|Chicago|Houston|Columbus|Denver|Boston|Seattle|USA|United States of America)\b/,
  ],
  ["UAE", /\b(Dubai|United Arab Emirates|Abu Dhabi|UAE)\b/],
  ["Saudi Arabia", /\b(Saudi Arabia|Riyadh|Kingdom of Saudi Arabia)\b/],
  ["Qatar", /\b(Qatar|Doha)\b/],
  ["Kuwait", /\bKuwait\b/],
  ["Bahrain", /\b(Bahrain|Manama)\b/],
  ["Ireland", /\bRepublic of Ireland|Dublin\b/],
  ["France", /\b(France|Paris|SAS\b)/],
  ["Netherlands", /\b(Netherlands|Amsterdam|B\.V\.)/],
  ["Germany", /\b(Germany|GmbH|München|Munich)\b/],
  ["UK", /\b(England and Wales|United Kingdom|London|Manchester)\b/],
  ["Singapore", /\bSingapore\b/],
  ["Oman", /\b(Oman|Muscat)\b/],
  ["India", /\b(India|Mumbai|Bengaluru|Pune|Chennai|Hyderabad|Kochi|Gurugram|New Delhi)\b/],
];

export function detectCountry(parsed: ParsedContract): string {
  const head = partiesClauses(parsed)
    .map((c) => c.text)
    .join("\n")
    .split("\n")
    .filter((l) => !ATLIQ_INC.test(l) && !ATLIQ_PVT.test(l))
    .join("\n");
  for (const [country, re] of COUNTRY_PATTERNS) if (re.test(head)) return country;
  return "Unknown";
}

export function detectContractType(title: string, body: string): ContractType {
  const t = `${title} ${body.slice(0, 600)}`;
  if (/business associate/i.test(title)) return "BAA";
  if (/non-?disclosure|nondisclosure|\bNDA\b/i.test(title)) return "NDA";
  if (/statement of work/i.test(title)) return "SOW";
  if (/partnership|partner agreement|referral agreement|reseller agreement/i.test(title)) return "Partnership";
  if (/pilot/i.test(title)) return "Pilot";
  if (/subcontractor/i.test(title)) return "Subcontractor";
  if (/independent contractor|contractor agreement/i.test(title)) return "Contractor";
  if (/data processing/i.test(title)) return "DPA";
  if (/master (professional )?services/i.test(title)) return "MSA";
  if (/services agreement|professional services|technology services/i.test(t)) return "Services";
  return "Other";
}

export function detectRole(type: ContractType, atliqTerm: string, counterpartyTerm: string): AtliqRole {
  if (type === "NDA") return "mutual";
  if (type === "Partnership") return "partner";
  if (/^(vendor|contractor|subcontractor|consultant)$/i.test(counterpartyTerm) && !/^(vendor|contractor|supplier|service provider|developer|business associate)$/i.test(atliqTerm)) return "buyer";
  return "supplier";
}

export function expectedEntity(country: string): AtliqEntity {
  if (country === "Unknown" || !country) return "unknown";
  return /^(USA|US|United States)\??$/i.test(country) ? "inc" : "pvt_ltd";
}

export function detectUsHealthcare(text: string, country: string): boolean {
  return /^(USA|US)/.test(country) && /HIPAA|Protected Health Information|\bPHI\b|health system|Business Associate/i.test(text);
}

export function detectEuPersonalData(text: string, country: string): boolean {
  // EU/UK processing: an EU/UK counterparty, an explicit GDPR reference, or an EU end client (GmbH, Germany)
  const eu = /^(Germany|UK|France|Netherlands|Spain|Italy|Ireland)$/.test(country) || /\bGDPR\b|UK GDPR|\bGmbH\b/.test(text);
  return eu && /personal data|technician names|\bGDPR\b/i.test(text);
}

// ---------------------------------------------------------------------------
// Context + finding builder
// ---------------------------------------------------------------------------

export function buildContext(args: {
  parsed: ParsedContract;
  config: ReviewConfig;
  counterparty: string;
  tracker: TrackerRow | null;
  fileRel: string | null;
}): EngineContext {
  const { parsed, config } = args;
  const atliqTerm = detectAtliqTerm(parsed);
  const counterpartyTerm = detectCounterpartyTerm(parsed);
  return {
    ...args,
    text: parsed.body,
    today: datasetToday(),
    atliqTerm,
    counterpartyTerm,
    register: loadRegister(),
    precedents: loadPrecedents(),
    portfolio: loadSignedDocs().portfolio,
    usHealthcare: detectUsHealthcare(parsed.body, config.counterparty_country),
    euPersonalData: detectEuPersonalData(parsed.body, config.counterparty_country),
  };
}

const sourceCache = new Map<string, string>();
export function sourceText(rel: string): string | null {
  if (sourceCache.has(rel)) return sourceCache.get(rel)!;
  if (!rawExists(rel)) return null;
  const t = readRaw(rel);
  sourceCache.set(rel, t);
  return t;
}

/** Evidence from a dataset file, grounding-checked against that file. */
export function ev(source_file: string, clause_ref: string, quote: string, label?: string): Evidence {
  const src = sourceText(source_file);
  return {
    source_file,
    clause_ref,
    quote,
    doc_status: docStatusFor(source_file),
    grounded: src ? isGrounded(quote, src) : false,
    label,
  };
}

let seq = 0;
export function resetSeq() {
  seq = 0;
}

export function mkFinding(
  ctx: EngineContext,
  f: {
    type: FindingType;
    gap_kind?: "confirmed" | "potential";
    category: Category;
    severity: Severity;
    title: string;
    explanation: string;
    quote: string; // verbatim from this contract
    clause?: Clause | null;
    evidence?: Evidence[];
    precedent_ids?: string[];
    commitment_id?: string;
    rule_id?: string;
    confidence: Confidence;
    needs_info?: string;
    source: Finding["source"];
  },
): Finding {
  const clause = f.clause ?? clauseForQuote(ctx.parsed.clauses, f.quote, normalise);
  const quoteGrounded = isGrounded(f.quote, ctx.text);
  const evidence = f.evidence ?? [];
  const grounded = quoteGrounded && evidence.every((e) => e.grounded || e.doc_status === "reference_data" || e.doc_status === "tracker_note");
  return {
    id: `F${String(++seq).padStart(2, "0")}`,
    finding_type: f.type,
    gap_kind: f.gap_kind,
    category: f.category,
    severity: f.severity,
    title: f.title,
    explanation: f.explanation,
    contract_clause_ref: clause?.ref ?? "Not located",
    contract_clause_id: clause?.id,
    contract_quote: f.quote,
    contract_quote_grounded: quoteGrounded,
    evidence,
    precedent_ids: f.precedent_ids ?? [],
    commitment_id: f.commitment_id,
    rule_id: f.rule_id,
    confidence: f.confidence,
    grounded,
    escalation_hints: [],
    needs_info: f.needs_info,
    source: f.source,
  };
}

/** First clause whose text matches the regex, with the matching sentence as a quote. */
export function findClause(ctx: EngineContext, re: RegExp, within?: Clause[]): { clause: Clause; quote: string } | null {
  for (const c of within ?? ctx.parsed.clauses) {
    const m = re.exec(c.text);
    if (m) return { clause: c, quote: sentenceOf(c.text, m.index) };
  }
  return null;
}

export function findAllClauses(ctx: EngineContext, re: RegExp): { clause: Clause; quote: string }[] {
  const out: { clause: Clause; quote: string }[] = [];
  for (const c of ctx.parsed.clauses) {
    const m = re.exec(c.text);
    if (m) out.push({ clause: c, quote: sentenceOf(c.text, m.index) });
  }
  return out;
}

/** Sentence inside a clause around idx, stripped of the leading clause number and markdown. */
export function sentenceOf(text: string, idx: number): string {
  const lineStart = text.lastIndexOf("\n", idx - 1) + 1;
  const nl = text.indexOf("\n", idx);
  const line = text.slice(lineStart, nl === -1 ? text.length : nl);
  const rel = idx - lineStart;
  // split into sentences, keeping parenthesised numbers like "thirty (30) days." intact
  const parts: { s: number; e: number }[] = [];
  const re = /[.;](?=\s+(?:[A-Z(]|\*\*|$))|[.;]$/g;
  let s = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    parts.push({ s, e: m.index + 1 });
    s = m.index + 1;
  }
  if (s < line.length) parts.push({ s, e: line.length });
  const part = parts.find((p) => rel >= p.s && rel < p.e) ?? parts[0] ?? { s: 0, e: line.length };
  let q = line.slice(part.s, part.e).trim();
  q = q.replace(/^\s*(?:\*\*)?(?:§\s*)?(?:[A-Z]{1,2})?\d+(?:\.\d+)*(?:\*\*)?[.)]?\s+/, ""); // leading clause number
  q = q.replace(/^\*\*[^*]{1,40}\.\*\*\s*/, ""); // leading bold caption "**By Contractor.**"
  q = q.replace(/^\(?[a-z]{1,3}\)\s+/, "");
  q = q.replace(/\*\*/g, "");
  return q.trim();
}

export function precedentIds(ctx: EngineContext, category: Category): string[] {
  return ctx.precedents.filter((p) => p.category === category).map((p) => p.id);
}
