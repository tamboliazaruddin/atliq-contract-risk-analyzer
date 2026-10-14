import { clauseByRef, clauseForQuote, parseContract, type ParsedContract } from "./clauses";
import { datasetToday } from "./config";
import { bundleMembers, commitmentStatus, isOutOfScope, loadPrecedents, loadRegister } from "./data";
import {
  buildContext,
  detectContractType,
  detectCountry,
  detectCounterpartyName,
  detectCounterpartyTerm,
  detectAtliqTerm,
  detectEntity,
  detectRole,
  ev,
  type EngineContext,
  mkFinding,
  precedentIds,
  resetSeq,
  sourceText,
} from "./engine/context";
import { extractKeyTerms } from "./engine/keyterms";
import { runPatterns } from "./engine/patterns";
import { meetingNoteAlerts, portfolioConflicts, registerConflicts, upstreamConsistency } from "./engine/register";
import { runRules } from "./engine/rules";
import { attentionScore, counts, escalationHints, sortFindings } from "./engine/scoring";
import { LlmError, aiTimeBudgetMs, completeJson, estimateTokens, llmConfig, setLlmDeadline } from "./llm";
import { mask, unmask } from "./masking";
import { LlmReview, REVIEW_SYSTEM, buildReviewPrompt, type LlmFinding } from "./prompts/review";
import { retrieve } from "./retrieval";
import { clip, isGrounded, normalise, sha } from "./text";
import type { CheckResult, Clause, CoverageRow, Evidence, Finding, ReviewConfig, ReviewResult, StepTiming, TrackerRow } from "./types";

export const STEPS = [
  "Reading document",
  "Extracting terms",
  "Checking commitments register",
  "Comparing precedents",
  "Validating entity & documents",
  "AI clause analysis",
  "Verifying evidence",
] as const;
export type StepName = (typeof STEPS)[number];
export type Progress = (step: StepName, status: "start" | "done" | "failed" | "skipped", note?: string) => void;

export class ReviewInputError extends Error {}

export interface ReviewInput {
  text: string;
  fileName: string;
  contractId: string;
  fileRel?: string | null;
  tracker?: TrackerRow | null;
  config?: Partial<ReviewConfig>;
  version?: number;
  useLlm?: boolean;
  /** AI part of an earlier review of the same text, re-used instead of calling the model again. */
  cachedAi?: { ai: ReviewResult["ai"]; summary: string; findings: Finding[]; coverage: CoverageRow[]; generated_at: string };
}

const COUNTRY_FROM_TRACKER = (c: string) => (c ? c.replace(/\?$/, "") : "");

/** Auto-detected review setup (UI_REFERENCE §2); the reviewer can edit every field before running. */
export function autoConfig(text: string, tracker?: TrackerRow | null): ReviewConfig & { counterparty: string; title: string } {
  const parsed = parseContract(text);
  const contract_type = detectContractType(parsed.title, parsed.body);
  const entity = detectEntity(parsed);
  const atliqTerm = detectAtliqTerm(parsed);
  const cpTerm = detectCounterpartyTerm(parsed);
  const country = COUNTRY_FROM_TRACKER(tracker?.client_country ?? "") || detectCountry(parsed);
  return {
    title: parsed.title,
    counterparty: tracker?.counterparty ?? detectCounterpartyName(parsed),
    contract_type,
    atliq_entity: entity,
    atliq_role: detectRole(contract_type, atliqTerm, cpTerm),
    counterparty_country: country,
    checks: { clause_risks: true, commitments: true, precedents: true, entity_law: true, required_documents: true, nda_mutuality: true },
    deal_context: tracker?.notes ?? "",
  };
}

function validateText(text: string, fileName: string): ParsedContract {
  const clean = text.replace(/\u0000/g, "").trim();
  if (clean.length < 300) throw new ReviewInputError(`Could not read enough text from "${fileName}" (${clean.length} characters). Upload a supported, text-based PDF, DOCX or Markdown file — scanned images and password-protected files are not supported.`);
  const parsed = parseContract(clean);
  if (parsed.clauses.length < 3) throw new ReviewInputError(`"${fileName}" does not look like a contract (no clauses found). Upload the contract text in a supported format.`);
  const letters = (clean.match(/[A-Za-z]/g) ?? []).length / clean.length;
  if (letters < 0.5) throw new ReviewInputError(`The text extracted from "${fileName}" looks garbled (possibly a scan or encrypted file). Upload a text-based version.`);
  return parsed;
}

