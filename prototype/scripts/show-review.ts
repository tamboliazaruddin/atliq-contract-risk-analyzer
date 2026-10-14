import "./env";
import { loadReview } from "../src/lib/data";

// Print a pre-generated review for inspection:  npx tsx scripts/show-review.ts C-025 [--full]
const id = process.argv[2];
const full = process.argv.includes("--full");
const r = loadReview(id);
if (!r) {
  console.error(`No review for ${id}`);
  process.exit(1);
}
console.log(`\n${r.contract_id} ${r.title} — ${r.counterparty}`);
console.log(`config: ${r.config.contract_type} · ${r.config.atliq_entity} · ${r.config.atliq_role} · ${r.config.counterparty_country} · AI ${r.ai.status} · ${r.completeness}`);
console.log(`\nKey terms:`);
for (const k of r.key_terms) console.log(`  ${k.label.padEnd(28)} ${(k.clause_ref ?? "").padEnd(12)} ${k.value.slice(0, 110)}`);
console.log(`\nFindings:`);
for (const f of r.findings) {
  console.log(`  [${f.severity}] ${f.finding_type} ${f.category} · ${f.contract_clause_ref} · ${f.grounded ? "grounded" : "NOT GROUNDED"} · ${f.confidence}`);
  console.log(`     ${f.title}`);
  console.log(`     quote: "${f.contract_quote.slice(0, full ? 999 : 150)}"`);
  if (full) console.log(`     ${f.explanation}`);
  for (const e of f.evidence) console.log(`     ↳ ${e.grounded ? "✓" : "✗"} ${e.source_file} ${e.clause_ref} [${e.doc_status}] "${e.quote.slice(0, 90)}"`);
}
console.log(`\nChecks:`);
for (const c of r.checks) console.log(`  ${c.status.padEnd(16)} ${c.name} — ${c.detail.slice(0, 140)}`);
