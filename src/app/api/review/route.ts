import { parseContract } from "@/lib/clauses";
import { loadQueue, loadTracker, readRaw } from "@/lib/data";
import { rateLimit } from "@/lib/ratelimit";
import { ReviewInputError, runReview } from "@/lib/review";
import type { ReviewConfig } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel free (Hobby) plan limit; the AI step has its own time budget (llm.ts aiTimeBudgetMs)

interface Body {
  text?: string;
  fileName?: string;
  contractId?: string | null;
  config?: Partial<ReviewConfig>;
  version?: number;
  useLlm?: boolean;
}

/**
 * Step 2: run the review. Streams newline-delimited JSON progress events so the UI can show real
 * steps (UI_REFERENCE §3), then a final result — or an error, never a partial report that looks complete.
 */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const rl = rateLimit(ip);
  if (!rl.ok) return Response.json({ error: `Too many reviews — try again in ${rl.retryAfter}s.` }, { status: 429 });

  const body = (await req.json()) as Body;
  let text = body.text ?? "";
  let fileName = body.fileName ?? "upload";
  let contractId = `U-${Date.now().toString(36)}`;
  let tracker = null;
  let fileRel: string | null = null;
  if (body.contractId && /^C-\d+$/.test(body.contractId)) {
    const item = loadQueue().find((q) => q.id === body.contractId);
    if (item) {
      text = readRaw(item.file);
      fileName = item.file_name;
      contractId = item.id;
      fileRel = item.file;
      tracker = loadTracker().find((r) => r.contract_id === item.id) ?? null;
    }
  } else if (body.contractId && /^U-[a-z0-9]+$/i.test(body.contractId)) {
    contractId = body.contractId;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        const review = await runReview(
          { text, fileName, contractId, fileRel, tracker, config: body.config, version: body.version ?? 1, useLlm: body.useLlm !== false },
          (step, status, note) => send({ type: "progress", step, status, note }),
        );
        const parsed = parseContract(text);
        send({ type: "result", review, clauses: parsed.clauses, provenance: parsed.provenance });
      } catch (e) {
        if (e instanceof ReviewInputError) send({ type: "error", state: 2, message: e.message });
        else {
          console.error("review failed:", (e as Error).message); // never log contract text
          send({ type: "error", state: 0, message: "The review could not be completed. No report was produced — please retry." });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
