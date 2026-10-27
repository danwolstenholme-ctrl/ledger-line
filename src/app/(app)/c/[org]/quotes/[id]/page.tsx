import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getQuote } from "@/lib/data/sales";
import { countryName } from "@/lib/domain/countries";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordDetail, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { QuoteActions } from "@/components/sales/sale-actions";
import { DocumentLines, PdfLinks, QuoteStatusBadge, TREATMENT_LABELS, treatmentDetail } from "@/components/sales/sales-parts";

export const metadata: Metadata = { title: "Quote" };

/** One quote, and the one decision on it: did the customer accept? */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getQuote(id);
  if (!data) notFound();
  const { org, quote, lines, customer } = data;
  const open = quote.status === "draft" || quote.status === "sent";
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title={`Quote ${quote.number}`} back={{ href: "/accounts/quotes", label: "Quotes" }} description={`${quote.client_name} · ${formatDate(quote.issued_on)}`}
      action={<>
        <QuoteStatusBadge status={quote.status} expired={quote.expired} />
        <PdfLinks href={`/c/${org.slug}/quotes/${id}/pdf`} />
        {open ? <Link href={`/accounts/quotes/${id}/edit`} className={recordOutlineButton}><Pencil className="size-3.5" />Edit</Link> : null}
      </>} />

    {quote.status === "accepted" && quote.invoice_id ? <p role="status" className="border-positive-line bg-positive-soft text-positive rounded-lg border px-4 py-2.5 text-[12.5px]">
      Accepted{quote.accepted_on ? ` on ${formatDate(quote.accepted_on)}` : ""} and invoiced as <Link href={`/invoices/${quote.invoice_id}`} className="font-mono font-medium underline">{quote.invoice_number}</Link>.
    </p> : null}
    {open ? <section className="ll-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-ink text-[12.5px]"><span className="font-medium">Has {quote.client_name} accepted?</span> <span className="text-ink-muted">The invoice is raised with these lines, numbered and dated today.</span></p>
      <QuoteActions id={id} status={quote.status} />
    </section> : quote.status === "declined" ? <section className="ll-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-ink-muted text-[12.5px]">Declined. Reopen it if the customer comes back.</p><QuoteActions id={id} status={quote.status} />
    </section> : null}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <RecordSection title="Quote" hint={TREATMENT_LABELS[quote.vat_treatment]}>
        <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 text-[12.5px] leading-relaxed">
            <p className="ll-eyebrow mb-1">Prepared for</p>
            <Link href={`/accounts/customers/${quote.customer_id}`} className="text-ink hover:text-brand text-[13.5px] font-semibold">{quote.client_name}</Link>
            {customer?.address ? <p className="text-ink-muted whitespace-pre-line">{customer.address}</p> : null}
            {customer && customer.country !== "CY" ? <p className="text-ink-muted">{countryName(customer.country)}</p> : null}
            {quote.client_vat_number ? <p className="text-ink-muted font-mono text-[12px]">VAT {quote.client_vat_number}</p> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 self-start text-[12.5px] sm:grid-cols-1 sm:text-right">
            <div><dt className="ll-eyebrow">Date</dt><dd className="text-ink">{formatDate(quote.issued_on)}</dd></div>
            <div><dt className="ll-eyebrow">Valid until</dt><dd className={cn(quote.expired && open ? "text-caution font-medium" : "text-ink")}>{quote.valid_until ? formatDate(quote.valid_until) : "No end date"}</dd></div>
          </dl>
        </div>
        <DocumentLines lines={lines} treatment={quote.vat_treatment} registered={org.vat_registered} net={Number(quote.net)} total={Number(quote.total)} />
        {quote.notes ? <p className="border-hairline text-ink-muted border-t px-4 py-3 text-[12.5px] whitespace-pre-line">{quote.notes}</p> : null}
      </RecordSection>
      <RecordSection title="Details">
        <dl className="divide-hairline divide-y px-4">
          <RecordDetail label="Customer" value={<Link href={`/accounts/customers/${quote.customer_id}`} className="text-brand hover:underline">{quote.client_name}</Link>} />
          <RecordDetail label="VAT" value={treatmentDetail(org.vat_registered ? quote.vat_treatment : "exempt", org.country)} />
          <RecordDetail label="In the books" value="Nothing: a quote posts nothing until it is accepted and invoiced." />
        </dl>
      </RecordSection>
    </div>
  </PageBody>;
}