function stableId(f: Finding): string {
  return "F-" + sha(`${f.category}|${f.contract_clause_id ?? f.contract_clause_ref}|${f.title}`).slice(0, 8);
}

// ---------------------------------------------------------------------------
// LLM layer
// ---------------------------------------------------------------------------

function contextBlocks(ctx: EngineContext, existing: Finding[]) {
  const today = ctx.today;
  const register = loadRegister();
  const matched = new Set(existing.map((f) => f.commitment_id).filter(Boolean));
  // compact context: the model has a small per-minute token budget on free tiers
  const commitments = register
    .filter((c) => matched.has(c.id) || (["NON_COMPETE", "EXCLUSIVITY", "MFN_PRICING", "IP_ASSIGNMENT", "NON_SOLICIT"].includes(c.type) && !["expired", "spent"].includes(commitmentStatus(c, today))))
    .slice(0, 6)
    .map((c) => `- ${c.counterparty} | ${c.source_file} ${c.clause_ref} | ${commitmentStatus(c, today)} until ${c.end ?? "open"} | ${clip(c.scope, 150)}`);
  const cats = new Set<string>(["liability", "indemnity", "payment", "liquidated_damages", "ip", "termination", ...existing.map((f) => f.category)]);
  const precedents = loadPrecedents()
    .filter((p) => cats.has(p.category) && p.counterparty !== "Karandeep's checklist")
    .slice(0, 12)
    .map((p) => `- [${p.category}] ${p.counterparty} ${p.date} (${p.tag.replace(/_/g, " ")}): ${clip(p.atliq_agreed, 90)}`);
  precedents.push("- Karandeep's checklist: liability 1x fees never unlimited; indemnity mutual; payment 30 days, 45 max; law India (Pvt Ltd) / US (Inc); client owns bespoke deliverables, AtliQ keeps its tools; termination pays for work done; NDAs only if mutual.");
  const query = ctx.parsed.clauses
    .filter((c) => /recital|background|scope|services|parties|preamble|purpose/i.test(c.heading))
    .map((c) => c.text)
    .join(" ")
    .slice(0, 3000);
  const retrieved = retrieve(`${ctx.counterparty} ${query}`, 6);
  const history = retrieved.slice(0, 2).map((r) => `- ${r.source_file} ${r.clause_ref} [${r.doc_status}]: "${clip(r.text, 200)}"`);
  return { commitments, precedents, history, retrieved };
}

