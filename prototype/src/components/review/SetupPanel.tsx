"use client";

import { useState } from "react";
import type { AtliqEntity, AtliqRole, ContractType, ReviewConfig } from "@/lib/types";

const TYPES: ContractType[] = ["MSA", "SOW", "NDA", "Partnership", "BAA", "DPA", "Pilot", "Services", "Subcontractor", "Contractor", "Other"];
const ROLES: [AtliqRole, string][] = [
  ["supplier", "Supplier"],
  ["partner", "Partner"],
  ["buyer", "Buyer"],
  ["mutual", "Mutual (NDA)"],
];
const CHECKS: [keyof ReviewConfig["checks"], string, string][] = [
  ["clause_risks", "Clause risks", "Pattern scan + AI clause-by-clause analysis"],
  ["commitments", "Commitments conflicts", "Against the commitments register and existing clients"],
  ["precedents", "Precedent comparison", "How AtliQ negotiated similar clauses before"],
  ["entity_law", "Entity & governing law", "Rules R1–R3"],
  ["required_documents", "Required documents (bundle)", "BAA / DPA / annexes — rules R4, R5, R6, R10"],
  ["nda_mutuality", "NDA mutuality", "Rule R7"],
];

/** Review setup (UI_REFERENCE §2, FR-4): auto-detected, editable, visible before the review starts. */
export function SetupPanel({
  initial,
  title,
  counterparty,
  fileName,
  outOfScope,
  ai,
  versions,
  onRun,
  onCancel,
  running,
}: {
  initial: ReviewConfig;
  title: string;
  counterparty: string;
  fileName: string;
  outOfScope: string | null;
  ai: { provider: string; model: string };
  versions?: { version: number; at: string }[];
  onRun: (c: ReviewConfig) => void;
  onCancel?: () => void;
  running?: boolean;
}) {
  const [cfg, setCfg] = useState<ReviewConfig>(initial);
  const set = <K extends keyof ReviewConfig>(k: K, v: ReviewConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const label = "block text-[11px] font-semibold uppercase tracking-wide text-slate-500";
  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Review setup</div>
        <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">
          {counterparty} · {fileName}
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {outOfScope && <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">{outOfScope} Only fact checks (e.g. signing entity) will run.</div>}
        <div>
          <span className={label}>Contract type (auto-detected)</span>
          <select className={input} value={cfg.contract_type} onChange={(e) => set("contract_type", e.target.value as ContractType)}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>AtliQ signing entity (from parties clause)</span>
          <select className={input} value={cfg.atliq_entity} onChange={(e) => set("atliq_entity", e.target.value as AtliqEntity)}>
            <option value="pvt_ltd">AtliQ Technologies Pvt Ltd</option>
            <option value="inc">AtliQ Inc</option>
            <option value="unknown">Not identified</option>
          </select>
        </div>
        <div>
          <span className={label}>AtliQ role</span>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {ROLES.map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => set("atliq_role", v)}
                className={`rounded-md border px-2 py-1.5 text-sm ${cfg.atliq_role === v ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>Counterparty country / region</span>
          <input className={input} value={cfg.counterparty_country} onChange={(e) => set("counterparty_country", e.target.value)} placeholder="e.g. USA, UAE, India, Germany" />
          <p className="mt-1 text-[11px] text-slate-500">Drives the entity and governing-law rules.</p>
        </div>
        <div>
          <span className={label}>Checks to run</span>
          <div className="mt-1 space-y-1.5">
            {CHECKS.map(([k, l, d]) => (
              <label key={k} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5 accent-brand-600" checked={cfg.checks[k]} onChange={(e) => set("checks", { ...cfg.checks, [k]: e.target.checked })} />
                <span>
                  <span className="block text-sm text-slate-800">{l}</span>
                  <span className="block text-[11px] text-slate-500">{d}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>Deal context note</span>
          <textarea
            className={`${input} h-24 resize-y`}
            value={cfg.deal_context}
            onChange={(e) => set("deal_context", e.target.value)}
            placeholder="Anything agreed on calls / WhatsApp that isn't in the contract (e.g. 'gave a sharper rate', 'they want to start before Diwali')."
          />
          <p className="mt-1 text-[11px] text-slate-500">Shown to the AI as context only — never treated as a contract term. Names and emails are masked before any AI call.</p>
        </div>
        {versions && versions.length > 0 && (
          <div>
            <span className={label}>Previous versions</span>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {versions.map((v) => (
                <li key={v.version}>
                  v{v.version} · {new Date(v.at).toLocaleString("en-GB")}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-slate-500">A re-review always reads the full document — never just a diff.</p>
          </div>
        )}
        <div className="rounded-md bg-slate-50 p-2.5 text-[11px] text-slate-600">
          AI: {ai.provider === "none" ? "no API key configured — the review will run deterministic checks only and be marked incomplete." : `${ai.provider} / ${ai.model}`}
        </div>
      </div>
      <div className="flex gap-2 border-t border-slate-200 px-5 py-3">
        <button
          disabled={running}
          onClick={() => onRun(cfg)}
          className="flex-1 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          {running ? "Running…" : "Run review"}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
