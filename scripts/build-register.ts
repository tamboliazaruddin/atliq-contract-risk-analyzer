import "./env";
import fs from "node:fs";
import path from "node:path";
import { parseContract } from "../src/lib/clauses";
import { DERIVED_DIR } from "../src/lib/config";
import { loadRegister, loadSignedDocs, readRaw } from "../src/lib/data";
import { completeJson, llmConfig } from "../src/lib/llm";
import { mask } from "../src/lib/masking";
import { EXTRACT_SYSTEM, ExtractionResult } from "../src/lib/prompts/extractCommitments";
import { isGrounded, normalise } from "../src/lib/text";

/**
 * Phase 2: AI extraction of restrictive obligations from every signed contract, grounding-checked,
 * written to data/derived/commitments_register.extracted.json and compared with the human-verified
 * register (data/derived/commitments_register.json), which it never overwrites. A human reviews the
 * differences and edits the verified register by hand (PRD: human verification of derived knowledge).
 */

const RESTRICTIVE = /shall not|exclusiv|most favou?r|no less favou?rable|assign|vest|solicit|consent|waive|outside the|only in|insurance|liquidated damages|retain(?:s)? ownership|certified|engagement|restricted period|compet/i;

async function main() {
  const cfg = llmConfig();
  if (cfg.provider === "none") {
    console.error("No LLM API key configured (.env.local). The curated register in data/derived/commitments_register.json is still used by the app.");
    process.exit(1);
  }
  const { documents } = loadSignedDocs();
  const out: Record<string, unknown>[] = [];
  for (const d of documents) {
    const text = readRaw(d.file);
    const parsed = parseContract(text);
    // only clauses that can carry a restriction — keeps prompts small and focused
    const block = parsed.clauses
      .filter((c) => RESTRICTIVE.test(c.text) || /definition/i.test(c.heading))
      .map((c) => `[${c.ref}] ${mask(c.text).text.replace(/\*\*/g, "")}`)
      .join("\n")
      .slice(0, 12000);
    process.stdout.write(`${d.file.padEnd(72)} `);
    try {
      const { data } = await completeJson(EXTRACT_SYSTEM, `SIGNED CONTRACT: ${parsed.title} with ${d.counterparty} (AtliQ entity: ${d.atliq_entity}; signed ${d.signed}; expiry ${d.expiry ?? "n/a"})\n\nCLAUSES:\n${block}`, ExtractionResult, 3000);
      let ok = 0;
      for (const c of data.commitments) {
        const grounded = isGrounded(c.quote, text);
        if (grounded) ok++;
        out.push({ ...c, counterparty: d.counterparty, source_file: d.file, grounded, verified_by_human: false });
      }
      console.log(`${data.commitments.length} extracted, ${ok} grounded`);
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }
  const dest = path.join(DERIVED_DIR, "commitments_register.extracted.json");
  fs.writeFileSync(dest, JSON.stringify({ generated_at: new Date().toISOString(), model: `${cfg.provider}/${cfg.model}`, items: out }, null, 2));
  console.log(`\nWrote ${out.length} extracted items → ${dest}`);

  // compare with the human-verified register
  const verified = loadRegister();
  let hit = 0;
  console.log("\nCoverage of the verified register by the AI extraction:");
  for (const v of verified) {
    const vq = normalise(v.quote).slice(0, 60);
    const found = out.some((x) => x.source_file === v.source_file && (normalise(String(x.quote)).includes(vq.slice(0, 40)) || vq.includes(normalise(String(x.quote)).slice(0, 40))));
    if (found) hit++;
    console.log(`  ${found ? "✓" : "✗"} ${v.id} ${v.type.padEnd(26)} ${v.counterparty}`);
  }
  console.log(`\n${hit}/${verified.length} verified commitments also found by the AI extraction. Review the ✗ rows and any extra extracted items by hand.`);
}
main();