async function llmReview(
  ctx: EngineContext,
  existing: Finding[],
  checks: CheckResult[],
  onNote: (n: string) => void,
): Promise<{ status: "completed" | "partial" | "failed" | "not_run"; note?: string; summary: string; findings: LlmFinding[]; reviewed: Set<string>; failedClauses: Set<string>; model: string; provider: string }> {
  const cfg = llmConfig();
  const empty = { summary: "", findings: [] as LlmFinding[], reviewed: new Set<string>(), failedClauses: new Set<string>(), model: cfg.model, provider: cfg.provider };
  if (cfg.provider === "none") return { ...empty, status: "not_run", note: "No LLM API key configured — deterministic checks only." };

  const { commitments, precedents, history } = contextBlocks(ctx, existing);
  const { text: maskedDeal, map: dealMap } = mask(ctx.config.deal_context || "");
  const already = [
    ...existing.map((f) => `${f.contract_clause_ref}: ${f.title}`),
    // facts already settled by the rule engine — the model should not re-raise them as risks
    ...checks.filter((c) => c.status === "passed").map((c) => `SETTLED (check passed): ${c.name} — ${clip(c.detail, 120)}`),
    // companion documents of the same deal live in separate files
    ...(ctx.tracker ? bundleMembers(ctx.counterparty).filter((m) => m.contract_id !== ctx.tracker!.contract_id).map((m) => `RELATED DOCUMENT IN THIS DEAL (separate file, not missing): ${m.doc_type} — ${m.status} (${m.contract_id})`) : []),
  ];
  const clauseLines = ctx.parsed.clauses.map((c) => {
    const m = mask(c.text);
    return { clause: c, line: `[${c.ref}] ${m.text.replace(/\*\*/g, "")}`, map: m.map };
  });
  const maps = Object.assign({}, dealMap, ...clauseLines.map((c) => c.map));
  const outline = outlineOf(ctx.parsed.clauses);

  const base = buildReviewPrompt({
    title: ctx.parsed.title,
    counterparty: ctx.counterparty,
    role: ctx.config.atliq_role,
    entity: ctx.config.atliq_entity,
    contractType: ctx.config.contract_type,
    country: ctx.config.counterparty_country,
    dealContext: maskedDeal,
    alreadyFlagged: already,
    commitments,
    precedents,
    history,
    contractBlock: "",
    outline,
    chunkNote: "",
    wantSummary: true,
  });
  const OUTPUT_TOKENS = cfg.provider === "groq" ? 2800 : 4000;
  const overhead = estimateTokens(REVIEW_SYSTEM + base) + 150;
  const budget = Math.max(1200, cfg.maxInputTokens - overhead);

  // chunk clauses to fit the model budget
  const chunks: (typeof clauseLines)[] = [];
  let cur: typeof clauseLines = [];
  let size = 0;
  for (const cl of clauseLines) {
    const t = estimateTokens(cl.line);
    if (cur.length && size + t > budget) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(cl);
    size += t;
  }
  if (cur.length) chunks.push(cur);

  const findings: LlmFinding[] = [];
  const reviewed = new Set<string>();
  const failedClauses = new Set<string>();
  let summary = "";
  let failures = 0;
  let model = cfg.model;
  let provider: string = cfg.provider;
  let fatal: string | undefined;

  const runChunk = async (chunk: typeof clauseLines, idx: number, total: number, depth = 0): Promise<void> => {
    const prompt = buildReviewPrompt({
      title: ctx.parsed.title,
      counterparty: ctx.counterparty,
      role: ctx.config.atliq_role,
      entity: ctx.config.atliq_entity,
      contractType: ctx.config.contract_type,
      country: ctx.config.counterparty_country,
      dealContext: maskedDeal,
      alreadyFlagged: already,
      commitments,
      precedents: depth > 0 ? precedents.slice(0, 14) : precedents,
      history: depth > 0 ? history.slice(0, 2) : history,
      contractBlock: chunk.map((c) => c.line).join("\n"),
      outline,
      chunkNote: total > 1 ? `This is part ${idx + 1} of ${total} of the contract; review only the clauses shown.` : "",
      wantSummary: idx === 0 && depth === 0,
    });
    try {
      const res = await completeJson(REVIEW_SYSTEM, prompt, LlmReview, OUTPUT_TOKENS);
      model = res.model;
      provider = res.provider;
      if (res.data.summary && !summary) summary = unmask(res.data.summary, maps);
      for (const f of res.data.findings) findings.push({ ...f, title: unmask(f.title, maps), explanation: unmask(f.explanation, maps), contract_quote: unmask(f.contract_quote, maps) });
      // every clause sent to the model in a successful call counts as AI-reviewed
      chunk.forEach((c) => reviewed.add(c.clause.id));
    } catch (e) {
      if (e instanceof LlmError && e.kind === "too_large" && chunk.length > 1 && depth < 3) {
        const mid = Math.ceil(chunk.length / 2);
        await runChunk(chunk.slice(0, mid), idx, total, depth + 1);
        await runChunk(chunk.slice(mid), idx, total, depth + 1);
        return;
      }
      failures++;
      chunk.forEach((c) => failedClauses.add(c.clause.id));
      const msg = e instanceof Error ? e.message : String(e);
      onNote(`AI analysis failed for part ${idx + 1}: ${msg}`);
      if (e instanceof LlmError && (e.kind === "auth" || e.kind === "not_configured")) fatal = msg;
    }
  };

  const timeBudget = aiTimeBudgetMs();
  const stopAt = timeBudget ? Date.now() + timeBudget : 0;
  setLlmDeadline(stopAt);
  let timedOut = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (fatal) {
      chunks[i].forEach((c) => failedClauses.add(c.clause.id));
      continue;
    }
    // hosting time limit: stop starting new AI calls, report the rest as "Not analysed"
    if (stopAt && Date.now() > stopAt - 12_000) {
      chunks[i].forEach((c) => failedClauses.add(c.clause.id));
      timedOut++;
      failures++;
      continue;
    }
    onNote(`AI reviewing part ${i + 1} of ${chunks.length}`);
    await runChunk(chunks[i], i, chunks.length);
  }
  setLlmDeadline(0);
  if (timedOut) onNote(`${timedOut} part(s) skipped — hosting time limit reached`);
  const status = fatal || failures === chunks.length ? "failed" : failures ? "partial" : "completed";
  return {
    status,
    note: fatal ?? (failures ? `${failures} of ${chunks.length} part(s) could not be analysed by the AI — those clauses are marked "Not analysed".` : `${chunks.length} part(s) analysed.`),
    summary,
    findings,
    reviewed,
    failedClauses,
    model,
    provider,
  };
}

