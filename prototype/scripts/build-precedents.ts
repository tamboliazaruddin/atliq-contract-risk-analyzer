import "./env";
import { loadPrecedents, readRaw } from "../src/lib/data";
import { isGrounded } from "../src/lib/text";

/**
 * Phase 3: the precedent library (data/derived/precedents.json) is curated from negotiation_notes.md,
 * the meeting notes and Karandeep's checklist. This script checks it: every quote must be verbatim in
 * its source, and every counterparty block in the negotiation notes should be represented.
 */
const items = loadPrecedents();
let bad = 0;
for (const p of items) {
  if (!isGrounded(p.quote, readRaw(p.source_file))) {
    bad++;
    console.log(`✗ ${p.id} quote not found in ${p.source_file}`);
  }
}
const notes = readRaw("negotiation_notes.md");
const blocks = Array.from(notes.matchAll(/^\*\*(.+?)\*\*/gm)).map((m) => m[1].split(/\s[—–-]\s/)[0].replace(/\(.*?\)/g, "").trim());
console.log("Negotiation-note blocks → precedents:");
for (const b of blocks) {
  const first = b.split(/\s+/)[0].toLowerCase();
  const n = items.filter((p) => p.counterparty.toLowerCase().startsWith(first)).length;
  console.log(`  ${n ? "✓" : "✗"} ${b.padEnd(40)} ${n} precedent(s)`);
}
const byTag = items.reduce<Record<string, number>>((m, p) => ((m[p.tag] = (m[p.tag] ?? 0) + 1), m), {});
console.log(`\n${items.length} precedents · ${Object.entries(byTag).map(([k, v]) => `${k}: ${v}`).join(" · ")}`);
console.log(bad ? `${bad} ungrounded quote(s)` : "All precedent quotes verified verbatim.");
process.exit(bad ? 1 : 0);
