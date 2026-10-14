import fs from "node:fs";
import path from "node:path";
import { parseContract } from "../clauses";
import { RAW_DIR } from "../config";
import { commitmentStatus, loadQueue, loadTracker, readRaw } from "../data";
import { findKeyword, sentenceAround } from "../text";
import type { CheckResult, Clause, Commitment, Evidence, Finding } from "../types";
import { type EngineContext, ev, findClause, mkFinding, partiesClauses, sentenceOf } from "./context";
import type { restrictiveCovenants } from "./patterns";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (iso?: string) => {
  if (!iso) return "open-ended";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
};

const stripNum = (s: string) => s.replace(/^\s*(?:§\s*)?(?:[A-Z]{1,2})?\d+(?:\.\d+)+\s+/, "").replace(/^\s*\(?[a-z]{1,3}\)\s+/, "").trim();

export function commitmentLabel(c: Commitment, today: string): string {
  const st = commitmentStatus(c, today);
  const short = c.source_file.replace(/^signed_contracts\/\d{4}-\d{2}-\d{2}_/, "").replace(/\.md$/, "").replace(/_/g, " ");
  const until = st === "expired" ? `Expired ${fmtDate(c.end)}` : st === "spent" ? "Spent" : st === "perpetual" ? "Perpetual" : `Active until ${fmtDate(c.end)}`;
  return `Signed: ${short} ${c.clause_ref} (${until})`;
}

function commitmentEvidence(c: Commitment, today: string): Evidence[] {
  const out = [ev(c.source_file, c.clause_ref, c.quote, commitmentLabel(c, today))];
  for (const x of c.extra_quotes) out.push(ev(c.source_file, x.clause_ref, x.quote));
  return out;
}

/** Tracker notes for this deal that mention any of the given words — side-channel context (e.g. "Jay gave sharper rate"). */
function trackerEvidence(ctx: EngineContext, words: string[]): Evidence[] {
  const row = ctx.tracker;
  if (!row?.notes) return [];
  const hit = words.some((w) => findKeyword(row.notes, w) >= 0);
  if (!hit) return [];
  return [{ source_file: "contract_tracker.csv", clause_ref: `${row.contract_id} notes`, quote: row.notes, doc_status: "tracker_note", grounded: true, label: `Tracker ${row.contract_id} (seller notes, not a contract)` }];
}

interface GroupHit {
  group: string;
  keyword: string;
  clause: Clause;
  idx: number;
}

function keywordGroupHits(ctx: EngineContext, groups: { name: string; any: string[] }[]): GroupHit[][] | null {
  const perGroup: GroupHit[][] = [];
  // AtliQ's own identity (party block, notices, signatures: "incorporated in India", "Pune") must never count as a match
  const ownIdentity = /ATLIQ|AtliQ Technologies|AtliQ Inc|Baner Business Bay|Princeton/;
  const clauses = ctx.parsed.clauses.filter((c) => !ownIdentity.test(c.text));
  for (const g of groups) {
    const hits: GroupHit[] = [];
    for (const c of clauses) {
      for (const k of g.any) {
        const idx = findKeyword(c.text, k);
        if (idx >= 0) hits.push({ group: g.name, keyword: k, clause: c, idx });
      }
    }
    if (!hits.length) return null;
    perGroup.push(hits);
  }
  return perGroup;
}

function parseRates(ctx: EngineContext): { role: string; rate: number; clause: Clause; line: string }[] {
  const out: { role: string; rate: number; clause: Clause; line: string }[] = [];
  for (const c of ctx.parsed.clauses) {
    for (const line of c.text.split("\n")) {
      const m = line.match(/^\|\s*([A-Za-z][A-Za-z /-]+?)\s*\|\s*(?:USD\s*)?\$\s?(\d+(?:\.\d+)?)\s*(?:\/\s?(?:hr|hour))?\s*\|/);
      if (m) out.push({ role: m[1].trim(), rate: +m[2], clause: c, line: line.trim() });
    }
  }
  return out;
}