/** Compact outline of every section and its clause refs, so a model seeing one chunk knows what exists elsewhere. */
function outlineOf(clauses: Clause[]): string {
  const bySection = new Map<string, string[]>();
  clauses.forEach((c) => bySection.set(c.heading, [...(bySection.get(c.heading) ?? []), c.ref]));
  return Array.from(bySection.entries())
    .map(([h, refs]) => `- ${clip(h, 60)}: ${refs.slice(0, 8).join(", ")}${refs.length > 8 ? ", …" : ""}`)
    .join("\n");
}

const SECTION_HINT: Partial<Record<string, RegExp>> = {
  ip: /intellectual property|rights of use|ownership/i,
  data_protection: /data protection|privacy|data security|personal data/i,
  liability: /liabilit/i,
  indemnity: /indemn/i,
  termination: /terminat/i,
  payment: /payment|fees|remuneration|charges/i,
  insurance: /insurance/i,
  governing_law_entity: /governing law|jurisdiction|disputes/i,
  liquidated_damages: /delay|liquidated|penalt/i,
};

/** Guardrail: drop "X is missing" claims when the contract has a section for X (chunk-blindness artefact). */
function claimsMissingButPresent(f: LlmFinding, clauses: Clause[]): boolean {
  if (!/\b(missing|lacks?|absent|no (?:\w+ ){0,3}(?:clause|provision|obligation|terms?)|does not (?:specify|address|include|contain))\b/i.test(`${f.title} ${f.explanation}`)) return false;
  const hint = SECTION_HINT[f.category];
  return !!hint && clauses.some((c) => hint.test(c.heading));
}

