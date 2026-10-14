import { RegisterTable, type RegisterRow } from "@/components/RegisterTable";
import { datasetToday } from "@/lib/config";
import { commitmentStatus, loadRegister, readRaw } from "@/lib/data";
import { isGrounded } from "@/lib/text";


export default function RegisterPage() {
  const today = datasetToday();
  const rows: RegisterRow[] = loadRegister().map((c) => ({
    id: c.id,
    type: c.type,
    counterparty: c.counterparty,
    scope: c.scope,
    sectors: c.sectors,
    geographies: c.geographies,
    binds_affiliates: c.binds_affiliates,
    atliq_entity: c.atliq_entity,
    end: c.end ?? null,
    end_note: c.end_note ?? null,
    status: commitmentStatus(c, today),
    source_file: c.source_file,
    clause_ref: c.clause_ref,
    quote: c.quote,
    grounded: isGrounded(c.quote, readRaw(c.source_file)),
    checkable: c.matcher.kind !== "none",
    conflict_note: c.conflict_note,
  }));
  return <RegisterTable rows={rows} today={today} />;
}
