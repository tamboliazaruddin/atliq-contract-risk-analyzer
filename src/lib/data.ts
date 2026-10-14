import fs from "node:fs";
import path from "node:path";
import { DERIVED_DIR, RAW_DIR, REVIEWS_DIR, SYNTHETIC_DIR, datasetToday } from "./config";
import {
  Commitment,
  PortfolioClient,
  Precedent,
  QueueItem,
  ReviewResult,
  Rule,
  SignedDoc,
  TrackerRow,
  type DocStatus,
} from "./types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

let trackerCache: TrackerRow[] | null = null;
export function loadTracker(): TrackerRow[] {
  if (trackerCache) return trackerCache;
  const rows = parseCsv(fs.readFileSync(path.join(RAW_DIR, "contract_tracker.csv"), "utf8"));
  const [header, ...data] = rows;
  trackerCache = data.map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h.trim()] = (r[i] ?? "").trim()));
    return TrackerRow.parse(o);
  });
  return trackerCache;
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function loadRules(): { rules: Rule[]; dataset_today: string } {
  const d = readJson(path.join(DERIVED_DIR, "rules.json")) as { rules: unknown[]; dataset_today: string };
  return { rules: z.array(Rule).parse(d.rules), dataset_today: d.dataset_today };
}

export interface Entity {
  id: "pvt_ltd" | "inc";
  legal_name: string;
  aliases: string[];
  serves_regions: string[];
  home_law: string;
  registered_office: string;
}
export function loadEntities(): { entities: Entity[]; notes: string[] } {
  return readJson(path.join(DERIVED_DIR, "entities.json")) as { entities: Entity[]; notes: string[] };
}

export function loadRegister(): Commitment[] {
  const d = readJson(path.join(DERIVED_DIR, "commitments_register.json")) as { items: unknown[] };
  return z.array(Commitment).parse(d.items);
}

export function loadPrecedents(): Precedent[] {
  const d = readJson(path.join(DERIVED_DIR, "precedents.json")) as { items: unknown[] };
  return z.array(Precedent).parse(d.items);
}

export function loadSignedDocs(): { documents: SignedDoc[]; portfolio: PortfolioClient[] } {
  const d = readJson(path.join(DERIVED_DIR, "signed_documents.json")) as { documents: unknown[]; portfolio: unknown[] };
  return { documents: z.array(SignedDoc).parse(d.documents), portfolio: z.array(PortfolioClient).parse(d.portfolio) };
}

export function readRaw(rel: string): string {
  const p = path.join(RAW_DIR, rel);
  if (!p.startsWith(RAW_DIR)) throw new Error("Path outside dataset");
  return fs.readFileSync(p, "utf8");
}

export function rawExists(rel: string): boolean {
  return fs.existsSync(path.join(RAW_DIR, rel));
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export type CommitmentStatus = "active" | "expiring" | "expired" | "waived" | "spent" | "perpetual";

export function commitmentStatus(c: Commitment, today = datasetToday()): CommitmentStatus {
  if (c.status_override) return c.status_override;
  if (!c.end) return "perpetual";
  if (c.end < today) return "expired";
  const days = (Date.parse(c.end) - Date.parse(today)) / 86_400_000;
  return days <= 30 ? "expiring" : "active";
}

export function signedDocStatus(d: SignedDoc, today = datasetToday()): DocStatus {
  if (d.status_override) return d.status_override;
  if (!d.expiry) return "signed_active";
  if (d.expiry < today) return "signed_expired";
  const days = (Date.parse(d.expiry) - Date.parse(today)) / 86_400_000;
  return days <= 30 ? "signed_expiring" : "signed_active";
}

export function docStatusFor(sourceFile: string, today = datasetToday()): DocStatus {
  if (sourceFile.startsWith("signed_contracts/")) {
    const d = loadSignedDocs().documents.find((x) => x.file === sourceFile);
    return d ? signedDocStatus(d, today) : "signed_active";
  }
  if (sourceFile.startsWith("incoming/")) return "draft_in_review";
  if (sourceFile.startsWith("meeting_notes/")) return "meeting_note";
  if (sourceFile === "negotiation_notes.md") return "negotiation_note";
  if (sourceFile === "contract_tracker.csv") return "tracker_note";
  return "reference_data";
}

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  signed_active: "Signed · Active",
  signed_expired: "Signed · Expired",
  signed_expiring: "Signed · Expiring soon",
  signed_spent: "Signed · Spent",
  draft_in_review: "Draft · In review (not binding)",
  negotiation_note: "Negotiation note (unreviewed)",
  meeting_note: "Meeting note (not a contract)",
  tracker_note: "Tracker note",
  reference_data: "Reference data",
  this_contract: "This contract",
};

