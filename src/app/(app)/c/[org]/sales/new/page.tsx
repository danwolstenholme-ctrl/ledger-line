import type { Metadata } from "next";

import { getCopySource, getSalesFormData } from "@/lib/data/sales";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { DocumentForm } from "@/components/sales/document-form";
import { editorSaleLines } from "@/lib/domain/sale-lines";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("New invoice") };
}

/** A new invoice: blank, for a customer (`?customer=`), or a copy of another (`?copy=`) with its own number and dates. */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const [data, copy, { t }] = await Promise.all([getSalesFormData("invoice"), getCopySource(params.copy), getI18n()]);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={t("New invoice")} back={{ href: "/invoices", label: t("Invoices") }}
      description={copy ? t("A copy of {number} to {name}, with a new number and today's date.", { number: copy.invoice.number, name: copy.invoice.client_name })
        : t("From {company}. The number follows on from the last one, and the due date follows the customer's payment terms.", { company: data.org.name })} />
    <Panel className="p-4 sm:p-5">
      <DocumentForm kind="invoice" customers={data.customers} accounts={data.accounts} items={data.items} banks={data.banks} defaultBank={data.org.default_bank_account_id}
        salesAccount={data.salesAccount} number={data.number} today={data.today} due={data.due} terms={data.org.payment_terms_days} registered={data.org.vat_registered} presetCustomer={params.customer} cancelHref="/invoices"
        prefill={copy ? { customer_id: copy.invoice.customer_id, vat_treatment: copy.invoice.vat_treatment, notes: copy.invoice.notes?.replace(/\s*\(From quote [^)]*\.\)$/, "") ?? null, lines: editorSaleLines(copy.lines) } : undefined} />
    </Panel>
  </PageBody>;
}
