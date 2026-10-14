"use client";

import type { Clause, ReviewConfig, ReviewResult } from "../types";

export interface ProgressEvent {
  type: "progress";
  step: string;
  status: "start" | "done" | "failed" | "skipped";
  note?: string;
}

export interface ReviewPayload {
  review: ReviewResult;
  clauses: Clause[];
  provenance: string | null;
}

export class ReviewFailed extends Error {
  constructor(
    message: string,
    public state: number,
  ) {
    super(message);
  }
}

/** POST /api/review and consume the NDJSON progress stream. */
export async function runReviewStream(
  body: { text?: string; fileName?: string; contractId?: string | null; config?: Partial<ReviewConfig>; version?: number; useLlm?: boolean },
  onProgress: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ReviewPayload> {
  const res = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new ReviewFailed((j as { error?: string }).error ?? `Review request failed (${res.status}).`, 0);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: ReviewPayload | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "progress") onProgress(msg);
      else if (msg.type === "result") result = { review: msg.review, clauses: msg.clauses, provenance: msg.provenance };
      else if (msg.type === "error") throw new ReviewFailed(msg.message, msg.state);
    }
  }
  if (!result) throw new ReviewFailed("The review stream ended without a result. No report was produced — please retry.", 0);
  return result;
}

export interface SetupResponse {
  fileName: string;
  contractId: string | null;
  text: string;
  title: string;
  counterparty: string;
  config: ReviewConfig;
  outOfScope: string | null;
  ai: { provider: string; model: string };
}

export async function setupFromFile(file: File): Promise<SetupResponse> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/setup", { method: "POST", body: fd });
  const j = await res.json();
  if (!res.ok) throw new ReviewFailed(j.error ?? "Could not read the file.", j.state ?? 2);
  return j as SetupResponse;
}

export async function setupFromDataset(contractId: string): Promise<SetupResponse> {
  const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contractId }) });
  const j = await res.json();
  if (!res.ok) throw new ReviewFailed(j.error ?? "Could not load the contract.", j.state ?? 2);
  return j as SetupResponse;
}