function toFinding(ctx: EngineContext, f: LlmFinding): Finding {
  const ref = f.clause_ref.replace(/[[\]]/g, "").trim();
  const clause: Clause | null = clauseByRef(ctx.parsed.clauses, ref) ?? (f.contract_quote ? clauseForQuote(ctx.parsed.clauses, f.contract_quote, normalise) : null);
  const quoteGrounded = isGrounded(f.contract_quote, ctx.text);
  const evidence: Evidence[] = f.evidence.map((e) => {
    const file = e.source_file.replace(/^data\/raw\//, "").trim();
    const src = sourceText(file);
    if (!src) return { source_file: file, clause_ref: e.clause_ref, quote: e.quote, doc_status: "reference_data", grounded: false, label: "Source not found in dataset" };
    return ev(file, e.clause_ref, e.quote);
  });
  const grounded = quoteGrounded && evidence.every((e) => e.grounded);
  return {
    id: "",
    finding_type: grounded ? f.finding_type : "UNRESOLVED_QUESTION",
    category: f.category,
    // an AI claim whose quotes cannot be verified stays visible, but never drives Critical/High priority
    severity: grounded || f.severity === "LOW" || f.severity === "MEDIUM" ? f.severity : "MEDIUM",
    title: f.title,
    explanation: grounded ? f.explanation : `${f.explanation} — Note: the AI's quote or evidence could not be verified word-for-word in the source, so this is shown as unverified.`,
    contract_clause_ref: clause?.ref ?? (ref || "Not located"),
    contract_clause_id: clause?.id,
    contract_quote: f.contract_quote,
    contract_quote_grounded: quoteGrounded,
    evidence,
    precedent_ids: precedentIds(ctx, f.category).slice(0, 4),
    confidence: grounded ? f.confidence : "LOW",
    grounded,
    escalation_hints: [],
    source: "llm",
  };
}

function words(s: string): Set<string> {
  return new Set(normalise(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
}

function isDuplicate(a: Finding, existing: Finding[]): boolean {
  const wa = words(a.title);
  return existing.some((e) => {
    const we = words(e.title);
    const overlap = Array.from(wa).filter((w) => we.has(w)).length / Math.max(1, Math.min(wa.size, we.size));
    if (overlap >= (e.category === a.category ? 0.5 : 0.6)) return true;
    if (e.contract_clause_id && e.contract_clause_id === a.contract_clause_id && (e.category === a.category || e.severity === a.severity)) return true;
    const qa = normalise(a.contract_quote).slice(0, 80);
    return qa.length > 30 && normalise(e.contract_quote).includes(qa);
  });
}

// ---------------------------------------------------------------------------
// Orchestrator — PRD §9.3 steps 2–10
// ---------------------------------------------------------------------------

export async function runReview(input: ReviewInput, onProgress: Progress = () => {}): Promise<ReviewResult> {
  const t0 = Date.now();
  const timings: StepTiming[] = [];
  let stepStart = Date.now();
  const step = (name: StepName, status: StepTiming["status"], note?: string) => {
    timings.push({ step: name, status, ms: Date.now() - stepStart, note });
    onProgress(name, status === "done" ? "done" : status === "failed" ? "failed" : "skipped", note);
    stepStart = Date.now();
  };
  resetSeq();

  // 1. Read + validate (State 2 on failure — never a partial report)
  onProgress("Reading document", "start");
  const parsed = validateText(input.text, input.fileName);
  const auto = autoConfig(input.text, input.tracker);
  const config: ReviewConfig = { ...auto, ...input.config, checks: { ...auto.checks, ...(input.config?.checks ?? {}) } } as ReviewConfig;
  const counterparty = input.tracker?.counterparty ?? auto.counterparty;
  step("Reading document", "done", `${parsed.clauses.length} clauses`);

  const ctx = buildContext({ parsed, config, counterparty, tracker: input.tracker ?? null, fileRel: input.fileRel ?? null });
  const outOfScope = isOutOfScope(input.tracker?.doc_type ?? (config.contract_type === "Contractor" ? "Contractor Agreement" : ""), input.fileName);

  // 2. Key terms
  onProgress("Extracting terms", "start");
  const keyTerms = extractKeyTerms(ctx);
  step("Extracting terms", "done", `${keyTerms.filter((k) => k.status === "found").length}/${keyTerms.length} found`);

  const findings: Finding[] = [];
  const checks: CheckResult[] = [];

  if (outOfScope) {
    // Out of MVP scope: only fact checks (e.g. wrong entity), clearly labelled.
    for (const s of ["Checking commitments register", "Comparing precedents"] as StepName[]) step(s, "skipped", "Out of scope");
    onProgress("Validating entity & documents", "start");
    const rules = runRules(ctx, 0);
    checks.push(...rules.checks.filter((c) => c.rule_id === "R1"));
    findings.push(...rules.findings.filter((f) => f.rule_id === "R1"));
    step("Validating entity & documents", "done");
    step("AI clause analysis", "skipped", "Out of MVP scope");
    step("Verifying evidence", "done");
  } else {
    // 3. Commitments register + 4. precedents (patterns attach precedent history)
    onProgress("Checking commitments register", "start");
    const reg = registerConflicts(ctx);
    findings.push(...reg.findings);
    findings.push(...upstreamConsistency(ctx));
    findings.push(...meetingNoteAlerts(ctx));
    checks.push(reg.check);
    step("Checking commitments register", "done", `${reg.activeConflicts} potential conflict(s)`);

    onProgress("Comparing precedents", "start");
    const pat = runPatterns(ctx);
    findings.push(...pat.findings);
    findings.push(...portfolioConflicts(ctx, pat.covenants));
    // a warranty of "no conflicting restriction" becomes inaccurate when a conflict exists
    const warranty = ctx.parsed.clauses.find((c) => /not bound by any agreement or restriction|does not breach any other agreement/i.test(c.text));
    if (warranty && reg.activeConflicts > 0) {
      const m = warranty.text.match(/[^;.]*not bound by any agreement or restriction[^;.]*|[^;.]*does not breach any other agreement[^;.]*/i);
      const raw = m ? m[0] : warranty.text;
      const item = raw.match(/\(([a-z]{1,3})\)\s*[^()]*$/)?.[1];
      const q = raw.replace(/^[\s\S]*\([a-z]{1,3}\)\s*/, "").replace(/\*\*/g, "").trim();
      const wref = item ? `${warranty.ref}(${item})` : warranty.ref;
      findings.push(
        mkFinding(ctx, {
          type: "HISTORICAL_CONFLICT",
          category: "non_compete_exclusivity",
          severity: "HIGH",
          title: `Signing would make the warranty in ${wref} untrue`,
          explanation: `${wref} asks AtliQ to warrant that it is not bound by any agreement or restriction that would prevent or restrict the services. Given the potential conflict(s) with signed commitments flagged here, that warranty may be false on the day it is given — a separate breach, independent of the underlying restriction.`,
          quote: q,
          clause: warranty,
          evidence: findings.filter((f) => f.source === "register" && f.severity !== "LOW").flatMap((f) => f.evidence.slice(0, 1)),
          rule_id: "R8",
          confidence: "HIGH",
          source: "register",
        }),
      );
    }
    step("Comparing precedents", "done", `${pat.findings.length} clause pattern finding(s)`);

    // 5. Entity, law, required documents, NDA reciprocity, insurance, annexes
    onProgress("Validating entity & documents", "start");
    const rules = runRules(ctx, pat.findings.filter((f) => f.category === "insurance").length);
    findings.push(...rules.findings);
    checks.push(...rules.checks);
    step("Validating entity & documents", "done", `${rules.checks.filter((c) => c.status === "flagged").length} flagged`);
  }

  // 6. AI clause analysis
  let ai: ReviewResult["ai"] = { provider: "none", model: "none", status: "not_run", note: "Not run" };
  let aiSummary = "";
  let reviewed = new Set<string>();
  let failedClauses = new Set<string>();
  if (!outOfScope && input.cachedAi && input.cachedAi.ai.status !== "not_run") {
    // re-use AI output from a previous run of the same text (offline iteration on the deterministic engine)
    const c = input.cachedAi;
    ai = { ...c.ai, note: `${c.ai.note ?? ""} (AI output re-used from ${c.generated_at.slice(0, 10)})`.trim() };
    aiSummary = c.summary;
    c.coverage.forEach((row) => {
      if (row.status === "not_analysed") failedClauses.add(row.clause_id);
      else if (row.status !== "rule_scan_only") reviewed.add(row.clause_id);
    });
    let added = 0;
    for (const old of c.findings) {
      const f: Finding = { ...old, contract_quote_grounded: isGrounded(old.contract_quote, ctx.text) };
      if (!f.grounded && (f.severity === "CRITICAL" || f.severity === "HIGH")) f.severity = "MEDIUM";
      if (isDuplicate(f, findings)) continue;
      findings.push(f);
      added++;
    }
    step("AI clause analysis", "done", `${added} AI finding(s) re-used`);
  } else if (!outOfScope) {
    if (input.useLlm === false || !config.checks.clause_risks) {
      step("AI clause analysis", "skipped", "AI analysis switched off");
      ai = { provider: "none", model: "none", status: "not_run", note: "AI analysis switched off for this run — deterministic checks only." };
    } else {
      onProgress("AI clause analysis", "start");
      const notes: string[] = [];
      const res = await llmReview(ctx, findings, checks, (n) => {
        notes.push(n);
        onProgress("AI clause analysis", "start", n);
      });
      ai = { provider: res.provider, model: res.model, status: res.status, note: res.note };
      aiSummary = res.summary;
      reviewed = res.reviewed;
      failedClauses = res.failedClauses;
      let added = 0;
      const lawSettled = ["chk-R1", "chk-R3"].every((id) => checks.find((c) => c.id === id)?.status === "passed");
      const related = ctx.tracker ? bundleMembers(ctx.counterparty).filter((m) => m.contract_id !== ctx.tracker!.contract_id) : [];
      const relatedRe = related.length ? new RegExp(related.map((m) => (/BAA/.test(m.doc_type) ? "BAA|Business Associate|Exhibit D" : m.doc_type.replace(/[^A-Za-z ]/g, "").trim())).filter(Boolean).join("|"), "i") : null;
      const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
      const confRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
      const ranked = [...res.findings].sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || confRank[a.confidence] - confRank[b.confidence]);
      const MAX_AI = 10; // keep the brief focused: the most material AI additions only
      for (const lf of ranked) {
        if (added >= MAX_AI) break;
        if (claimsMissingButPresent(lf, ctx.parsed.clauses)) continue;
        // a companion document of the same deal is a separate file, not a missing one
        if (relatedRe && /\b(missing|not (?:attached|provided|supplied|included|finali[sz]ed)|absent)\b/i.test(`${lf.title} ${lf.explanation}`) && relatedRe.test(lf.title)) continue;
        if (lawSettled && lf.category === "governing_law_entity") continue; // settled by rules R1/R3
        if (lf.severity === "LOW" && lf.confidence !== "HIGH") continue; // keep the brief focused
        const f = toFinding(ctx, lf);
        if (isDuplicate(f, findings)) continue;
        findings.push(f);
        added++;
      }
      step("AI clause analysis", res.status === "failed" ? "failed" : res.status === "not_run" ? "skipped" : "done", res.status === "not_run" ? res.note : `${added} additional finding(s); ${res.note ?? ""}`);
    }
  }

  // 7. Verify evidence + assemble
  onProgress("Verifying evidence", "start");
  const clauseOrder = new Map(parsed.clauses.map((c, i) => [c.id, i]));
  const seen = new Set<string>();
  const final = sortFindings(findings, clauseOrder)
    .map((f) => {
      const g = isGrounded(f.contract_quote, ctx.text);
      const grounded = g && f.evidence.every((e) => e.grounded || e.doc_status === "reference_data" || e.doc_status === "tracker_note" || e.doc_status === "this_contract");
      const out: Finding = { ...f, contract_quote_grounded: g, grounded };
      // guardrail: an unsupported finding is never shown as verified
      if (!grounded && out.finding_type !== "UNRESOLVED_QUESTION" && out.source === "llm") out.finding_type = "UNRESOLVED_QUESTION";
      out.id = stableId(out);
      out.escalation_hints = escalationHints(out, { usHealthcare: ctx.usHealthcare, country: config.counterparty_country });
      return out;
    })
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));

  const ungrounded = final.filter((f) => !f.grounded).length;
  checks.push({
    id: "chk-grounding",
    name: "Every quoted clause and source verified word-for-word",
    status: ungrounded ? "flagged" : "passed",
    detail: ungrounded ? `${ungrounded} finding(s) contain a quote that could not be verified in the source — shown as "Not verified".` : `All ${final.length} findings' quotes were found verbatim in their sources.`,
    evidence: [],
  });
  const missingTerms = keyTerms.filter((k) => k.status !== "found");
  checks.push({
    id: "chk-keyterms",
    name: "Key contract fields extracted",
    status: missingTerms.length ? "could_not_verify" : "passed",
    detail: missingTerms.length ? `Not found or ambiguous: ${missingTerms.map((k) => k.label).join(", ")}.` : "All key fields found with clause references.",
    evidence: [],
  });
  if (!outOfScope) {
    checks.push({
      id: "chk-ai",
      name: "AI clause-by-clause analysis",
      status: ai.status === "completed" ? "passed" : "could_not_verify",
      detail:
        ai.status === "completed"
          ? `Completed with ${ai.provider} / ${ai.model}. ${ai.note ?? ""}`
          : ai.status === "partial"
            ? `Partially completed — ${ai.note}`
            : `${ai.note ?? "Not run."} Clause risks were checked by the deterministic pattern scan only; clauses without a pattern hit have not been read by the AI.`,
      evidence: [],
    });
  }

  // coverage table — every clause has an explicit status
  const byClause = new Map<string, string[]>();
  final.forEach((f) => f.contract_clause_id && byClause.set(f.contract_clause_id, [...(byClause.get(f.contract_clause_id) ?? []), f.id]));
  const coverage: CoverageRow[] = parsed.clauses.map((c) => ({
    clause_id: c.id,
    ref: c.ref,
    heading: c.heading,
    status: byClause.has(c.id) ? "flagged" : failedClauses.has(c.id) ? "not_analysed" : reviewed.has(c.id) ? "reviewed_no_issue" : outOfScope ? "not_analysed" : "rule_scan_only",
    finding_ids: byClause.get(c.id) ?? [],
  }));

  const notesList: string[] = [];
  if (outOfScope) notesList.push(outOfScope);
  if (ai.status !== "completed" && !outOfScope) notesList.push(`AI clause analysis ${ai.status.replace("_", " ")}: ${ai.note ?? ""}`.trim());
  checks.filter((c) => c.status === "could_not_verify").forEach((c) => notesList.push(`Could not verify — ${c.name}: ${c.detail}`));
  if (ungrounded) notesList.push(`${ungrounded} finding(s) not verified against the source.`);
  const complete = !outOfScope && ai.status === "completed" && !timings.some((t) => t.status === "failed");
  step("Verifying evidence", "done", `${final.length - ungrounded}/${final.length} grounded`);

  const c = counts(final);
  const det = `${counterparty} · ${config.contract_type} · ${config.atliq_entity === "inc" ? "AtliQ Inc" : config.atliq_entity === "pvt_ltd" ? "AtliQ Technologies Pvt Ltd" : "AtliQ entity unclear"} as ${config.atliq_role}. ${final.length} finding(s): ${c.CRITICAL} critical, ${c.HIGH} high, ${c.MEDIUM} medium, ${c.LOW} low; ${final.filter((f) => f.finding_type === "HISTORICAL_CONFLICT").length} potential conflict(s) with past commitments; ${checks.filter((x) => x.status === "could_not_verify").length} check(s) could not be verified.`;
  const processing = Date.now() - t0;
  const textHash = sha(input.text);
  return {
    review_id: `${input.contractId}-${textHash.slice(0, 8)}`,
    contract_id: input.contractId,
    file_name: input.fileName,
    title: parsed.title,
    counterparty,
    version: input.version ?? 1,
    text_hash: textHash,
    generated_at: new Date().toISOString(),
    dataset_today: datasetToday(),
    in_scope: !outOfScope,
    out_of_scope_reason: outOfScope ?? undefined,
    config,
    ai,
    completeness: complete ? "complete" : "incomplete",
    completeness_notes: notesList,
    summary: aiSummary ? `${aiSummary}\n\n${det}` : det,
    key_terms: keyTerms,
    findings: final,
    checks,
    coverage,
    retrieved: outOfScope ? [] : retrieve(`${counterparty} ${parsed.clauses.slice(0, 12).map((x) => x.text).join(" ").slice(0, 2500)}`, 8),
    attention_score: attentionScore(final, checks),
    counts: c,
    timings,
    processing_ms: processing,
  };
}

export { parseContract };