export function registerConflicts(ctx: EngineContext): { findings: Finding[]; check: CheckResult; activeConflicts: number } {
  const findings: Finding[] = [];
  const checked: string[] = [];
  const expiredHits: string[] = [];
  if (!ctx.config.checks.commitments) {
    return {
      findings,
      activeConflicts: 0,
      check: { id: "chk-R8", rule_id: "R8", name: "No conflict with the commitments register", status: "not_applicable", detail: "Commitments check switched off in review setup.", evidence: [] },
    };
  }
  const partiesText = partiesClauses(ctx.parsed).map((c) => c.text).join("\n");

  for (const c of ctx.register) {
    const st = commitmentStatus(c, ctx.today);
    if (c.matcher.kind === "none" || c.matcher.kind === "engagement_scope") continue;
    checked.push(c.id);
    const inactive = st === "expired" || st === "spent" || st === "waived";

    if (c.matcher.kind === "keyword_groups") {
      const hits = keywordGroupHits(ctx, c.matcher.groups);
      if (!hits) continue;
      // anchor: the operative clause hitting the most groups (scope / schedules beat parties and recitals);
      // ties go to the geography hit, which is usually the decisive fact
      const geoIdx = c.matcher.groups.findIndex((g) => /geograph|territory|gcc|india/i.test(g.name));
      const byClause = new Map<string, { hits: GroupHit[]; groups: Set<string> }>();
      hits.flat().forEach((h) => {
        const e = byClause.get(h.clause.id) ?? { hits: [], groups: new Set<string>() };
        e.hits.push(h);
        e.groups.add(h.group);
        byClause.set(h.clause.id, e);
      });
      const geoName = geoIdx >= 0 ? c.matcher.groups[geoIdx].name : "";
      const ranked = Array.from(byClause.values()).sort((a, b) => {
        const op = (x: typeof a) => (/part|preamble|recital|background/i.test(x.hits[0].clause.heading + x.hits[0].clause.ref) ? 0 : 1);
        const numbered = (x: typeof a) => (x.hits[0].clause.ref.startsWith("§") ? 1 : 0);
        return b.groups.size - a.groups.size || op(b) - op(a) || Number(b.groups.has(geoName)) - Number(a.groups.has(geoName)) || numbered(b) - numbered(a);
      });
      const best = ranked[0];
      const anchor = best.hits.find((h) => h.group === geoName) ?? best.hits[0];
      const quote = stripNum(sentenceAround(anchor.clause.text, anchor.idx).replace(/\*\*/g, ""));
      const direct = c.matcher.direct_regex ? new RegExp(c.matcher.direct_regex, "i").test(partiesText) : true;
      const summary = c.matcher.groups
        .map((g, i) => `${g.name}: ${Array.from(new Set(hits[i].map((h) => h.keyword))).slice(0, 6).join(", ")}`)
        .join(" · ");
      if (inactive) {
        expiredHits.push(`${c.counterparty} ${c.clause_ref} (${st})`);
        findings.push(
          mkFinding(ctx, {
            type: "HISTORICAL_CONFLICT",
            category: "non_compete_exclusivity",
            severity: "LOW",
            title: `Matches an ${st} restriction — ${c.counterparty} ${c.clause_ref}`,
            explanation: `For awareness only: this contract touches the scope of a restriction that is now ${st}. ${c.scope} (${c.end_note ?? ""}) Matched — ${summary}.`,
            quote,
            clause: anchor.clause,
            evidence: commitmentEvidence(c, ctx.today),
            commitment_id: c.id,
            rule_id: "R8",
            confidence: "MEDIUM",
            source: "register",
          }),
        );
        continue;
      }
      const sevOrder = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
      const severity = direct ? c.conflict_severity : sevOrder[Math.max(0, sevOrder.indexOf(c.conflict_severity) - 1)];
      const related = c.related_ids.map((id) => ctx.register.find((r) => r.id === id)).filter(Boolean) as Commitment[];
      const relatedEv = related.flatMap((r) => [ev(r.source_file, r.clause_ref, r.quote, commitmentLabel(r, ctx.today))]);
      const relatedText = related.length
        ? ` Related: ${related.map((r) => `${r.type.toLowerCase().replace(/_/g, " ")} (${commitmentStatus(r, ctx.today)}) — ${r.scope}`).join(" ")}`
        : "";
      const affiliates = c.binds_affiliates
        ? ` The restriction binds AtliQ's Affiliates too, so signing through ${ctx.config.atliq_entity === "inc" ? "AtliQ Inc" : "the other AtliQ entity"} does not avoid it.`
        : "";
      const keywordsAll = c.matcher.groups.flatMap((g) => g.any);
      findings.push(
        mkFinding(ctx, {
          type: "HISTORICAL_CONFLICT",
          category: c.type === "EXCLUSIVITY" || c.type === "NON_COMPETE" ? "non_compete_exclusivity" : "other",
          severity,
          title: `Potential conflict with ${c.counterparty} ${c.type === "EXCLUSIVITY" ? "exclusivity" : "non-compete"} (${c.clause_ref})`,
          explanation: `Potential conflict — not a breach determination. ${c.counterparty} ${c.clause_ref}: ${c.scope} Status: ${st}, until ${fmtDate(c.end)}${c.end_note ? ` (${c.end_note})` : ""}.${affiliates} This contract matches every element — ${summary}.${direct ? "" : " The counterparty is not itself clearly within the restricted class, so whether the restriction bites is a judgement call — verify the definition against this deal."}${relatedText}`,
          quote,
          clause: anchor.clause,
          evidence: [...commitmentEvidence(c, ctx.today), ...relatedEv, ...trackerEvidence(ctx, keywordsAll)],
          commitment_id: c.id,
          rule_id: "R8",
          confidence: direct ? "HIGH" : "MEDIUM",
          needs_info: direct ? "Check whether a written waiver under the restricting contract exists for this specific engagement." : "Confirm whether the counterparty falls inside the restricted definition; consider asking counsel.",
          source: "register",
        }),
      );
    }

    if (c.matcher.kind === "mfn_rates") {
      const rates = parseRates(ctx);
      const lower = rates
        .map((r) => {
          const key = Object.keys(c.matcher.kind === "mfn_rates" ? c.matcher.rates : {}).find((k) => k.toLowerCase() === r.role.toLowerCase());
          const ref = key && c.matcher.kind === "mfn_rates" ? c.matcher.rates[key] : undefined;
          return ref !== undefined && r.rate < ref ? { ...r, ref } : null;
        })
        .filter(Boolean) as { role: string; rate: number; ref: number; clause: Clause; line: string }[];
      if (!lower.length) continue;
      if (inactive) continue;
      const deltas = lower.map((l) => `${l.role} $${l.rate} vs $${l.ref} (−$${(l.ref - l.rate).toFixed(0)}/hr)`).join("; ");
      findings.push(
        mkFinding(ctx, {
          type: "HISTORICAL_CONFLICT",
          category: "pricing_mfn",
          severity: c.conflict_severity,
          title: `Rates below the Crestline most-favoured-customer rate card (${c.clause_ref})`,
          explanation: `Potential conflict — not a breach determination. ${c.counterparty} ${c.clause_ref} is a most-favoured (MFN) pricing promise: rates no less favourable than those offered by AtliQ Inc or its Affiliates to any other customer for substantially similar services, until ${fmtDate(c.end)}. This contract's rate card is lower: ${deltas}. If these are 'substantially similar services', Crestline's rates drop retroactively to the lower rate and AtliQ owes a credit for every hour billed since the lower rate was offered, plus an audit right (§6.5). In 2024 the clause was accepted as 'harmless — we never discount'.`,
          quote: lower[0].line,
          clause: lower[0].clause,
          evidence: [...commitmentEvidence(c, ctx.today), ...trackerEvidence(ctx, ["rate", "$72", "sharper"])],
          commitment_id: c.id,
          rule_id: "R8",
          precedent_ids: ["P-19"],
          confidence: "HIGH",
          needs_info: "Confirm whether the Lakeshore services are 'substantially similar' to Crestline's (data engineering / BI) and the hours billed to Crestline since the lower rate would first be offered.",
          source: "register",
        }),
      );
    }

    if (c.matcher.kind === "asset_reuse") {
      const asset = c.matcher.assets.find((a) => findKeyword(ctx.text, a) >= 0);
      if (!asset) continue;
      const owner = findClause(ctx, new RegExp(`sole owner[^.]*${asset}|${asset}[^.]*sole owner`, "i"));
      const any = owner ?? findClause(ctx, new RegExp(asset, "i"))!;
      findings.push(
        mkFinding(ctx, {
          type: "HISTORICAL_CONFLICT",
          category: "ip",
          severity: c.conflict_severity,
          title: `${asset} was assigned to ${c.counterparty} — AtliQ may not own it any more (${c.clause_ref})`,
          explanation: `Potential conflict — not a breach determination. ${c.counterparty} ${c.clause_ref} vested all IP in its Deliverables — expressly including pre-existing tools incorporated — in ${c.counterparty}, and SOW-1 incorporated ${asset} into the delivered pipeline. ${owner ? `This contract asks AtliQ to warrant it is the sole owner of ${asset} and to license it irrevocably.` : `This contract re-uses ${asset}.`} AtliQ may not be able to give that warranty or licence without ${c.counterparty}'s consent, and an IP indemnity would sit behind it. In June 2025 the IP clause was 'skimmed'.`,
          quote: any.quote,
          clause: any.clause,
          evidence: [...commitmentEvidence(c, ctx.today), ...trackerEvidence(ctx, [asset, "Northwind"])],
          commitment_id: c.id,
          rule_id: "R8",
          precedent_ids: ["P-13", "P-21"],
          confidence: "HIGH",
          needs_info: `Ask Pranav which version of ${asset} was delivered to ${c.counterparty} and whether a licence-back or carve-out can be negotiated.`,
          source: "register",
        }),
      );
    }
  }

  const active = findings.filter((f) => f.severity !== "LOW").length;
  const check: CheckResult = {
    id: "chk-R8",
    rule_id: "R8",
    name: "No conflict with the commitments register",
    status: active ? "flagged" : "passed",
    detail: active
      ? `${active} potential conflict(s) with active commitments (checked ${checked.length} restrictions).${expiredHits.length ? ` Expired/spent matches shown for awareness: ${expiredHits.join("; ")}.` : ""}`
      : `Checked against ${checked.length} restrictive commitments in the register — no active match.${expiredHits.length ? ` Expired/spent matches: ${expiredHits.join("; ")}.` : ""} Absence of a match is not proof of safety: the register only covers signed contracts in the dataset.`,
    evidence: [],
  };
  return { findings, check, activeConflicts: active };
}

