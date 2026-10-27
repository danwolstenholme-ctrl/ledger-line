import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCreditNoteFormData } from "@/lib/data/sales";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { CreditNoteForm } from "@/components/sales/credit-note-form";
import { editorSaleLines } from "@/lib/domain/sale-lines";

export const metadata: Metadata = { title: "New credit note" };

/** A credit note, raised from the invoice it corrects (`?invoice=`), or on its own for a customer (`?customer=`). */
export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const data = await getCreditNoteFormData(params.invoice ?? null);
  // Asked for an invoice that cannot be credited (a draft, a void one, or another company's): back to the invoices.
  if (params.invoice && !data.invoice) redirect(`/c/${data.org.slug}/sales`);
  const invoice = data.invoice;
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="New credit note" back={invoice ? { href: `/invoices/${invoice.id}`, label: invoice.number } : { href: "/accounts/credit-notes", label: "Credit notes" }}
      description={invoice ? `Takes back some or all of invoice ${invoice.number} to ${invoice.client_name}.` : "A credit for a customer, not tied to one invoice."} />
    <Panel className="p-4 sm:p-5">
      <CreditNoteForm customers={data.customers} accounts={data.accounts} items={data.items} salesAccount={data.salesAccount} number={data.number} today={data.today}
        registered={data.org.vat_registered} cancelHref={invoice ? `/invoices/${invoice.id}` : "/accounts/credit-notes"}
        invoice={invoice ? { id: invoice.id, number: invoice.number, customer_id: invoice.customer_id, vat_treatment: invoice.vat_treatment, total: Number(invoice.total),
          balance: Number(invoice.balance), credited_before: Number(invoice.credited_before), lines: editorSaleLines(invoice.lines) } : null} />
    </Panel>
  </PageBody>;
}
