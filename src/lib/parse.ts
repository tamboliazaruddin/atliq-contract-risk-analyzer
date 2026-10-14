import { ReviewInputError } from "./review";

export const SUPPORTED = [".pdf", ".docx", ".md", ".txt"];
export const MAX_BYTES = 8 * 1024 * 1024;

/** File → plain text (FR-1). Unsupported, corrupted, password-protected or image-only files fail visibly (behaviour State 2). */
export async function fileToText(name: string, buf: Buffer): Promise<string> {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  if (!SUPPORTED.includes(ext)) throw new ReviewInputError(`"${name}" is not a supported file type. Upload a PDF, DOCX, Markdown or plain-text contract.`);
  if (buf.length === 0) throw new ReviewInputError(`"${name}" is empty.`);
  if (buf.length > MAX_BYTES) throw new ReviewInputError(`"${name}" is larger than 8 MB. Upload a smaller file.`);

  if (ext === ".md" || ext === ".txt") {
    const text = buf.toString("utf8");
    if (/\u0000/.test(text.slice(0, 2000))) throw new ReviewInputError(`"${name}" does not look like a text file (binary content).`);
    return text;
  }
  if (ext === ".docx") {
    if (buf.slice(0, 2).toString() !== "PK") throw new ReviewInputError(`"${name}" is not a valid DOCX file (it may be corrupted, password-protected or an old .doc).`);
    try {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: buf });
      return res.value;
    } catch (e) {
      throw new ReviewInputError(`Could not read "${name}": ${(e as Error).message}. The file may be corrupted or password-protected.`);
    }
  }
  // PDF
  if (buf.slice(0, 5).toString() !== "%PDF-") throw new ReviewInputError(`"${name}" is not a valid PDF (corrupted or mislabelled).`);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    const text = res.text ?? "";
    if (text.replace(/\s|--\s*\d+\s*of\s*\d+\s*--/g, "").length < 200) {
      throw new ReviewInputError(`"${name}" has almost no extractable text — it is probably a scanned image. Upload a text-based PDF or run OCR first (OCR is not part of this prototype).`);
    }
    return text;
  } catch (e) {
    if (e instanceof ReviewInputError) throw e;
    const msg = (e as Error).message || String(e);
    if (/password/i.test(msg) || (e as { name?: string }).name === "PasswordException") throw new ReviewInputError(`"${name}" is password-protected. Remove the password and upload again.`);
    throw new ReviewInputError(`Could not read "${name}" (${msg}). The PDF may be corrupted.`);
  } finally {
    await parser.destroy().catch(() => {});
  }
}
