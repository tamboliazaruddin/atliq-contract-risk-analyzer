import "./env";
import fs from "node:fs";
import path from "node:path";
import { runReview } from "../src/lib/review";

// Review any local file with the engine:  npx tsx scripts/try-file.ts data/synthetic/x.md [--ai]
async function main() {
  const file = process.argv[2];
  const ai = process.argv.includes("--ai");
  const r = await runReview({ text: fs.readFileSync(file, "utf8"), fileName: path.basename(file), contractId: "U-try", useLlm: ai });
  console.log(`${r.title} — ${r.counterparty} · ${r.config.contract_type} · ${r.config.atliq_entity} · ${r.config.atliq_role} · ${r.config.counterparty_country} · AI ${r.ai.status}`);
  for (const f of r.findings) console.log(`  [${f.severity}] ${f.finding_type} ${f.contract_clause_ref} — ${f.title}${f.grounded ? "" : " (NOT GROUNDED)"}`);
  for (const c of r.checks.filter((c) => c.status !== "not_applicable")) console.log(`  · ${c.status.padEnd(16)} ${c.name}`);
}
main();
