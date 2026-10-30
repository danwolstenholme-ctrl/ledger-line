import "server-only";

import { one, sql } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import type { SupplierRow } from "@/types/database";
import { logoFor, styleFor } from "./document-styles";

/**
 * A remittance advice: what the company paid one supplier, on which day,
 * and which of their invoices it settles. One for each supplier in a
 * payment run, or for a single payment against a bill.
 */

export type RemittanceTarget = { runId: string; supplierId: string } | { paymentId: string };
type Line = { id: string; bill_id: string; number: string | null; issued_on: string; total: number; amount: number; paid_on: string; reference: string | null; supplier_id: string; bank_name: string };

export async function getRemittance(target: RemittanceTarget) {
  const org = await requireOrg();
  const lines = await sql<Line>(`
    select p.id, b.id as bill_id, b.number, b.issued_on, b.total, p.amount, p.paid_on, coalesce(r.reference, p.reference) as reference, b.supplier_id, a.name as bank_name
      from bill_payments p join bills b on b.id = p.bill_id join ledger_accounts a on a.id = p.bank_account_id left join bill_payment_runs r on r.id = p.run_id
     where p.organisation_id = $1 and ${"runId" in target ? "p.run_id = $2 and b.supplier_id = $3" : "p.id = $2"}
     order by b.issued_on, b.number`, "runId" in target ? [org.id, target.runId, target.supplierId] : [org.id, target.paymentId]);
  if (!lines.length) return null;
  const [supplier, logo, style] = await Promise.all([
    one<SupplierRow>("select * from suppliers where id = $1 and organisation_id = $2", [lines[0].supplier_id, org.id]),
    logoFor(org.id),
    styleFor(org.id),
  ]);
  if (!supplier) return null;
  return {
    org, supplier, logo, style, language: org.document_language,
    paidOn: lines[0].paid_on, reference: lines[0].reference, bankName: lines[0].bank_name,
    lines: lines.map(line => ({ ...line, total: Number(line.total), amount: Number(line.amount) })),
    total: lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0) / 100,
  };
}
export type RemittanceData = NonNullable<Awaited<ReturnType<typeof getRemittance>>>;
