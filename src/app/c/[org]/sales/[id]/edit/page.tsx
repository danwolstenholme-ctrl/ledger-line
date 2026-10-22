import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getInvoice, getSalesFormData } from "@/lib/data/sales";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { DocumentForm } from "@/components/sales/document-form";
import { editorSaleLines } from "@/lib/domain/sale-lines";

export const metadata: Metadata = { title: "Edit invoice" };

/** A draft, or an issued invoice nothing has been paid or credited against. Anything else is corrected with a credit note, not an edit. */
export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, form] = await Promise.all([getInvoice(id), getSalesFormData("invoice")]);
  if (!data) notFound();
  const { invoice, lines, org } = data;
  if (!(invoice.status === "draft" || (invoice.status === "issued" && Number(invoice.amount_paid) === 0 && Number(invoice.amount_credited) === 0))) redirect(`/c/${org.slug}/sales/${id}`);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={`Edit invoice ${invoice.number}`} back={{ href: `/invoices/${id}`, label: invoice.number }}
      description={invoice.status === "draft" ? "A draft: nothing has posted yet." : "Issued and unpaid: saving reposts it to the books with the new figures."} />
    <Panel className="p-4 sm:p-5">
      <DocumentForm kind="invoice" customers={form.customers} accounts={form.accounts} items={form.items} banks={form.banks} defaultBank={org.default_bank_account_id}
        salesAccount={form.salesAccount} number={invoice.number} today={form.today} due={form.due} terms={org.payment_terms_days} registered={org.vat_registered} cancelHref={`/invoices/${id}`}
        document={{ id, status: invoice.status, customer_id: invoice.customer_id, number: invoice.number, issued_on: invoice.issued_on, due_on: invoice.due_on, vat_treatment: invoice.vat_treatment, notes: invoice.notes, reference: invoice.reference, lines: editorSaleLines(lines) }} />
    </Panel>
  </PageBody>;
}
