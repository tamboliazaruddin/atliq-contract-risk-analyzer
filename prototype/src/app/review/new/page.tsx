"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ProgressOverlay, type StepState, initialSteps } from "@/components/review/ProgressOverlay";
import { SetupPanel } from "@/components/review/SetupPanel";
import { PageHeader } from "@/components/ui";
import { ReviewFailed, type SetupResponse, runReviewStream, setupFromFile } from "@/lib/client/api";
import { saveReviewVersion } from "@/lib/client/store";
import type { ReviewConfig } from "@/lib/types";

export default function NewReview() {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState>(initialSteps());
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const onFile = async (f: File) => {
    setError(null);
    setSetup(null);
    setBusy(true);
    try {
      setSetup(await setupFromFile(f));
    } catch (e) {
      setError(e instanceof ReviewFailed ? e.message : "The file could not be processed.");
    } finally {
      setBusy(false);
    }
  };

  const run = async (config: ReviewConfig) => {
    if (!setup) return;
    setRunning(true);
    setSteps(initialSteps());
    setError(null);
    abort.current = new AbortController();
    const id = `U-${Date.now().toString(36)}`;
    try {
      const res = await runReviewStream(
        { contractId: id, text: setup.text, fileName: setup.fileName, config, version: 1 },
        (e) => setSteps((s) => ({ ...s, [e.step]: { status: e.status, note: e.note ?? s[e.step]?.note } })),
        abort.current.signal,
      );
      saveReviewVersion(
        id,
        { review: res.review, clauses: res.clauses, provenance: res.provenance, text: setup.text },
        { file_name: setup.fileName, title: res.review.title, counterparty: res.review.counterparty, contract_type: res.review.config.contract_type, atliq_entity: res.review.config.atliq_entity },
      );
      router.push(`/review/${id}`);
    } catch (e) {
      if ((e as Error).name === "AbortError") setError("Review cancelled — no report was produced.");
      else setError(e instanceof ReviewFailed ? e.message : "The review failed. No report was produced — please retry.");
      setRunning(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-29px)] flex-col">
      <PageHeader title="New review" subtitle="Upload a client or partner contract. AtliQ reviews it against what it has already signed and how it negotiated before." />
      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <div className="font-semibold">Could not read this file — upload a supported or corrected file</div>
              <div className="mt-1">{error}</div>
              <div className="mt-1 text-xs text-red-700">No report was generated, so nothing about this contract has been reviewed.</div>
            </div>
          )}
          {!setup ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f) onFile(f);
              }}
              onClick={() => input.current?.click()}
              className={`flex h-72 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition ${drag ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white hover:border-slate-400"}`}
            >
              <div className="text-3xl text-slate-400">⇪</div>
              <div className="mt-2 text-sm font-medium text-slate-800">{busy ? "Reading file…" : "Drop a contract here, or click to choose"}</div>
              <div className="mt-1 text-xs text-slate-500">PDF (text-based), DOCX, Markdown or TXT · up to 8 MB</div>
              <input ref={input} type="file" accept=".pdf,.docx,.md,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-slate-600">
                  Document preview · <span className="font-medium text-slate-800">{setup.fileName}</span> · {setup.text.length.toLocaleString()} characters
                </div>
                <button onClick={() => setSetup(null)} className="text-xs text-slate-500 underline">
                  Choose another file
                </button>
              </div>
              <pre className="contract-text max-h-[65vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-6 text-[13px]">{setup.text.slice(0, 20000)}</pre>
            </div>
          )}
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Try it with the dataset</div>
            The 15 incoming drafts are already in the <Link href="/" className="text-brand-700 underline">review queue</Link>. To test a live upload, download any file from <code>data/raw/incoming/</code> and drop it here — or a{" "}
            synthetic one from <code>data/synthetic/</code>.
          </div>
        </div>
        {setup && (
          <div className="w-[420px] shrink-0 border-l border-slate-200 bg-white">
            <SetupPanel initial={setup.config} title={setup.title} counterparty={setup.counterparty} fileName={setup.fileName} outOfScope={setup.outOfScope} ai={setup.ai} onRun={run} running={running} />
          </div>
        )}
      </div>
      {running && setup && <ProgressOverlay steps={steps} title={setup.title} onCancel={() => abort.current?.abort()} />}
    </div>
  );
}
