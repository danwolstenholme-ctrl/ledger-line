import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Pencil, Trash2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { deleteDraftCreditNote, removeAllocation, removeRefund } from "@/lib/actions/sales";
import { getPostings } from "@/lib/data/accounts";
import { getCreditNote } from "@/lib/data/sales";
import { countryName } from "@/lib/domain/countries";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { MoreMenu } from "@/components/common/more-menu";
import { InlineSubmit, SubmitButton } from "@/components/common/form-fields";
import { Postings } from "@/components/accounts/postings";
import { RecordDetail, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { AllocateCreditForm, CreditNoteVoidButton, IssueCreditNoteButton, RefundCreditForm } from "@/components/sales/credit-actions";
import { CreditNoteStatusBadge, DocumentLines, PdfLinks, TREATMENT_LABELS } from "@/components/sales/sales-parts";

export const metadata: Metadata = { title: "Credit note" };

/** One credit note: what it took back and why, and where the credit went: against invoices, refunded, or still to use. */
export default async function CreditNotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, query] = await Promise.all([getCreditNote(id), searchParams]);
  if (!data) notFound();
  const { org, credit, lines, customer, allocations, refunds, openInvoices, banks, today } = data;
  const postings = await getPostings([id, ...refunds.map(refund => refund.id)]);
  const remaining = Number(credit.remaining);
  const issued = credit.status === "issued";

  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title={`Credit note ${credit.number}`} back={{ href: "/accounts/credit-notes", label: "Credit notes" }}
      description={`${credit.client_name} · ${formatDate(credit.issued_on)} · ${credit.reason}`}
      action={<>
        <CreditNoteStatusBadge status={credit.status} remaining={remaining} />
        {credit.status !== "void" ? <PdfLinks href={`/c/${org.slug}/credit-notes/${id}/pdf`} /> : null}
        {credit.status === "draft" ? <Link href={`/accounts/credit-notes/${id}/edit`} className={recordOutlineButton}><Pencil className="size-3.5" />Edit</Link> : null}
        {credit.status === "draft" ? <IssueCreditNoteButton id={id} /> : null}
        {issued ? <MoreMenu items={[{ href: `/c/${org.slug}/credit-notes/${id}/ubl`, label: "E-invoice (XML)", hint: "UBL credit note, EN 16931 and Peppol BIS 3.0", icon: "xml", download: true }]} /> : null}
      </>} />

    {query.issued && issued ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]">
      <CheckCircle2 className="size-4 shrink-0" /><span><span className="font-medium">Issued and in the books.</span> {allocations.length ? `${formatAmount(credit.amount_allocated)} came off invoice ${allocations.map(item => item.number).join(", ")}.` : "The credit is kept for this customer."}{remaining > 0 ? ` ${formatAmount(remaining)} is left to use or refund.` : ""}</span>
    </p> : null}
    {credit.status === "draft" ? <p className="border-hairline bg-surface-sunken text-ink-muted rounded-lg border px-4 py-2.5 text-[12.5px]">A draft: nothing is in the books until it is issued.</p> : null}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <RecordSection title="Credit note" hint={TREATMENT_LABELS[credit.vat_treatment]}>
          <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 text-[12.5px] leading-relaxed">
              <p className="ll-eyebrow mb-1">Credited to</p>
              <Link href={`/accounts/customers/${credit.customer_id}`} className="text-ink hover:text-brand text-[13.5px] font-semibold">{credit.client_name}</Link>
              {customer?.address ? <p className="text-ink-muted whitespace-pre-line">{customer.address}</p> : null}
              {customer && customer.country !== "CY" ? <p className="text-ink-muted">{countryName(customer.country)}</p> : null}
              {credit.client_vat_number ? <p className="text-ink-muted font-mono text-[12px]">VAT {credit.client_vat_number}</p> : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 self-start text-[12.5px] sm:grid-cols-1 sm:text-right">
              <div><dt className="ll-eyebrow">Date</dt><dd className="text-ink">{formatDate(credit.issued_on)}</dd></div>
              {credit.invoice_id ? <div><dt className="ll-eyebrow">Credits invoice</dt><dd><Link href={`/invoices/${credit.invoice_id}`} className="text-brand font-mono hover:underline">{credit.invoice_number}</Link></dd></div> : null}
            </dl>
          </div>
          <DocumentLines lines={lines} treatment={credit.vat_treatment} registered={org.vat_registered} net={Number(credit.net)} total={Number(credit.total)} totalLabel="Total credit" />
          {credit.notes ? <p className="border-hairline text-ink-muted border-t px-4 py-3 text-[12.5px] whitespace-pre-line">{credit.notes}</p> : null}
        </RecordSection>
        {credit.status !== "draft" ? <details className="group">
          <summary className="text-ink-muted hover:text-brand cursor-pointer px-1 text-[12.5px] font-medium">How it posted to the books</summary>
          <div className="mt-2"><Postings entries={postings.entries} empty={credit.status === "void" ? "A void credit note is not in the books." : "Nothing posted."} /></div>
        </details> : null}
      </div>

      <div className="min-w-0 space-y-4">
        {issued ? <RecordSection title={remaining > 0 ? "Credit to use" : "Credit used"}>
          <div className="px-4 py-3.5">
            <p className="text-ink text-[22px] leading-tight font-semibold tabular-nums">{formatAmount(remaining)}</p>
            <p className="text-ink-muted mt-0.5 text-[12px]">left of {formatAmount(credit.total)}{Number(credit.amount_allocated) ? ` · ${formatAmount(credit.amount_allocated)} set against invoices` : ""}{Number(credit.amount_refunded) ? ` · ${formatAmount(credit.amount_refunded)} refunded` : ""}</p>
          </div>
          {allocations.length || refunds.length ? <ul aria-label="Where the credit went" className="divide-hairline border-hairline divide-y border-t">
            {allocations.map(item => <li key={item.id} className="flex items-baseline gap-3 px-4 py-2">
              <span className="text-ink-muted w-24 shrink-0 text-[12px] tabular-nums">{formatDate(item.allocated_on)}</span>
              <span className="min-w-0 flex-1 truncate text-[12px]">Against <Link href={`/invoices/${item.invoice_id}`} className="text-brand font-mono hover:underline">{item.number}</Link></span>
              <span className="text-ink shrink-0 text-[12.5px] font-medium tabular-nums">{formatAmount(item.amount)}</span>
              <form action={removeAllocation}><input type="hidden" name="id" value={item.id} /><InlineSubmit destructive title="Take the credit off this invoice">Remove</InlineSubmit></form>
            </li>)}
            {refunds.map(item => <li key={item.id} className="flex items-baseline gap-3 px-4 py-2">
              <span className="text-ink-muted w-24 shrink-0 text-[12px] tabular-nums">{formatDate(item.txn_date)}</span>
              <span className="text-ink-muted min-w-0 flex-1 truncate text-[12px]">Refunded from {item.bank_name}</span>
              <span className="text-ink shrink-0 text-[12.5px] font-medium tabular-nums">{formatAmount(item.amount)}</span>
              {item.matched ? <span className="text-positive text-[11px]">Reconciled</span>
                : <form action={removeRefund}><input type="hidden" name="id" value={item.id} /><InlineSubmit destructive title="Remove this refund">Remove</InlineSubmit></form>}
            </li>)}
          </ul> : null}
          {remaining > 0 ? <>
            <div className="border-hairline border-t px-4 py-3.5">
              <p className="text-ink mb-2.5 text-[13px] font-semibold">Use it against an invoice</p>
              <AllocateCreditForm creditNoteId={id} remaining={remaining} invoices={openInvoices.map(item => ({ ...item, balance: Number(item.balance) }))} />
            </div>
            <div className="border-hairline border-t px-4 py-3.5">
              <p className="text-ink mb-2.5 text-[13px] font-semibold">Or refund it</p>
              <RefundCreditForm creditNoteId={id} remaining={remaining} banks={banks} defaultBank={org.default_bank_account_id} today={today} />
            </div>
          </> : null}
        </RecordSection> : null}

        <RecordSection title="Details">
          <dl className="divide-hairline divide-y px-4">
            <RecordDetail label="Customer" value={<Link href={`/accounts/customers/${credit.customer_id}`} className="text-brand hover:underline">{credit.client_name}</Link>} />
            <RecordDetail label="Reason" value={credit.reason} />
            <RecordDetail label="VAT" value={credit.vat_treatment === "standard" && org.vat_registered ? `${formatAmount(credit.vat_amount)} comes off the VAT due in the period of ${formatDate(credit.issued_on)}` : "No VAT was charged, so none comes back"} />
          </dl>
          {credit.status === "draft" ? <form action={deleteDraftCreditNote} className="border-hairline border-t px-4 py-3"><input type="hidden" name="id" value={id} />
            <SubmitButton variant="outline" size="sm" pendingLabel="Deleting…"><Trash2 className="size-3.5" />Delete this draft</SubmitButton>
          </form> : <div className="border-hairline border-t px-4 py-3"><CreditNoteVoidButton id={id} isVoid={credit.status === "void"} /></div>}
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
