"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { Clause, Finding, Severity } from "@/lib/types";
import { SEV_BAR } from "../ui";

const SEV_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function inlineBold(s: string, key: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${key}-${i}`} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${key}-${i}`}>{part}</Fragment>
    ),
  );
}

function quoteRegex(quote: string): RegExp | null {
  const words = quote.replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/["“”]/g, '["“”]').replace(/['‘’]/g, "['‘’]"));
  return new RegExp(esc.join("\\s+"), "i");
}

function Table({ lines }: { lines: string[] }) {
  const rows = lines.filter((l) => !/^\|\s*-{2,}/.test(l)).map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const [head, ...body] = rows;
  return (
    <div className="my-1 overflow-x-auto">
      <table className="w-full border-collapse font-sans text-[12.5px]">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-700">
                {inlineBold(c, `h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className="border border-slate-200 px-2 py-1 text-slate-700">
                  {inlineBold(c, `c${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClauseBody({ text, quote }: { text: string; quote?: string }) {
  if (quote) {
    const plain = text.replace(/\*\*/g, "");
    const re = quoteRegex(quote);
    const m = re ? re.exec(plain) : null;
    if (m) {
      return (
        <div className="whitespace-pre-wrap">
          {plain.slice(0, m.index)}
          <mark className="rounded-sm bg-yellow-200 px-0.5 text-slate-900">{plain.slice(m.index, m.index + m[0].length)}</mark>
          {plain.slice(m.index + m[0].length)}
        </div>
      );
    }
  }
  // light markdown: tables + bold + line breaks
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let table: string[] = [];
  const flush = () => {
    if (table.length) out.push(<Table key={`t${out.length}`} lines={table} />);
    table = [];
  };
  lines.forEach((l, i) => {
    if (/^\s*\|/.test(l)) table.push(l.trim());
    else {
      flush();
      out.push(
        <div key={i} className={/^\s*(\([a-z]{1,4}\)|[-*]\s)/.test(l) ? "pl-5" : ""}>
          {inlineBold(l.replace(/^[-*]\s/, "• "), `l${i}`)}
        </div>,
      );
    }
  });
  flush();
  return <>{out}</>;
}

export function ContractPane({
  title,
  provenance,
  clauses,
  findings,
  selected,
  onSelectClause,
}: {
  title: string;
  provenance: string | null;
  clauses: Clause[];
  findings: Finding[];
  selected: Finding | null;
  onSelectClause: (clauseId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const byClause = new Map<string, Finding[]>();
  findings.forEach((f) => f.contract_clause_id && byClause.set(f.contract_clause_id, [...(byClause.get(f.contract_clause_id) ?? []), f]));

  useEffect(() => {
    if (!selected?.contract_clause_id) return;
    const el = document.getElementById(selected.contract_clause_id);
    if (el && ref.current) {
      const top = el.offsetTop - 80;
      ref.current.scrollTo({ top, behavior: "smooth" });
    }
  }, [selected]);

  let lastHeading = "";
  return (
    <div ref={ref} className="scroll-thin relative h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-3xl py-6 pl-20 pr-8">
        {provenance && (
          <div className="mb-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs italic text-slate-500">
            Document note (not part of the contract): {provenance}
          </div>
        )}
        <h2 className="mb-4 text-center font-serif text-lg font-semibold tracking-wide text-slate-900">{title}</h2>
        <div className="contract-text">
          {clauses.map((c) => {
            const fs = (byClause.get(c.id) ?? []).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
            const isSel = selected?.contract_clause_id === c.id;
            const showHeading = c.heading !== lastHeading && c.heading !== title;
            lastHeading = c.heading;
            return (
              <Fragment key={c.id}>
                {showHeading && <h3 className="mb-1 mt-5 font-sans text-[12px] font-semibold uppercase tracking-wider text-slate-500">{c.heading}</h3>}
                <div
                  id={c.id}
                  onClick={() => fs.length && onSelectClause(c.id)}
                  className={`group relative -mx-3 my-0.5 rounded px-3 py-1.5 ${isSel ? `clause-hl-${selected!.severity}` : fs.length ? "cursor-pointer hover:bg-slate-50" : ""}`}
                >
                  <div className="absolute -left-14 top-2 w-12 text-right font-mono text-[10px] text-slate-400">{c.ref}</div>
                  {fs.length > 0 && (
                    <div className="absolute -left-1 top-2 flex flex-col gap-0.5" title={fs.map((f) => `${f.severity}: ${f.title}`).join("\n")}>
                      {fs.slice(0, 3).map((f) => (
                        <span key={f.id} className={`block h-2 w-2 rounded-full ${SEV_BAR[f.severity]}`} />
                      ))}
                    </div>
                  )}
                  <ClauseBody text={c.text} quote={isSel ? selected!.contract_quote : undefined} />
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
