import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";

import { getPaymentsToInvoice, MAX_PAYMENTS } from "@/lib/data/bank-invoicing";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody } from "@/components/common/primitives";
import { RecordEmpty, RecordHeader } from "@/components/records/record-layout";
import { RaiseInvoices } from "@/components/bank/raise-invoices";

export const metadata: Metadata = { title: "Invoice money received" };

/** Money received with nothing in the books for it, each to become an invoice to its payer and be matched to it: `?line=` for one. */
export default async function InvoicePaymentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ line?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(id)) notFound();
  const line = query.line && UUID_PATTERN.test(query.line) ? query.line : null;
  const data = await getPaymentsToInvoice(id, line);
  if (!data) notFound();
  const { bank, payments } = data;
  return <PageBody className="space-y-4">
    <RecordHeader eyebrow={bank.name} title="Invoice money received" back={{ href: `/accounts/bank/${bank.id}`, label: "Reconcile" }}
      description={payments.length && !data.single ? `${data.total} payment${data.total === 1 ? "" : "s"} in with nothing in the books for ${data.total === 1 ? "it" : "them"}${data.total > payments.length ? `, the first ${MAX_PAYMENTS} here` : ""}${data.closed ? ` · ${data.closed} more from before the books began or the lock date` : ""}` : undefined} />
    {payments.length ? <RaiseInvoices bankAccountId={bank.id} payments={payments} customers={data.customers} rates={data.rates} registered={data.registered} currency={data.currency} country={data.country} latestRaised={data.latestRaised} opening={data.opening} />
      : data.single ? <div className="ll-panel"><RecordEmpty title="Matched already">That payment is matched to something in the books now, or set aside. <Link href={`/accounts/bank/${bank.id}/invoices`} className="text-brand hover:underline">See the others</Link></RecordEmpty></div>
      : <div className="ll-panel"><RecordEmpty title="Nothing to invoice">Every payment into {bank.name} is matched to something in the books, or set aside{data.closed ? `, but ${data.closed} from before the books began or the lock date` : ""}.</RecordEmpty></div>}
  </PageBody>;
}