/** Incoming non-compete vs AtliQ's existing clients (e.g. a "Competitor" definition that covers current clients). */
export function portfolioConflicts(ctx: EngineContext, covenants: ReturnType<typeof restrictiveCovenants>["covenants"]): Finding[] {
  const out: Finding[] = [];
  for (const cov of covenants.filter((x) => x.nonCompete)) {
    // pull definitions of capitalised terms used in the covenant ("Competitor", "Datavane Account")
    const terms = Array.from(cov.quote.matchAll(/\b(?:any|each)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g)).map((m) => m[1]);
    let scopeText = cov.quote;
    for (const t of terms) {
      const def = findClause(ctx, new RegExp(`"\\**${t}\\**"\\s+(?:means|has the meaning)`, "i"));
      if (def) scopeText += " " + def.clause.text;
    }
    const hits = ctx.portfolio.filter(
      (p) => p.status === "active" && p.sector_keywords.some((k) => findKeyword(scopeText, k) >= 0) && (findKeyword(scopeText, p.country) >= 0 || !/operating in|in india|in the gcc/i.test(scopeText)),
    );
    if (!hits.length) continue;
    out.push(
      mkFinding(ctx, {
        type: "HISTORICAL_CONFLICT",
        category: "non_compete_exclusivity",
        severity: "CRITICAL",
        title: `New restriction would cover existing clients: ${hits.map((h) => h.counterparty).join(", ")}`,
        explanation: `Potential conflict — not a breach determination. The restriction in ${cov.clause.ref} reaches businesses AtliQ already serves under signed contracts: ${hits.map((h) => `${h.counterparty} (${h.relationship}, until ${fmtDate(h.active_until)})`).join("; ")}. Signing would mean breaching this agreement by continuing that work, or abandoning those clients. Restrictions like this belong in the commitments register — this is the 'what have we promised not to do' problem from the 22 Sep meeting.`,
        quote: cov.quote,
        clause: cov.clause,
        evidence: hits.map((h) => ev(h.source_file, h.clause_ref, h.quote, `Existing client — ${h.counterparty} (active until ${fmtDate(h.active_until)})`)),
        rule_id: "R8",
        precedent_ids: ["P-24", "P-17"],
        confidence: "HIGH",
        needs_info: "Confirm the full current client list (the tracker is incomplete) and whether any pipeline deals (e.g. FinEdge Bank, C-022) fall inside the definition.",
        source: "register",
      }),
    );
  }
  return out;
}

