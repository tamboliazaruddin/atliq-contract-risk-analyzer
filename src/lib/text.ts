import crypto from "node:crypto";

/**
 * Normalise text for grounding checks: drop markdown emphasis, unify quotes/dashes,
 * collapse whitespace, lowercase. Keeps the check strict enough to catch invented
 * wording while tolerating formatting differences.
 */
export function normalise(s: string): string {
  return s
    .replace(/\*\*|__|`/g, "")
    .replace(/[“”„″]/g, '"')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `quote` appears verbatim (after normalisation) in `source`. */
export function isGrounded(quote: string | undefined, source: string): boolean {
  if (!quote) return false;
  const q = normalise(quote).replace(/^["'.\s]+|["'.\s]+$/g, "");
  if (q.length < 8) return false;
  return normalise(source).includes(q);
}

export function sha(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Word-boundary, case-insensitive keyword search. Returns index or -1. */
export function findKeyword(text: string, keyword: string): number {
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // short all-caps acronyms (AI, GCC, OTA, UAE) must match case-sensitively to avoid "ai" in words
  const caseSensitive = keyword.length <= 4 && keyword === keyword.toUpperCase();
  const re = new RegExp(`(^|[^A-Za-z0-9])${esc}(?=$|[^A-Za-z0-9])`, caseSensitive ? "" : "i");
  const m = re.exec(text);
  return m ? m.index + m[1].length : -1;
}

/** Return the sentence (or table row / list line) around a character index. */
export function sentenceAround(text: string, idx: number, max = 420): string {
  if (idx < 0) return "";
  const lineStart = text.lastIndexOf("\n", idx - 1) + 1;
  const nl = text.indexOf("\n", idx);
  const lineEnd = nl === -1 ? text.length : nl;
  const line = text.slice(lineStart, lineEnd);
  if (line.length <= max) return line.replace(/^[\s\-*]+/, "").trim();
  // long line: pick the sentence containing idx (split on ". " / "; " before a capital, digit or "(")
  const rel = idx - lineStart;
  const re = /[.;]\s+(?=[A-Z0-9("])/g;
  let s = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const e = m.index + 1;
    if (e > rel) return line.slice(s, e).trim();
    s = m.index + m[0].length;
  }
  return line.slice(s).trim();
}

export function clip(s: string, n = 300): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Strip markdown emphasis so quotes read cleanly but still ground. */
export function plain(s: string): string {
  return s.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
}

export const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, sixty: 60, ninety: 90,
  "one hundred and twenty": 120, "one hundred twenty": 120,
};
