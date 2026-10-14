import { NextResponse } from "next/server";
import { isOutOfScope, loadQueue, loadTracker, readRaw } from "@/lib/data";
import { llmConfig } from "@/lib/llm";
import { fileToText } from "@/lib/parse";
import { ReviewInputError, autoConfig } from "@/lib/review";

export const runtime = "nodejs";

/** Step 1 of a review: read the file and auto-detect the review setup so the reviewer can confirm it (FR-1, FR-4). */
export async function POST(req: Request) {
  try {
    let text: string;
    let fileName: string;
    let contractId: string | null = null;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
      fileName = file.name;
      text = await fileToText(file.name, Buffer.from(await file.arrayBuffer()));
    } else {
      const body = (await req.json()) as { contractId?: string };
      const item = loadQueue().find((q) => q.id === body.contractId);
      if (!item) return NextResponse.json({ error: "Unknown contract." }, { status: 404 });
      contractId = item.id;
      fileName = item.file_name;
      text = readRaw(item.file);
    }
    const tracker = contractId ? (loadTracker().find((r) => r.contract_id === contractId) ?? null) : null;
    const cfg = autoConfig(text, tracker);
    if (text.trim().length < 300) throw new ReviewInputError(`Could not read enough text from "${fileName}". Upload a supported, text-based file.`);
    const llm = llmConfig();
    return NextResponse.json({
      fileName,
      contractId,
      text,
      title: cfg.title,
      counterparty: cfg.counterparty,
      config: { ...cfg, title: undefined, counterparty: undefined },
      outOfScope: isOutOfScope(tracker?.doc_type ?? (cfg.contract_type === "Contractor" ? "Contractor Agreement" : ""), fileName),
      ai: { provider: llm.provider, model: llm.model },
    });
  } catch (e) {
    if (e instanceof ReviewInputError) return NextResponse.json({ error: e.message, state: 2 }, { status: 422 });
    console.error("setup failed:", (e as Error).message);
    return NextResponse.json({ error: "The file could not be processed. Upload a supported PDF, DOCX or Markdown contract.", state: 2 }, { status: 422 });
  }
}