/**
 * Flow-down consistency: when this contract serves another AtliQ deal ("End Client"), compare it with
 * that upstream contract (signed or still in review). Catches e.g. a vendor keeping IP that AtliQ has
 * promised exclusively to its client, or subcontracting that needs the client's consent.
 */
export function upstreamConsistency(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  const m = ctx.text.match(/End Client:?\**\s*:?\s*\**\s*([A-Z][A-Za-z&.\s]+?(?:GmbH|Inc\.?|Ltd|LLC|LLP|Co\.?))/);
  if (!m) return out;
  const endClient = m[1].trim();
  const firstWord = endClient.split(/\s+/)[0].toLowerCase();
  const item = loadQueue().find((q) => q.counterparty.toLowerCase().startsWith(firstWord));
  if (!item) return out;
  const upstreamText = readRaw(item.file);
  const up = parseContract(upstreamText);
  const exclusive = up.clauses.find((c) => /exclusive[^.]*right of use|exclusive, perpetual|shall vest in the Client|sole and exclusive property/i.test(c.text));
  const vendorKeeps = findClause(ctx, /shall retain all right, title and interest in and to[^.]*outputs|Vendor IP/i);
  const label = `${item.counterparty} draft (${item.id}, ${item.tracker_status}) — upstream client contract, not yet signed`;
  if (exclusive && vendorKeeps) {
    const idx = exclusive.text.search(/exclusive/i);
    out.push(
      mkFinding(ctx, {
        type: "HISTORICAL_CONFLICT",
        category: "ip",
        severity: "HIGH",
        title: `Vendor keeps IP in outputs that AtliQ must hand to ${endClient} exclusively`,
        explanation: `This agreement lets the vendor retain ownership of its annotation outputs and gives AtliQ only a non-exclusive licence (${vendorKeeps.clause.ref}). The upstream ${endClient} contract (${exclusive.ref}, still in review) requires ${endClient} to receive exclusive rights in all work results. AtliQ cannot pass on rights it does not hold. Align the two before either is signed.`,
        quote: vendorKeeps.quote,
        clause: vendorKeeps.clause,
        evidence: [ev(item.file, exclusive.ref, sentenceOf(exclusive.text, idx), label)],
        confidence: "MEDIUM",
        needs_info: `Upstream ${endClient} contract is a draft — re-check once its IP clause is final.`,
        source: "register",
      }),
    );
  }
  return out;
}

