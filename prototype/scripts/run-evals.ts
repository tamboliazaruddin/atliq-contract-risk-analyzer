import "./env";
import fs from "node:fs";
import path from "node:path";
import { loadQueue, loadReview, loadTracker, readRaw } from "../src/lib/data";
import { ReviewInputError, runReview } from "../src/lib/review";
import type { Finding, ReviewResult, Severity } from "../src/lib/types";

/**
 * Release-gate evals (PRD §11). Uses the pre-generated reviews by default; `--live` re-runs every
 * review (with the configured LLM) and also measures processing time. Never edit the golden set
 * to make a gate pass — improve the engine instead.
 */

interface MustFlag {
  category: string;
  severity: Severity;
  keywords: string[];
  evidence_file?: string;
  note?: string;
}
interface Case {
  id: string;
  file: string;
  brief_case: string;
  in_scope: boolean;
  must_flag?: MustFlag[];
  must_not_flag?: string[];
  context_alert?: string;
}

const RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const TYPE_MAP: Record<string, string> = {
  CONFLICT_WITH_COMMITMENT: "HISTORICAL_CONFLICT",
  MISSING_DOCUMENT: "DOCUMENT_GAP",
  ENTITY_LAW_MISMATCH: "POTENTIAL_RISK",
  ONE_SIDED_TERM: "POTENTIAL_RISK",
  PRECEDENT_DEVIATION: "POTENTIAL_RISK",
  FAIRNESS_AS_BUYER: "POTENTIAL_RISK",
};

function haystack(f: Finding): string {
  return [f.title, f.explanation, f.contract_quote, f.contract_clause_ref, f.needs_info ?? "", ...f.evidence.flatMap((e) => [e.quote, e.source_file, e.label ?? ""])].join(" \n ").toLowerCase();
}

