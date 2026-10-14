/**
 * Confidentiality: mask personal data before contract text leaves the machine for an LLM API
 * (client meeting 1 / CLAUDE.md). We mask individuals' names, emails, phone numbers, bank / tax
 * identifiers. Company names and commercial rates are NOT masked: commitment checks (e.g. the
 * Crestline MFN rate comparison) need them, and they are not personal data. The deterministic
 * engine always runs on the unmasked text locally.
 */

const KNOWN_PEOPLE = [
  // counterparty individuals named in the dataset
  "Omar Haddad", "Khalid Al Mansoori", "Laura Brennan", "Tom Beckett", "Helen Ashworth", "Wei Lin Tan",
  "Mark Delaney", "Rakesh Malhotra", "Rakesh Malh0tra", "Shreya Iyer", "Priya Raman", "Meera Pillai",
  "Mohan Krishnan", "Sanjay Kulkarni", "Rebecca Lowe", "Alan Whitaker", "Faisal Al-Otaibi", "Farah Sayed",
  "Nadia Rahman", "Tom Okafor", "Stefan Brandt", "Rachel Kim", "Arjun Mehta", "Kriti Deshpande",
  "Sania Sheikh", "Marcus Reed", "Daniel Ortiz", "Rohan Iyer", "Kevin Brooks", "Diane Foster", "Priya Menon",
  "R. Venkatesh",
];

export interface MaskResult {
  text: string;
  map: Record<string, string>; // placeholder -> original (kept locally, never sent)
}

export function mask(input: string): MaskResult {
  const map: Record<string, string> = {};
  let n = 0;
  const token = (kind: string, original: string) => {
    const existing = Object.entries(map).find(([, v]) => v === original);
    if (existing) return existing[0];
    const t = `[${kind}_${++n}]`;
    map[t] = original;
    return t;
  };
  let text = input;
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => token("EMAIL", m));
  text = text.replace(/\+?\(?\d{1,4}\)?[\s-]?\d{3}[\s-]\d{3,4}[\s-]?\d{0,4}/g, (m) => (m.replace(/\D/g, "").length >= 9 ? token("PHONE", m) : m));
  text = text.replace(/\b(EIN|PAN|GSTIN|CIN|UEN|VAT ID|HRB)\s*:?\s*[A-Z0-9-]{5,}/g, (m) => token("ID", m));
  for (const p of KNOWN_PEOPLE) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    text = text.replace(re, (m) => token("PERSON", m));
  }
  // titled names not in the list: "Mr. John Smith", "Dr. Jane Doe", "Ms. A. Rao"
  text = text.replace(/\b(Mr|Ms|Mrs|Dr)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){0,2})/g, (_m, t, name) => `${t}. ${token("PERSON", name)}`);
  return { text, map };
}

export function unmask(s: string, map: Record<string, string>): string {
  return s.replace(/\[(EMAIL|PHONE|ID|PERSON)_\d+\]/g, (t) => map[t] ?? t);
}
