import "./env";
import { parseContract } from "../src/lib/clauses";
import { commitmentStatus, loadPrecedents, loadQueue, loadRegister, readRaw, trackerIssues } from "../src/lib/data";
import { isGrounded } from "../src/lib/text";

const today = process.env.DATASET_TODAY || "2026-09-28";
console.log(`\nIncoming queue (today = ${today})\n`);
const q = loadQueue();
for (const i of q) {
  const parsed = parseContract(readRaw(i.file));
  console.log(
    `${i.id.padEnd(6)} ${i.counterparty.slice(0, 30).padEnd(31)} ${i.doc_type.slice(0, 22).padEnd(23)} ${String(i.atliq_entity || "-").padEnd(8)} ${String(i.value_usd ?? "-").padStart(7)}  due ${String(i.deadline ?? "-").padEnd(10)} ${i.bundle ? "[bundle]" : "        "} ${i.in_scope ? "" : "(out of scope)"} clauses=${parsed.clauses.length}`,
  );
}
console.log(`\n${q.length} incoming drafts.`);
console.log("\nTracker issues:\n- " + trackerIssues().join("\n- "));

let bad = 0;
console.log("\nGrounding check — commitments register:");
for (const c of loadRegister()) {
  const src = readRaw(c.source_file);
  const quotes = [{ ref: c.clause_ref, quote: c.quote }, ...c.extra_quotes.map((x) => ({ ref: x.clause_ref, quote: x.quote }))];
  for (const x of quotes) {
    if (!isGrounded(x.quote, src)) {
      bad++;
      console.log(`  ✗ ${c.id} ${x.ref}: "${x.quote.slice(0, 80)}…"`);
    }
  }
  console.log(`  ${c.id.padEnd(7)} ${c.type.padEnd(26)} ${c.counterparty.slice(0, 28).padEnd(29)} ${commitmentStatus(c, today)}`);
}
console.log("\nGrounding check — precedents:");
for (const p of loadPrecedents()) {
  if (!isGrounded(p.quote, readRaw(p.source_file))) {
    bad++;
    console.log(`  ✗ ${p.id} ${p.counterparty}: "${p.quote.slice(0, 80)}…"`);
  }
}
console.log(bad ? `\n${bad} ungrounded quote(s).` : "\nAll register and precedent quotes verified verbatim in their source files.");
process.exit(bad ? 1 : 0);