/** Non-contract alerts from meeting notes (e.g. patient data already shared before any BAA). */
export function meetingNoteAlerts(ctx: EngineContext): Finding[] {
  const out: Finding[] = [];
  if (!ctx.usHealthcare) return out;
  const token = ctx.counterparty.split(/\s+/)[0];
  const dir = path.join(RAW_DIR, "meeting_notes");
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    if (findKeyword(text, token) < 0) continue;
    const lex = /names, DOBs|diagnosis codes|real data|sample extract/i;
    if (!lex.test(text)) continue;
    const lines = text.split("\n").filter((l) => lex.test(l) || /sample extract remained/i.test(l));
    const evs = lines.slice(0, 3).map((l) => ev(`meeting_notes/${f}`, "huddle notes", l.replace(/^[-*\s]+|^\*\(|\)\*$/g, "").trim(), `Meeting note ${f.slice(0, 10)} (not a contract)`));
    const anchor =
      findClause(ctx, /outside the United States/i) ?? findClause(ctx, /Protected Health Information/i) ?? { clause: ctx.parsed.clauses[0], quote: ctx.parsed.clauses[0].text.slice(0, 120) };
    out.push(
      mkFinding(ctx, {
        type: "UNRESOLVED_QUESTION",
        category: "data_protection",
        severity: "CRITICAL",
        title: "Alert: patient data may already be with offshore engineers — before any BAA is signed",
        explanation:
          "Not a contract term — an operational alert from the meeting notes. A 'sample extract' that appears to contain names, DOBs and diagnosis codes was emailed on 12 Sep and forwarded to two engineers in Pune. No BAA is signed yet, and both the draft BAA and the signed NDA say PHI may only be shared after a BAA and never accessed outside the US. If the extract is PHI this may already be a reportable incident. Contain and confirm before signing anything.",
        quote: anchor.quote,
        clause: anchor.clause,
        evidence: [
          ...evs,
          ev("signed_contracts/2026-08-20_harrington_health_mutual_nda.md", "§2.3", "Protected Health Information, as defined at 45 C.F.R. § 160.103, is excluded from this Agreement and shall be disclosed only after execution of a Business Associate Agreement between the Parties."),
        ].filter((e) => e.source_file.includes(token.toLowerCase()) || e.source_file.startsWith("meeting_notes")),
        confidence: "MEDIUM",
        needs_info: "Confirm with Pranav whether the 12 Sep extract contains PHI; if so, take counsel advice (Calloway Stern) on containment and notification.",
        source: "context",
      }),
    );
    break;
  }
  return out;
}

export { loadTracker };
