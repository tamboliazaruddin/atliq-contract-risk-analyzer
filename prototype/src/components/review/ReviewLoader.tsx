"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ReviewFailed, type SetupResponse, runReviewStream, setupFromDataset } from "@/lib/client/api";
import { type StoredReview, loadReviewVersion, saveReviewVersion, useVersions } from "@/lib/client/store";
import type { Lifecycle } from "@/lib/labels";
import type { Clause, Precedent, ReviewConfig, ReviewResult } from "@/lib/types";
import { ProgressOverlay, type StepState, initialSteps } from "./ProgressOverlay";
import { SetupPanel } from "./SetupPanel";
import type { RegisterSummary } from "./Tabs";
import { Workspace } from "./Workspace";

export interface DatasetReview {
  review: ReviewResult | null;
  clauses: Clause[];
  provenance: string | null;
  text: string;
  title: string;
  counterparty: string;
  inScope: boolean;
}

/**
 * Chooses which version of a review to show (pre-generated dataset review, or a version produced in
 * this browser by a re-review / upload), and runs re-reviews through the setup panel.
 */
export function ReviewLoader({
  contractId,
  dataset,
  precedents,
  register,
  lifecycleInitial,
  dealNote,
}: {
  contractId: string;
  dataset: DatasetReview | null;
  precedents: Precedent[];
  register: RegisterSummary[];
  lifecycleInitial: Lifecycle;
  dealNote: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [versions, , versionsReady] = useVersions(contractId);
  const [activeKey, setActiveKey] = useState<string | null>(null); // null = dataset version
  const [current, setCurrent] = useState<StoredReview | null>(null);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState>(initialSteps());
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // pick the latest browser version when it exists
  useEffect(() => {
    if (!versionsReady) return;
    if (versions.length && activeKey === null && (contractId.startsWith("U-") || params.get("v"))) {
      const want = params.get("v");
      const v = want ? versions.find((x) => String(x.version) === want) : versions[versions.length - 1];
      if (v) setActiveKey(v.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionsReady, versions.length]);

  useEffect(() => {
    if (activeKey) setCurrent(loadReviewVersion(activeKey));
    else setCurrent(null);
  }, [activeKey]);

  const openSetup = async () => {
    setError(null);
    try {
      if (contractId.startsWith("C-")) {
        const s = await setupFromDataset(contractId);
        setSetup(s);
      } else if (current) {
        setSetup({
          fileName: current.review.file_name,
          contractId,
          text: current.text,
          title: current.review.title,
          counterparty: current.review.counterparty,
          config: current.review.config,
          outOfScope: current.review.out_of_scope_reason ?? null,
          ai: { provider: current.review.ai.provider, model: current.review.ai.model },
        });
      }
      setSetupOpen(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (params.get("setup") === "1" && contractId.startsWith("C-")) openSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (config: ReviewConfig) => {
    if (!setup) return;
    setRunning(true);
    setSteps(initialSteps());
    setError(null);
    abort.current = new AbortController();
    const nextVersion = Math.max(dataset?.review ? 1 : 0, ...versions.map((v) => v.version)) + 1;
    try {
      const res = await runReviewStream(
        { contractId, text: contractId.startsWith("C-") ? undefined : setup.text, fileName: setup.fileName, config, version: nextVersion },
        (e) => setSteps((s) => ({ ...s, [e.step]: { status: e.status, note: e.note ?? s[e.step]?.note } })),
        abort.current.signal,
      );
      const stored: StoredReview = { review: res.review, clauses: res.clauses, provenance: res.provenance, text: setup.text };
      saveReviewVersion(contractId, stored, {
        file_name: res.review.file_name,
        title: res.review.title,
        counterparty: res.review.counterparty,
        contract_type: res.review.config.contract_type,
        atliq_entity: res.review.config.atliq_entity,
      });
      setActiveKey(`review.${contractId}.v${res.review.version}`);
      setSetupOpen(false);
      router.replace(`/review/${contractId}?v=${res.review.version}`);
    } catch (e) {
      if ((e as Error).name === "AbortError") setError("Review cancelled — no report was produced.");
      else setError(e instanceof ReviewFailed ? e.message : "The review failed. No report was produced — please retry.");
    } finally {
      setRunning(false);
    }
  };

  const shown: { review: ReviewResult; clauses: Clause[]; provenance: string | null } | null = current ?? (dataset?.review ? { review: dataset.review, clauses: dataset.clauses, provenance: dataset.provenance } : null);

  const versionsUi =
    versions.length > 0 ? (
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Version
        <select
          value={activeKey ?? "dataset"}
          onChange={(e) => setActiveKey(e.target.value === "dataset" ? null : e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800"
        >
          {dataset?.review && <option value="dataset">v1 · pre-generated</option>}
          {versions.map((v) => (
            <option key={v.key} value={v.key}>
              v{v.version} · {new Date(v.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  if (!shown) {
    if (contractId.startsWith("U-") && !versionsReady) return <div className="p-8 text-sm text-slate-500">Loading…</div>;
    return (
      <div className="p-8">
        <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-6">
          <h1 className="text-base font-semibold text-slate-900">Review not found</h1>
          <p className="mt-1 text-sm text-slate-600">
            {contractId.startsWith("U-") ? "Uploaded reviews live in the browser that created them. This one isn't stored here." : "No pre-generated review exists for this contract yet — run one now."}
          </p>
          <div className="mt-4 flex gap-2">
            {contractId.startsWith("C-") && (
              <button onClick={openSetup} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
                Set up review
              </button>
            )}
            <Link href="/review/new" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              Upload a contract
            </Link>
          </div>
        </div>
        {setupOpen && setup && <SetupDrawer setup={setup} running={running} onRun={run} onClose={() => setSetupOpen(false)} versions={versions} />}
        {running && <ProgressOverlay steps={steps} title={setup?.title ?? ""} onCancel={() => abort.current?.abort()} />}
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800">
          <span>
            <strong>Could not complete the review.</strong> {error}
          </span>
          <button onClick={() => setError(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}
      <Workspace
        review={shown.review}
        clauses={shown.clauses}
        provenance={shown.provenance}
        precedents={precedents}
        register={register}
        lifecycleInitial={lifecycleInitial}
        dealNote={shown.review.config.deal_context || dealNote}
        versionsUi={versionsUi}
        onOpenSetup={shown.review.in_scope || contractId.startsWith("U-") ? openSetup : null}
      />
      {setupOpen && setup && <SetupDrawer setup={setup} running={running} onRun={run} onClose={() => setSetupOpen(false)} versions={versions} />}
      {running && <ProgressOverlay steps={steps} title={setup?.title ?? ""} onCancel={() => abort.current?.abort()} />}
    </>
  );
}

function SetupDrawer({
  setup,
  running,
  onRun,
  onClose,
  versions,
}: {
  setup: SetupResponse;
  running: boolean;
  onRun: (c: ReviewConfig) => void;
  onClose: () => void;
  versions: { version: number; at: string }[];
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <div className="h-full w-[420px] border-l border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <SetupPanel
          initial={setup.config}
          title={setup.title}
          counterparty={setup.counterparty}
          fileName={setup.fileName}
          outOfScope={setup.outOfScope}
          ai={setup.ai}
          versions={versions}
          running={running}
          onRun={onRun}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
