"use client";

import { useEffect, useState } from "react";

export const STEP_NAMES = [
  "Reading document",
  "Extracting terms",
  "Checking commitments register",
  "Comparing precedents",
  "Validating entity & documents",
  "AI clause analysis",
  "Verifying evidence",
];

export type StepState = Record<string, { status: "pending" | "start" | "done" | "failed" | "skipped"; note?: string }>;

export function initialSteps(): StepState {
  return Object.fromEntries(STEP_NAMES.map((s) => [s, { status: "pending" as const }]));
}

/** Loading state with visible pipeline steps and elapsed time (UI_REFERENCE §3). */
export function ProgressOverlay({ steps, onCancel, title }: { steps: StepState; onCancel: () => void; title: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm">
      <div className="w-[440px] rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          <div>
            <div className="text-sm font-semibold text-slate-900">Reviewing {title}</div>
            <div className="text-xs text-slate-500">
              Elapsed {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · target under 5 minutes
            </div>
          </div>
        </div>
        <ol className="mt-5 space-y-2">
          {STEP_NAMES.map((s) => {
            const st = steps[s] ?? { status: "pending" };
            const icon =
              st.status === "done" ? <span className="text-emerald-600">✓</span>
              : st.status === "failed" ? <span className="text-red-600">✗</span>
              : st.status === "skipped" ? <span className="text-slate-400">–</span>
              : st.status === "start" ? <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-brand-600" />
              : <span className="inline-block h-3 w-3 rounded-full border border-slate-300" />;
            return (
              <li key={s} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex w-4 justify-center">{icon}</span>
                <div className="min-w-0">
                  <div className={st.status === "pending" ? "text-slate-400" : "text-slate-800"}>{s}</div>
                  {st.note && <div className="truncate text-xs text-slate-500">{st.note}</div>}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-5 flex justify-end">
          <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
