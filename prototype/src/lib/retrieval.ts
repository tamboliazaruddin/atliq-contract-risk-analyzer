import { parseContract } from "./clauses";
import { historicalSources } from "./data";
import type { RetrievedPassage } from "./types";

/**
 * Historical context retrieval (PRD FR-5). For a 17-contract corpus a lexical BM25 index over
 * clause-sized chunks is transparent, fast and needs no vector DB (BUILD_PLAN decision 2).
 * Every passage carries its source file, clause ref and document status so drafts, notes and
 * expired agreements are never mistaken for active commitments.
 */

const STOP = new Set(
  "the a an and or of to in for on by with as at from that this be is are shall may any all such its it their other under which will not no into than each party parties agreement services service including".split(" "),
);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

interface Chunk {
  source_file: string;
  title: string;
  clause_ref: string;
  text: string;
  doc_status: RetrievedPassage["doc_status"];
  tf: Map<string, number>;
  len: number;
}

let index: { chunks: Chunk[]; df: Map<string, number>; avg: number } | null = null;

function buildIndex() {
  const chunks: Chunk[] = [];
  for (const src of historicalSources()) {
    let pieces: { ref: string; text: string }[];
    if (src.file.startsWith("signed_contracts/")) {
      pieces = parseContract(src.text).clauses.map((c) => ({ ref: c.ref, text: c.text }));
    } else {
      // notes: split on bullets / paragraphs, keep the counterparty header for negotiation notes
      pieces = [];
      let header = "";
      for (const block of src.text.split(/\n(?=\*\*|- |\n)/)) {
        const t = block.trim();
        if (!t) continue;
        if (t.startsWith("**")) header = t.split("\n")[0].replace(/\*\*/g, "");
        pieces.push({ ref: header || "note", text: t });
      }
    }
    for (const p of pieces) {
      const tk = tokens(p.text);
      if (tk.length < 4) continue;
      const tf = new Map<string, number>();
      tk.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      chunks.push({ source_file: src.file, title: src.title, clause_ref: p.ref, text: p.text, doc_status: src.status, tf, len: tk.length });
    }
  }
  const df = new Map<string, number>();
  chunks.forEach((c) => c.tf.forEach((_v, t) => df.set(t, (df.get(t) ?? 0) + 1)));
  const avg = chunks.reduce((s, c) => s + c.len, 0) / Math.max(chunks.length, 1);
  index = { chunks, df, avg };
  return index;
}

export function retrieve(query: string, k = 8, exclude: string[] = []): RetrievedPassage[] {
  const idx = index ?? buildIndex();
  const q = Array.from(new Set(tokens(query)));
  const N = idx.chunks.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored = idx.chunks
    .filter((c) => !exclude.includes(c.source_file))
    .map((c) => {
      let s = 0;
      for (const t of q) {
        const f = c.tf.get(t);
        if (!f) continue;
        const n = idx.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.len) / idx.avg)));
      }
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b2) => b2.s - a.s);
  // diversity: at most 2 passages per source file
  const per = new Map<string, number>();
  const out: RetrievedPassage[] = [];
  for (const { c, s } of scored) {
    const n = per.get(c.source_file) ?? 0;
    if (n >= 2) continue;
    per.set(c.source_file, n + 1);
    out.push({ source_file: c.source_file, title: c.title, clause_ref: c.clause_ref, text: c.text.slice(0, 700), doc_status: c.doc_status, score: Math.round(s * 100) / 100 });
    if (out.length >= k) break;
  }
  return out;
}
