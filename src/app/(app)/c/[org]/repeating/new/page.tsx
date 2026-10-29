import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getInvoice } from "@/lib/data/sales";
import { addDays } from "@/lib/domain/invoice-math";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader, RecordSection } from "@/components/records/record-layout";
import { RepeatingForm } from "@/components/sales/repeating-forms";
import { DocumentLines } from "@/components/sales/sales-parts";

export const metadata: Metadata = { title: "Repeat an invoice" };

/** Repeat an invoice (`?invoice=`): its customer, VAT and lines, raised again on a schedule. */
export default async function NewRepeatingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invoice: invoiceId } = await searchParams;
  if (!invoiceId || !UUID_PATTERN.test(invoiceId)) notFound();
  const data = await getInvoice(invoiceId);
  if (!data || data.invoice.status === "void") notFound();
  const { invoice, lines, org, today } = data;
  // A month after this invoice, or a month from today if that has passed.
  const month = (date: string) => {
    const [year, mon, day] = date.split("-").map(Number);
    const last = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, mon, Math.min(day, last))).toISOString().slice(0, 10);
  };
  const next = month(invoice.issued_on) >= today ? month(invoice.issued_on) : month(today);
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title={`Repeat ${invoice.number}`} back={{ href: `/invoices/${invoice.id}`, label: invoice.number }}
      description={`To ${invoice.client_name}, ${formatAmount(invoice.total)} each time.`} />
    <Panel className="p-4 sm:p-5">
      <RepeatingForm today={today} values={{ invoice_id: invoice.id, name: lines[0]?.description ?? `Invoice to ${invoice.client_name}`, every_months: 1, next_on: next < addDays(today, 1) ? addDays(today, 1) : next, ends_on: null, issue: true }} />
    </Panel>
    <RecordSection title="Each invoice" hint="these lines, at these prices">
      <DocumentLines lines={lines} treatment={invoice.vat_treatment} registered={org.vat_registered} net={Number(invoice.net)} total={Number(invoice.total)} />
    </RecordSection>
  </PageBody>;
}
