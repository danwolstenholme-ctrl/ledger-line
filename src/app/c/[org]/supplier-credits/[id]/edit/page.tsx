import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getSupplierCredit, getSupplierCreditFormData } from "@/lib/data/purchases";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { SupplierCreditForm } from "@/components/purchases/supplier-credit-form";

export const metadata: Metadata = { title: "Edit supplier credit" };

const plain = (value: number | string) => Number(value).toFixed(2);

/** A recorded credit note can be corrected until it has been refunded: saving sets it against its bill again. */
export default async function EditSupplierCreditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getSupplierCredit(id);
  if (!data) notFound();
  const { credit, lines, refunds, org } = data;
  if (credit.status === "void" || refunds.length) redirect(`/c/${org.slug}/supplier-credits/${id}`);
  const form = await getSupplierCreditFormData(credit.bill_id);
  const bill = form.bill;
  const toLines = (rows: { description: string; account_id: string; net: number | string; vat_rate: number | string; vat_amount: number | string }[]) =>
    rows.map(line => ({ description: line.description, account_id: line.account_id, net: plain(line.net), vat_rate: Number(line.vat_rate), vat_amount: plain(line.vat_amount) }));
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title={`Edit credit note${credit.number ? ` ${credit.number}` : ""}`} back={{ href: `/accounts/supplier-credits/${id}`, label: credit.supplier_name }} />
    <Panel className="p-4 sm:p-5">
      <SupplierCreditForm suppliers={form.suppliers} accounts={form.accounts} today={form.today} cancelHref={`/accounts/supplier-credits/${id}`}
        bill={bill ? { id: bill.id, number: bill.number, supplier_id: bill.supplier_id, supplier_name: bill.supplier_name, total: Number(bill.total), balance: Number(bill.balance) + Number(credit.amount_allocated),
          credited_before: Number(bill.credited_before) - Number(credit.total), reverse_charge: bill.reverse_charge, lines: toLines(bill.lines) } : null}
        credit={{ id, supplier_id: credit.supplier_id, bill_id: credit.bill_id, number: credit.number, issued_on: credit.issued_on, reverse_charge: credit.reverse_charge, notes: credit.notes, lines: toLines(lines) }} />
    </Panel>
  </PageBody>;
}
