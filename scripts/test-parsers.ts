import "./env";
import JSZip from "jszip";
import { fileToText } from "../src/lib/parse";
import { autoConfig } from "../src/lib/review";

// Smoke test for upload parsing: builds a text PDF and a DOCX in memory and runs them through fileToText.
const LINES = [
  "MASTER SERVICES AGREEMENT",
  "This Agreement is made between Pinecrest Outfitters LLC, a Colorado limited liability company (Client), and AtliQ Inc, a Delaware corporation (Supplier).",
  "1.1 Supplier will build an inventory forecasting model and dashboards for Client.",
  "2.1 Fees for SOW-1 are USD 42,000. Client shall pay each undisputed invoice within thirty (30) days of receipt.",
  "3.1 Each party's aggregate liability shall not exceed the fees paid or payable under the applicable SOW.",
  "4.1 This Agreement is governed by the laws of the State of Colorado.",
];

function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);
  const content = "BT /F1 10 Tf 40 780 Td 14 TL " + lines.map((l) => `(${esc(l.slice(0, 95))}) Tj T* ${l.length > 95 ? `(${esc(l.slice(95))}) Tj T*` : ""}`).join(" ") + " ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function makeDocx(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${x(l)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
  for (const [name, buf] of [
    ["test.pdf", makePdf(LINES)],
    ["test.docx", await makeDocx(LINES)],
  ] as const) {
    if (process.argv[2]) (await import("node:fs")).writeFileSync(`${process.argv[2]}/${name}`, buf);
    try {
      const text = await fileToText(name, buf);
      const cfg = autoConfig(text, null);
      console.log(`${name}: OK — ${text.length} chars · detected ${cfg.contract_type} / ${cfg.atliq_entity} / ${cfg.counterparty_country} · "${text.replace(/\s+/g, " ").slice(0, 70)}…"`);
    } catch (e) {
      console.log(`${name}: FAILED — ${(e as Error).message}`);
    }
  }
}
main();