// ---------------------------------------------------------------------------
// Incoming queue
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Deadlines live in the tracker's free-text notes ("need by 1 Oct", "sign by 10 Oct!!", "start 5 Oct"). */
export function parseDeadline(notes: string, year = datasetToday().slice(0, 4)): { date: string; source: string } | null {
  const re = /\b(?:by|before|start|need by|sign by)\s+(?:(?:mon|tue|wed|thu|fri|sat|sun)\w*\s+)?(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i;
  const m = notes.match(re);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  const date = `${year}-${String(mm).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  return { date, source: m[0] };
}

const FILE_TO_TRACKER: Record<string, string> = {
  // explicit mapping where name matching would be ambiguous (verified by hand against contract_tracker.csv)
  "2026-09-10_harrington_health_msa_draft.md": "C-023",
  "2026-09-16_harrington_health_baa_draft.md": "C-046",
  "2026-09-15_travelhub_services_agreement_draft.md": "C-024",
  "2026-09-18_gulf_crown_hotels_msa_draft.md": "C-025",
  "2026-09-19_lakeshore_grocers_msa_draft.md": "C-026",
  "2026-09-21_blueorchid_hotels_pilot_agreement_draft.md": "C-027",
  "2026-09-23_rheinwerk_analytics_services_agreement_draft.md": "C-028",
  "2026-09-24_sunrise_foods_sow2_draft.md": "C-029",
  "2026-09-24_datavane_strategic_partnership_agreement_draft.md": "C-035",
  "2026-09-25_finserve_capital_mutual_nda_draft.md": "C-036",
  "2026-09-26_kriti_data_labs_subcontractor_agreement_draft.md": "C-037",
  "2026-09-27_loopmart_mutual_nda_draft.md": "C-038",
  "2026-09-27_marcus_reed_contractor_agreement_draft.md": "C-040",
  "2026-09-27_daniel_ortiz_contractor_agreement_draft.md": "C-047",
  "2026-09-27_daniel_ortiz_nda_draft.md": "C-048",
};

/** Freelancer / individual contractor agreements are out of MVP scope (client meetings 1–2, CLAUDE.md). */
export function isOutOfScope(docType: string, fileName: string): string | null {
  // individual contractors only — an agency "Subcontractor Agreement" (e.g. Kriti Data Labs) stays in scope
  if (/(^|[^b])contractor agreement/i.test(docType) || /(^|[^b])contractor_agreement/.test(fileName)) {
    return "Freelancer / individual contractor agreement — out of MVP scope (client and partner contracts only).";
  }
  if (/daniel_ortiz_nda|freelancer/i.test(fileName)) {
    return "NDA with an individual freelancer — out of MVP scope (client and partner contracts only).";
  }
  return null;
}

function titleFromFile(file: string): string {
  const m = fs.readFileSync(file, "utf8").match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/\*\*/g, "").trim() : path.basename(file);
}

export function loadQueue(): QueueItem[] {
  const tracker = loadTracker();
  const dir = path.join(RAW_DIR, "incoming");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const items: QueueItem[] = files.map((f) => {
    const id = FILE_TO_TRACKER[f];
    const row = tracker.find((r) => r.contract_id === id);
    const notes = row?.notes ?? "";
    let deadline = parseDeadline(notes);
    // bundle partner deadline: the Harrington BAA must be signed with the MSA (tracker C-046 notes)
    if (!deadline && /together with the MSA/i.test(notes)) {
      const msa = tracker.find((r) => r.counterparty === row?.counterparty && /MSA/.test(r.doc_type) && r.contract_id !== id);
      const d = msa ? parseDeadline(msa.notes) : null;
      if (d) deadline = { date: d.date, source: `with MSA (${msa!.contract_id}): ${d.source}` };
    }
    const value = row?.value_usd ? Number(row.value_usd) : null;
    const counterparty = row?.counterparty ?? f;
    const sameParty = tracker.filter((r) => r.counterparty === counterparty);
    const reason = isOutOfScope(row?.doc_type ?? "", f);
    return QueueItem.parse({
      id: id ?? `X-${f}`,
      file: `incoming/${f}`,
      file_name: f,
      title: titleFromFile(path.join(dir, f)),
      counterparty,
      doc_type: row?.doc_type ?? "Unknown",
      atliq_entity: row?.atliq_entity ?? "",
      country: row?.client_country ?? "",
      requested_by: row?.requested_by ?? "",
      received: row?.received_date ?? f.slice(0, 10),
      value_usd: Number.isFinite(value) ? value : null,
      deadline: deadline?.date ?? null,
      deadline_source: deadline?.source ?? null,
      tracker_status: row?.status || "Not recorded",
      notes,
      bundle: sameParty.length > 1 ? counterparty : null,
      in_scope: !reason,
      duplicate_of: null,
    });
  });
  return items;
}

/** Other documents in the same deal (from the tracker), used for bundle chips and R4/R5. */
export function bundleMembers(counterparty: string): { contract_id: string; doc_type: string; status: string; signed_date: string }[] {
  return loadTracker()
    .filter((r) => r.counterparty === counterparty)
    .map((r) => ({ contract_id: r.contract_id, doc_type: r.doc_type, status: r.status || "Not recorded", signed_date: r.signed_date }));
}

/** Tracker data-quality issues surfaced on the dashboard (duplicates, blanks). */
export function trackerIssues(): string[] {
  const t = loadTracker();
  const issues: string[] = [];
  const seen = new Map<string, string>();
  for (const r of t) {
    const key = `${r.counterparty}|${r.doc_type}`;
    if (seen.has(key)) issues.push(`${r.contract_id} looks like a duplicate of ${seen.get(key)} (${r.counterparty} ${r.doc_type}).`);
    else seen.set(key, r.contract_id);
  }
  const blankEntity = t.filter((r) => !r.atliq_entity).map((r) => r.contract_id);
  if (blankEntity.length) issues.push(`AtliQ entity blank for ${blankEntity.join(", ")}.`);
  const blankStatus = t.filter((r) => !r.status).map((r) => r.contract_id);
  if (blankStatus.length) issues.push(`Status blank for ${blankStatus.join(", ")}.`);
  return issues;
}

// ---------------------------------------------------------------------------
// Pre-generated reviews
// ---------------------------------------------------------------------------

export function reviewPath(contractId: string): string {
  return path.join(REVIEWS_DIR, `${contractId}.json`);
}

export function loadReview(contractId: string): ReviewResult | null {
  const p = reviewPath(contractId);
  if (!fs.existsSync(p)) return null;
  const parsed = ReviewResult.safeParse(readJson(p));
  return parsed.success ? parsed.data : null;
}

export function listSynthetic(): string[] {
  if (!fs.existsSync(SYNTHETIC_DIR)) return [];
  return fs.readdirSync(SYNTHETIC_DIR).filter((f) => /\.(md|txt)$/.test(f));
}

/** All historical sources the retriever may search (authorised dataset only). */
export function historicalSources(): { file: string; title: string; status: DocStatus; text: string }[] {
  const out: { file: string; title: string; status: DocStatus; text: string }[] = [];
  const { documents } = loadSignedDocs();
  for (const d of documents) {
    out.push({ file: d.file, title: `${d.counterparty} — ${d.doc_type}`, status: signedDocStatus(d), text: readRaw(d.file) });
  }
  out.push({ file: "negotiation_notes.md", title: "Past negotiations (Jay's reconstruction)", status: "negotiation_note", text: readRaw("negotiation_notes.md") });
  for (const f of fs.readdirSync(path.join(RAW_DIR, "meeting_notes"))) {
    if (!f.endsWith(".md")) continue;
    out.push({ file: `meeting_notes/${f}`, title: `Meeting note ${f.slice(0, 10)}`, status: "meeting_note", text: readRaw(`meeting_notes/${f}`) });
  }
  return out;
}
