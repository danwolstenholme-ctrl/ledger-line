import type { Metadata } from "next";

import { getSalesFormData } from "@/lib/data/sales";
import { addDays } from "@/lib/domain/invoice-math";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { DocumentForm } from "@/components/sales/document-form";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const data = await getSalesFormData("quote");
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="New quote" back={{ href: "/accounts/quotes", label: "Quotes" }} description="A price for the customer to accept. Nothing posts to the books until it becomes an invoice." />
    <Panel className="p-4 sm:p-5">
      <DocumentForm kind="quote" customers={data.customers} accounts={data.accounts} items={data.items} banks={data.banks} defaultBank={data.org.default_bank_account_id} salesAccount={data.salesAccount} number={data.number} today={data.today} due={addDays(data.today, 30)}
        terms={data.org.payment_terms_days} registered={data.org.vat_registered} presetCustomer={params.customer} cancelHref="/accounts/quotes" />
    </Panel>
  </PageBody>;
}
