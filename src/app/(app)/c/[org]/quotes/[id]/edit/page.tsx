import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getQuote, getSalesFormData } from "@/lib/data/sales";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { DocumentForm } from "@/components/sales/document-form";
import { editorSaleLines } from "@/lib/domain/sale-lines";

export const metadata: Metadata = { title: "Edit quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, form] = await Promise.all([getQuote(id), getSalesFormData("quote")]);
  if (!data) notFound();
  const { quote, lines, org } = data;
  if (quote.status !== "draft" && quote.status !== "sent") redirect(`/c/${org.slug}/quotes/${id}`);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={`Edit quote ${quote.number}`} back={{ href: `/accounts/quotes/${id}`, label: quote.number }} />
    <Panel className="p-4 sm:p-5">
      <DocumentForm kind="quote" customers={form.customers} accounts={form.accounts} items={form.items} banks={form.banks} defaultBank={org.default_bank_account_id} salesAccount={form.salesAccount} number={quote.number} today={form.today} due={quote.valid_until ?? form.today}
        terms={org.payment_terms_days} registered={org.vat_registered} cancelHref={`/accounts/quotes/${id}`}
        document={{ id, status: quote.status, customer_id: quote.customer_id, number: quote.number, issued_on: quote.issued_on, due_on: quote.valid_until, vat_treatment: quote.vat_treatment, notes: quote.notes, lines: editorSaleLines(lines) }} />
    </Panel>
  </PageBody>;
}
