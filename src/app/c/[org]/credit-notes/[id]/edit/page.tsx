import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getCreditNote, getCreditNoteFormData } from "@/lib/data/sales";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { CreditNoteForm } from "@/components/sales/credit-note-form";
import { editorSaleLines } from "@/lib/domain/sale-lines";

export const metadata: Metadata = { title: "Edit credit note" };

/** Only a draft changes. An issued credit note is voided and raised again. */
export default async function EditCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getCreditNote(id);
  if (!data) notFound();
  const { credit, lines, org } = data;
  if (credit.status !== "draft") redirect(`/c/${org.slug}/credit-notes/${id}`);
  const form = await getCreditNoteFormData(credit.invoice_id);
  const invoice = form.invoice;
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={`Edit credit note ${credit.number}`} back={{ href: `/accounts/credit-notes/${id}`, label: credit.number }} description="A draft: nothing has posted yet." />
    <Panel className="p-4 sm:p-5">
      <CreditNoteForm customers={form.customers} accounts={form.accounts} items={form.items} salesAccount={form.salesAccount} number={credit.number} today={form.today}
        registered={org.vat_registered} cancelHref={`/accounts/credit-notes/${id}`}
        invoice={invoice ? { id: invoice.id, number: invoice.number, customer_id: invoice.customer_id, vat_treatment: invoice.vat_treatment, total: Number(invoice.total),
          balance: Number(invoice.balance), credited_before: Number(invoice.credited_before), lines: editorSaleLines(invoice.lines) } : null}
        document={{ id, customer_id: credit.customer_id, invoice_id: credit.invoice_id, number: credit.number, issued_on: credit.issued_on, vat_treatment: credit.vat_treatment, reason: credit.reason, notes: credit.notes, lines: editorSaleLines(lines) }} />
    </Panel>
  </PageBody>;
}
