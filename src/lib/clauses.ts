import type { Clause } from "./types";

export interface ParsedContract {
  title: string;
  provenance: string | null; // italic "(Client draft received …)" note at the top, not part of the contract
  clauses: Clause[];
  body: string; // contract text without the provenance note
}

const HEADING_MD = /^(#{1,4})\s+(.*)$/;
const OCR_HEADING = /^(\d{1,2})\.\s+([A-Z0-9][A-Z0-9 &,'’\-/]{3,60})$/; // "6. RESTRICTIVE C0VENANT"
const NUMBERED = /^\s*(?:\*\*)?(?:§\s*)?((?:[A-Z]{1,2})?\d+(?:\.\d+)+)(?:\*\*)?[.)]?\s+/; // 12.1 / 1.11 / S1.2
const LIST_ITEM = /^\s*(\d{1,2})\.\s+(?=\*\*|[A-Z])/; // "1. **AL NOOR …" under PARTIES
const RECITAL = /^\s*(?:\(([A-Z])\)|([A-Z])\.)\s+/; // "A. The Client…" / "(A) The Client…"
const SUBITEM = /^\s*\(([a-z]{1,4}|[ivx]+)\)\s+/;

function cleanHeading(h: string): string {
  return h.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

/** Turn a heading into a short section label used as a clause-ref prefix. */
function sectionLabel(heading: string): { label: string; num: string | null } {
  const h = cleanHeading(heading);
  let m = h.match(/^(?:ARTICLE|Article)\s+(\d+)/);
  if (m) return { label: `Art. ${m[1]}`, num: m[1] };
  m = h.match(/^§\s*(\d+)/);
  if (m) return { label: `§${m[1]}`, num: m[1] };
  m = h.match(/^(\d+)\.?\s/);
  if (m) return { label: `§${m[1]}`, num: m[1] };
  m = h.match(/^(SCHEDULE|Schedule|ANNEXURE|Annexure|ANNEX|Annex|EXHIBIT|Exhibit|APPENDIX|Appendix)\s+([A-Z0-9]+)/);
  if (m) {
    const word = m[1][0] + m[1].slice(1).toLowerCase();
    return { label: `${word} ${m[2]}`, num: null };
  }
  const short = h.split(/\s[—–-]\s|\(/)[0].trim();
  const titled = short.length > 40 ? short.slice(0, 40) : short;
  return { label: titled.charAt(0) + titled.slice(1).toLowerCase(), num: null };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/§/g, "s").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function parseContract(raw: string): ParsedContract {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let provenance: string | null = null;
  let startLine = 0;
  // provenance note: first non-empty line in italic parentheses
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (/^\*\(.*\)\*$/.test(l)) {
      provenance = l.replace(/^\*\(|\)\*$/g, "");
      startLine = i + 1;
    }
    break;
  }

  let title = "";
  const clauses: Clause[] = [];
  const ids = new Map<string, number>();
  let heading = "Preamble";
  let section = { label: "Preamble", num: null as string | null };
  let current: Clause | null = null;
  let sectionHasNumbered = false;
  let paraCount = 0;
  let blankBefore = true;
  let recitalCount = 0;

  const push = (ref: string, text: string, line: number) => {
    const base = slug(ref) || "clause";
    const n = (ids.get(base) ?? 0) + 1;
    ids.set(base, n);
    const c: Clause = { id: `c-${base}${n > 1 ? `-${n}` : ""}`, ref, heading, text, line };
    clauses.push(c);
    current = c;
    return c;
  };

  for (let i = startLine; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();
    const lineNo = i + 1;
    if (!line.trim()) {
      blankBefore = true;
      continue;
    }
    if (/^-{3,}$/.test(line.trim()) || /^Page \d+ of \d+$/i.test(line.trim())) continue;

    const md = line.match(HEADING_MD);
    const ocr = !md && line.trim().match(OCR_HEADING);
    if (md || ocr) {
      const h = md ? md[2] : line.trim();
      if (!title && (md ? md[1].length === 1 : false)) {
        title = cleanHeading(h);
        heading = title;
        section = { label: "Preamble", num: null };
        current = null;
        sectionHasNumbered = false;
        paraCount = 0;
        blankBefore = true;
        continue;
      }
      heading = cleanHeading(h);
      section = sectionLabel(h);
      current = null;
      sectionHasNumbered = false;
      paraCount = 0;
      recitalCount = 0;
      blankBefore = true;
      continue;
    }
    if (!title && /^[A-Z][A-Z0-9 &\-]{8,}$/.test(line.trim()) && clauses.length === 0) {
      title = line.trim(); // OCR title line
      continue;
    }

    const num = line.match(NUMBERED);
    if (num) {
      sectionHasNumbered = true;
      push(`§${num[1]}`, line.trim(), lineNo);
      blankBefore = false;
      continue;
    }
    const bold = line.match(/^\s*\*\*((?:[A-Z]{1,2})?\d+(?:\.\d+)+)\s/); // "**S1.1 Objectives.**"
    if (bold) {
      sectionHasNumbered = true;
      push(`${section.label === "Preamble" ? "" : section.label + " "}${bold[1]}`.trim(), line.trim(), lineNo);
      blankBefore = false;
      continue;
    }
    const li = line.match(LIST_ITEM);
    if (li && !SUBITEM.test(line) && (blankBefore || current === null || !(current as Clause).ref.startsWith("§"))) {
      push(`${section.label} (${li[1]})`, line.trim(), lineNo);
      blankBefore = false;
      continue;
    }
    const rec = line.match(RECITAL);
    if (rec && blankBefore && /recital|background|preamble|whereas/i.test(heading + " " + section.label)) {
      push(`Recital ${rec[1] ?? rec[2]}`, line.trim(), lineNo);
      blankBefore = false;
      continue;
    }
    if (/^\s*(\d+\.\d+\s+)?WHEREAS\b/.test(line) && blankBefore) {
      recitalCount++;
      push(`Recital ${String.fromCharCode(64 + recitalCount)}`, line.trim(), lineNo);
      blankBefore = false;
      continue;
    }

    const isSub = SUBITEM.test(line) || /^\s{2,}\S/.test(rawLine) || /^\s*[-*]\s/.test(line);
    const cur = current as Clause | null;
    if (cur && (isSub || !blankBefore || sectionHasNumbered)) {
      cur.text += "\n" + line.trim();
      blankBefore = false;
      continue;
    }
    // new paragraph in a section without numbered clauses
    paraCount++;
    const ref = paraCount === 1 ? section.label : `${section.label} ¶${paraCount}`;
    push(ref, line.trim(), lineNo);
    blankBefore = false;
  }

  const body = lines.slice(startLine).join("\n");
  return { title: title || "Untitled contract", provenance, clauses, body };
}

/** Find the clause containing a quote (normalised substring match), else null. */
export function clauseForQuote(clauses: Clause[], quote: string, norm: (s: string) => string): Clause | null {
  const q = norm(quote);
  if (!q) return null;
  for (const c of clauses) if (norm(c.text).includes(q)) return c;
  // fall back to the clause containing the longest prefix of the quote
  const head = q.slice(0, Math.min(60, q.length));
  for (const c of clauses) if (norm(c.text).includes(head)) return c;
  return null;
}

export function clauseByRef(clauses: Clause[], ref: string): Clause | null {
  const r = ref.replace(/\s+/g, "").toLowerCase();
  return clauses.find((c) => c.ref.replace(/\s+/g, "").toLowerCase() === r) ?? null;
}
