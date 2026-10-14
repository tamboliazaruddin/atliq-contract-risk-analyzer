import "./env";
import fs from "node:fs";
import path from "node:path";
import { REVIEWS_DIR } from "../src/lib/config";
import { loadQueue, loadReview, loadTracker, readRaw } from "../src/lib/data";
import { sha } from "../src/lib/text";
import { llmConfig } from "../src/lib/llm";
import { runReview } from "../src/lib/review";

/**
 * Pre-generate reviews for every incoming dataset contract → data/derived/reviews/<id>.json.
 * The deployed demo reads these so dataset reviews open instantly; uploads are reviewed live.
 *   npm run review-all               (uses the configured LLM if a key is set)
 *   npm run review-all -- --no-ai    (deterministic engine only — marked incomplete)
 *   npm run review-all -- C-025      (one contract)
 *   npm run review-all -- --reuse-ai (re-run the rules engine, keep stored AI findings for unchanged text)
 */
async function main() {
  const args = process.argv.slice(2);
  const noAi = args.includes("--no-ai");
  const reuse = args.includes("--reuse-ai");
  const only = args.filter((a) => /^C-\d+$/.test(a));
  const cfg = llmConfig();
  console.log(`LLM: ${noAi ? "disabled (--no-ai)" : cfg.provider === "none" ? "none configured — deterministic only" : `${cfg.provider} / ${cfg.model}`}\n`);
  fs.mkdirSync(REVIEWS_DIR, { recursive: true });
  const tracker = loadTracker();
  const queue = loadQueue().filter((q) => !only.length || only.includes(q.id));
  for (const item of queue) {
    const row = tracker.find((r) => r.contract_id === item.id) ?? null;
    const t = Date.now();
    const text = readRaw(item.file);
    const old = reuse ? loadReview(item.id) : null;
    const cachedAi =
      old && old.text_hash === sha(text) && old.ai.status !== "not_run"
        ? { ai: old.ai, summary: old.summary.includes("\n\n") ? old.summary.split("\n\n")[0] : "", findings: old.findings.filter((f) => f.source === "llm"), coverage: old.coverage, generated_at: old.generated_at }
        : undefined;
    try {
      const r = await runReview(
        { text, fileName: item.file_name, contractId: item.id, fileRel: item.file, tracker: row, useLlm: !noAi && !reuse, cachedAi },
        (step, status, note) => {
          if (status === "start" && note) process.stdout.write(`   … ${note}\n`);
        },
      );
      // a --reuse-ai refresh keeps the original end-to-end processing time (the AI step is what takes time)
      if (cachedAi && old) {
        r.processing_ms = old.processing_ms;
        r.timings = old.timings;
      }
      fs.writeFileSync(path.join(REVIEWS_DIR, `${item.id}.json`), JSON.stringify(r, null, 2));
      console.log(
        `${item.id.padEnd(6)} ${item.counterparty.slice(0, 28).padEnd(29)} ${r.in_scope ? "" : "[out of scope] "}C${r.counts.CRITICAL} H${r.counts.HIGH} M${r.counts.MEDIUM} L${r.counts.LOW}  ai=${r.ai.status.padEnd(9)} ${((Date.now() - t) / 1000).toFixed(1)}s`,
      );
    } catch (e) {
      console.error(`${item.id} FAILED: ${(e as Error).message}`);
    }
  }
}
main();