function matchScore(f: Finding, m: MustFlag): number {
  const h = haystack(f);
  const hits = m.keywords.filter((k) => h.includes(k.toLowerCase())).length;
  const need = Math.min(2, Math.max(1, Math.ceil(m.keywords.length / 2)));
  if (hits < need) return 0;
  if (m.evidence_file && !f.evidence.some((e) => e.source_file.endsWith(m.evidence_file!.replace(/^.*\//, "")) || e.source_file.includes(m.evidence_file!))) {
    if (!h.includes(m.evidence_file.toLowerCase())) return 0;
  }
  return hits + (f.severity === m.severity ? 0.5 : 0);
}

async function main() {
  const live = process.argv.includes("--live");
  const golden = JSON.parse(fs.readFileSync("evals/golden_cases.json", "utf8")) as { cases: Case[] };
  const queue = loadQueue();
  const tracker = loadTracker();
  const reviews = new Map<string, ReviewResult>();
  const times: number[] = [];

  for (const c of golden.cases) {
    const item = queue.find((q) => `data/raw/${q.file}` === c.file);
    if (!item) {
      console.warn(`No queue item for ${c.file}`);
      continue;
    }
    let r: ReviewResult | null = null;
    if (live) {
      const t = Date.now();
      r = await runReview({ text: readRaw(item.file), fileName: item.file_name, contractId: item.id, fileRel: item.file, tracker: tracker.find((x) => x.contract_id === item.id) ?? null });
      times.push(Date.now() - t);
    } else {
      r = loadReview(item.id);
      if (r) times.push(r.processing_ms);
    }
    if (r) reviews.set(c.id, r);
  }

  const rows: { case: string; expected: string; found: string; ok: boolean; sevOk: boolean; critical: boolean }[] = [];
  let mustTotal = 0,
    mustFound = 0,
    conflictTotal = 0,
    conflictFound = 0,
    sevAgree = 0,
    criticalMiss = 0,
    fpChecks = 0,
    fp = 0;
  const fpDetail: string[] = [];
  const controls: { id: string; ok: boolean; detail: string }[] = [];

  for (const c of golden.cases) {
    const r = reviews.get(c.id);
    if (!r) continue;
    if (!c.in_scope) {
      controls.push({ id: c.id, ok: !r.in_scope, detail: r.in_scope ? "reviewed as in scope" : "labelled out of MVP scope" });
      continue;
    }
    const used = new Set<string>();
    for (const m of c.must_flag ?? []) {
      mustTotal++;
      const isConflict = m.category === "CONFLICT_WITH_COMMITMENT";
      if (isConflict) conflictTotal++;
      const best = r.findings
        .filter((f) => !used.has(f.id))
        .map((f) => ({ f, s: matchScore(f, m) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || RANK[b.f.severity] - RANK[a.f.severity])[0];
      const found = !!best;
      if (found) {
        used.add(best.f.id);
        mustFound++;
        if (isConflict) conflictFound++;
      }
      const sevOk = found && best.f.severity === m.severity;
      if (sevOk) sevAgree++;
      const crit = m.severity === "CRITICAL" && (!found || RANK[best.f.severity] < RANK.CRITICAL);
      if (crit) criticalMiss++;
      rows.push({
        case: c.id,
        expected: `${m.severity.padEnd(8)} ${TYPE_MAP[m.category] ?? m.category} [${m.keywords.slice(0, 3).join(", ")}]`,
        found: found ? `${best.f.severity.padEnd(8)} ${best.f.title.slice(0, 70)}` : "— MISSED —",
        ok: found,
        sevOk,
        critical: crit,
      });
    }
    for (const k of c.must_not_flag ?? []) {
      fpChecks++;
      let bad: Finding[];
      if (k === "CRITICAL" || k === "HIGH") bad = r.findings.filter((f) => f.severity === k);
      else bad = r.findings.filter((f) => f.severity === "CRITICAL" && (f.title + " " + f.contract_quote).toLowerCase().includes(k.toLowerCase()));
      if (bad.length) {
        fp++;
        fpDetail.push(`${c.id}: "${k}" → ${bad.map((b) => `${b.severity} ${b.title}`).join("; ")}`);
      }
    }
    if (/clean contract/.test(c.brief_case)) {
      const hi = r.findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");
      controls.push({ id: c.id, ok: hi.length === 0, detail: hi.length ? `${hi.length} Critical/High finding(s)` : "no Critical/High findings" });
    }
    if (c.context_alert) {
      const alert = r.findings.some((f) => f.source === "context");
      controls.push({ id: `${c.id} (context alert)`, ok: alert, detail: alert ? "PHI alert from meeting notes surfaced" : "meeting-note alert missing" });
    }
  }

  // evidence accuracy across all in-scope reviews
  const allFindings = Array.from(reviews.values()).filter((r) => r.in_scope).flatMap((r) => r.findings);
  const grounded = allFindings.filter((f) => f.grounded).length;

  // completeness & uncertainty handling: incomplete reviews must say so; failure states must refuse
  const uncertainty: { test: string; ok: boolean }[] = [];
  for (const [id, r] of reviews) {
    if (!r.in_scope) continue;
    uncertainty.push({ test: `${id}: completeness label matches AI status (${r.ai.status})`, ok: r.ai.status === "completed" ? true : r.completeness === "incomplete" });
    uncertainty.push({ test: `${id}: every check has an explicit status`, ok: r.checks.every((c) => ["passed", "flagged", "could_not_verify", "not_applicable"].includes(c.status)) });
    uncertainty.push({ test: `${id}: every clause has a coverage status`, ok: r.coverage.length > 0 && r.coverage.every((c) => !!c.status) });
    uncertainty.push({ test: `${id}: unverified findings never shown as verified`, ok: r.findings.every((f) => f.grounded || f.finding_type === "UNRESOLVED_QUESTION" || f.source !== "llm") });
  }
  for (const [name, text] of [
    ["empty file", ""],
    ["image-only PDF (no text)", "   \n\n  "],
    ["not a contract", "Hi Karandeep, please see the attached. Thanks, Jay. ".repeat(10)],
    ["garbled extraction", "%%$#@!~~ 0x00 ¤¤¤ ### ".repeat(40)],
  ] as const) {
    try {
      await runReview({ text, fileName: name, contractId: "eval", useLlm: false });
      uncertainty.push({ test: `State 2 refuses: ${name}`, ok: false });
    } catch (e) {
      uncertainty.push({ test: `State 2 refuses: ${name}`, ok: e instanceof ReviewInputError });
    }
  }

  // synthetic generalisation cases (data/synthetic) — reviewed fresh each run
  const synth: { id: string; ok: boolean; detail: string }[] = [];
  if (fs.existsSync("evals/synthetic_cases.json")) {
    const sc = JSON.parse(fs.readFileSync("evals/synthetic_cases.json", "utf8")) as { cases: (Case & { country?: string })[] };
    for (const c of sc.cases) {
      const r = await runReview({ text: fs.readFileSync(c.file, "utf8"), fileName: path.basename(c.file), contractId: `U-${c.id}`, useLlm: live });
      const misses = (c.must_flag ?? []).filter((m) => !r.findings.some((f) => matchScore(f, m) > 0 && RANK[f.severity] >= RANK[m.severity]));
      const fps = (c.must_not_flag ?? []).filter((k) =>
        k === "CRITICAL" || k === "HIGH" ? r.findings.some((f) => f.severity === k) : r.findings.some((f) => (f.severity === "CRITICAL" || f.severity === "HIGH") && haystack(f).includes(k.toLowerCase())),
      );
      synth.push({ id: c.id, ok: !misses.length && !fps.length, detail: misses.length ? `missed: ${misses.map((m) => m.keywords[0]).join(", ")}` : fps.length ? `false alarm: ${fps.join(", ")}` : c.brief_case });
    }
  }

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 100);
  const maxTime = Math.max(0, ...times);
  const gates = [
    { gate: "1. Material-risk recall", value: `${pct(mustFound, mustTotal)}% (${mustFound}/${mustTotal})`, target: "≥ 90%", pass: pct(mustFound, mustTotal) >= 90 },
    { gate: "   Critical-risk misses", value: String(criticalMiss), target: "0", pass: criticalMiss === 0 },
    { gate: "2. Evidence accuracy (grounded findings)", value: `${pct(grounded, allFindings.length)}% (${grounded}/${allFindings.length})`, target: "≥ 95%", pass: pct(grounded, allFindings.length) >= 95 },
    { gate: "3. Severity agreement with labels", value: `${pct(sevAgree, mustFound)}% (${sevAgree}/${mustFound})`, target: "≥ 85%", pass: pct(sevAgree, mustFound) >= 85 },
    { gate: "4. Historical-conflict recall", value: `${pct(conflictFound, conflictTotal)}% (${conflictFound}/${conflictTotal})`, target: "≥ 90%", pass: pct(conflictFound, conflictTotal) >= 90 },
    { gate: "5. False positives on must-not-flag", value: `${pct(fp, fpChecks)}% (${fp}/${fpChecks})`, target: "≤ 20%", pass: pct(fp, fpChecks) <= 20 },
    { gate: "   Clean controls / scope / alerts", value: `${controls.filter((c) => c.ok).length}/${controls.length}`, target: "all", pass: controls.every((c) => c.ok) },
    { gate: "6. Completeness & uncertainty handling", value: `${pct(uncertainty.filter((u) => u.ok).length, uncertainty.length)}% (${uncertainty.filter((u) => u.ok).length}/${uncertainty.length})`, target: "≥ 95%", pass: pct(uncertainty.filter((u) => u.ok).length, uncertainty.length) >= 95 },
    { gate: "7. Processing time (max per contract)", value: `${(maxTime / 1000).toFixed(1)}s`, target: "< 300s", pass: maxTime < 300_000 },
    { gate: "   Synthetic generalisation cases", value: `${synth.filter((s) => s.ok).length}/${synth.length}`, target: "all", pass: synth.every((s) => s.ok) },
  ];

  const aiStatuses = Array.from(new Set(Array.from(reviews.values()).map((r) => `${r.ai.provider}/${r.ai.status}`)));
  console.log(`\nAtliQ Contract Risk Analyzer — release-gate evals (${live ? "live run" : "pre-generated reviews"}; AI: ${aiStatuses.join(", ")})\n`);
  console.log("Must-flag cases:");
  for (const r of rows) console.log(`  ${r.ok ? (r.sevOk ? "✓" : "~") : "✗"} ${r.case.padEnd(20)} ${r.expected.padEnd(70)} → ${r.found}`);
  console.log("\nControls:");
  for (const c of controls) console.log(`  ${c.ok ? "✓" : "✗"} ${c.id.padEnd(32)} ${c.detail}`);
  console.log("\nSynthetic cases (data/synthetic):");
  for (const s of synth) console.log(`  ${s.ok ? "✓" : "✗"} ${s.id.padEnd(32)} ${s.detail}`);
  if (fpDetail.length) console.log("\nFalse positives:\n  " + fpDetail.join("\n  "));
  const failedU = uncertainty.filter((u) => !u.ok);
  if (failedU.length) console.log("\nUncertainty-handling failures:\n  " + failedU.map((u) => u.test).join("\n  "));
  console.log("\nGate".padEnd(46) + "Result".padEnd(22) + "Target".padEnd(10) + "Status");
  for (const g of gates) console.log(`${g.gate.padEnd(45)} ${g.value.padEnd(21)} ${g.target.padEnd(9)} ${g.pass ? "PASS" : "FAIL"}`);
  console.log("\n✓ found with matching severity · ~ found, severity differs · ✗ missed\n");

  fs.writeFileSync(
    path.join("evals", "results.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), mode: live ? "live" : "pre-generated", ai: aiStatuses, gates, rows, controls, synthetic: synth, false_positives: fpDetail, uncertainty }, null, 2),
  );
  process.exit(gates.every((g) => g.pass) ? 0 : 1);
}
main();
