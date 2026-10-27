import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireOrg } from "@/lib/org";
import { getBill, getLedgerAccounts, getSuppliers } from "@/lib/data/accounts";
import { firmToday } from "@/lib/domain/invoices";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody, Panel } from "@/components/common/primitives";
import { BillForm } from "@/components/accounts/forms";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Edit bill" };

/** Only an unpaid bill can be edited; the database refuses the rest. */
export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrg();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [result, accounts, suppliers] = await Promise.all([getBill(id), getLedgerAccounts(), getSuppliers()]);
  if (result.failed || accounts.failed || suppliers.failed) return <PageBody><RecordFailure what="this bill" /></PageBody>;
  const bill = result.bill;
  if (!bill) notFound();
  const plain = (value: number | string) => Number(value).toFixed(2);
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title="Edit bill" description={`${bill.supplier_name}${bill.number ? ` · ${bill.number}` : ""}`} back={{ href: `/accounts/bills/${bill.id}`, label: "Bill" }} />
    <Panel className="p-4 sm:p-5">
      <BillForm today={firmToday()} accounts={accounts.rows} suppliers={suppliers.rows.filter(item => item.is_active || item.id === bill.supplier_id)}
        bill={{
          id: bill.id, supplier_id: bill.supplier_id, number: bill.number, reference: bill.reference, issued_on: bill.issued_on, due_on: bill.due_on,
          notes: bill.notes, source_document: bill.source_document, reverse_charge: bill.reverse_charge, reverse_charge_kind: bill.reverse_charge_kind,
          lines: result.lines.map(line => ({ description: line.description, account_id: line.account_id, net: plain(line.net), vat_rate: Number(line.vat_rate), vat_amount: plain(line.vat_amount) })),
        }} />
    </Panel>
  </PageBody>;
}
