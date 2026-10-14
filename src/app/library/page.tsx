import { DocStatusChip, PageHeader } from "@/components/ui";
import { loadRegister, loadSignedDocs, signedDocStatus } from "@/lib/data";
import { fmtDate } from "@/lib/labels";


export default function LibraryPage() {
  const { documents } = loadSignedDocs();
  const register = loadRegister();
  return (
    <div>
      <PageHeader
        title="Signed library"
        subtitle="The authorised historical sources the analyzer retrieves from: 17 executed documents (with status), negotiation notes and meeting notes. Drafts and notes are never treated as binding commitments."
      />
      <div className="px-6 py-5">
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Document</th>
                <th className="px-3 py-2.5">Entity</th>
                <th className="px-3 py-2.5">Signed</th>
                <th className="px-3 py-2.5">Expiry</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Commitments</th>
                <th className="px-3 py-2.5">Where it was found</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents
                .sort((a, b) => (b.signed ?? "").localeCompare(a.signed ?? ""))
                .map((d) => {
                  const n = register.filter((c) => c.source_file === d.file).length;
                  return (
                    <tr key={d.file} className="align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{d.counterparty}</div>
                        <div className="text-xs text-slate-500">
                          {d.doc_type} · {d.sector} · {d.country} · {d.tracker_ids.join(", ")}
                        </div>
                        {d.notes && <div className="mt-0.5 text-[11px] italic text-slate-500">{d.notes}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{d.atliq_entity}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDate(d.signed)}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDate(d.expiry)}</td>
                      <td className="px-3 py-2.5">
                        <DocStatusChip s={signedDocStatus(d)} />
                      </td>
                      <td className="px-3 py-2.5 text-xs">{n ? <a href="/register" className="text-brand-700 underline">{n} in register</a> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{d.stored}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Also searched: negotiation_notes.md (unreviewed reconstruction) and four meeting notes — labelled as notes, not contracts, wherever they are cited.
        </p>
      </div>
    </div>
  );
}
