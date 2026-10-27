import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Pencil, Trash2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { deleteDraftInvoice, removeInvoicePayment } from "@/lib/actions/sales";
import { getPostings } from "@/lib/data/accounts";
import { getInvoice, getReminder } from "@/lib/data/sales";
import { countryName } from "@/lib/domain/countries";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { getI18n } from "@/lib/i18n/server";
import { shareMessage } from "@/lib/documents/messages";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { MoreMenu } from "@/components/common/more-menu";
import { InlineSubmit, SubmitButton } from "@/components/common/form-fields";
import { Postings } from "@/components/accounts/postings";
import { RecordDetail, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { InvoiceStatusButton, RecordPaymentForm, RestoreInvoiceButton } from "@/components/sales/sale-actions";
import { DocumentLines, InvoiceStatusBadge, PdfLinks, TREATMENT_LABELS, treatmentDetail } from "@/components/sales/sales-parts";
import { ReminderPanel } from "@/components/sales/reminder";
import { SendInvoicePanel, type SendInvoiceData } from "@/components/sales/send-invoice";
import { ShareLinkPanel } from "@/components/sales/share-link";
import { getDocumentLink } from "@/lib/data/document-links";
import { siteOrigin } from "@/lib/site";
import { answerView, latestChecks, vatKey } from "@/lib/vies";
import { VatCheckButton } from "@/components/vat/vat-check";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("Invoice") };
}

/** One invoice: what the customer was sent, what is still to collect, and the one thing to do next. */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, query, { t, formatAmount, formatDate }] = await Promise.all([getInvoice(id), searchParams, getI18n()]);
  if (!data) notFound();
  const { org, invoice, lines, payments, customer, quote, banks, credits, today } = data;
  const late = (invoice.status === "issued" || invoice.status === "part_paid") && invoice.days_overdue > 0;
  const sendable = invoice.status === "issued" || invoice.status === "part_paid" || invoice.status === "paid";
  const reverseCharge = invoice.vat_treatment === "reverse_charge";
  const vat = reverseCharge ? vatKey(invoice.client_vat_number, invoice.client_country) : null;
  const [postings, reminder, checks, link, origin] = await Promise.all([getPostings([id, ...payments.map(payment => payment.id)]), sendable ? getReminder(invoice.customer_id) : null, latestChecks(vat ? [vat] : []),
    sendable ? getDocumentLink("invoice", id) : null, siteOrigin()]);
  const balance = Number(invoice.balance), paid = Number(invoice.amount_paid), credited = Number(invoice.amount_credited);
  const open = invoice.status === "issued" || invoice.status === "part_paid";
  const editable = invoice.status === "draft" || (invoice.status === "issued" && paid === 0 && credited === 0);
  const creditable = (invoice.status === "issued" || invoice.status === "part_paid" || invoice.status === "paid") && credits.filter(item => item.raised_here).length < 20;
  const pdf = `/c/${org.slug}/sales/${id}/pdf`;
  // What the customer is sent is in their language, whatever this screen's.
  const language = customer?.document_language ?? org.document_language;
  const share = shareMessage(language, { kind: "invoice", number: invoice.number, company: org.name, amount: open ? balance : Number(invoice.total), currency: org.currency, date: invoice.due_on, paid: !open });
  const send: SendInvoiceData | null = reminder ? { invoiceId: id, number: invoice.number, total: Number(invoice.total), balance: Number(invoice.balance), dueOn: invoice.due_on,
    customerName: invoice.client_name, to: reminder.to, greeting: reminder.greeting, company: org.name, sender: reminder.sender, bank: reminder.bank, pdfHref: pdf, sentAt: invoice.sent_at, sentTo: invoice.sent_to,
    link: link ? `${origin}/d/${link.token}` : null, language } : null;

  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title={t("Invoice {number}", { number: invoice.number })} back={{ href: "/invoices", label: t("Invoices") }}
      description={`${invoice.client_name} · ${formatDate(invoice.issued_on)}`}
      action={<>
        <InvoiceStatusBadge status={invoice.status} daysOverdue={invoice.days_overdue} credited={credited} total={Number(invoice.total)} />
        {invoice.status !== "void" ? <PdfLinks href={pdf} /> : null}
        {editable ? <Link href={`/invoices/${id}/edit`} className={recordOutlineButton}><Pencil className="size-3.5" />{t("Edit")}</Link> : null}
        <MoreMenu items={[
          ...(creditable ? [{ href: `/accounts/credit-notes/new?invoice=${id}`, label: t("Credit note"), hint: t("Take back some or all of it"), icon: "credit" as const }] : []),
          { href: `/invoices/new?copy=${id}`, label: t("Copy"), hint: t("A new invoice with these lines"), icon: "copy" as const },
          ...(invoice.status !== "void" && !invoice.repeating_id ? [{ href: `/accounts/repeating/new?invoice=${id}`, label: t("Repeat"), hint: t("Raise it every month, quarter or year"), icon: "repeat" as const }] : []),
          ...(invoice.status !== "void" && invoice.status !== "draft" ? [{ href: `/c/${org.slug}/sales/${id}/ubl`, label: t("E-invoice (XML)"), hint: t("UBL, EN 16931 and Peppol BIS 3.0: ready for ViDA"), icon: "xml" as const, download: true }] : []),
        ]} />
        {invoice.status === "draft" ? <InvoiceStatusButton id={id} to="issued" /> : null}
        {invoice.status === "void" ? <RestoreInvoiceButton id={id} /> : null}
      </>} />

    {query.issued ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px]">
      <CheckCircle2 className="size-4 shrink-0" /><span><span className="font-medium">{t("Issued and in the books.")}</span> {invoice.due_on ? t("{name} owes {amount} by {date}.", { name: invoice.client_name, amount: formatAmount(invoice.balance), date: formatDate(invoice.due_on) })
        : t("{name} owes {amount}.", { name: invoice.client_name, amount: formatAmount(invoice.balance) })}{invoice.sent_at || Number(invoice.balance) === 0 ? "" : ` ${t("Send it below.")}`}</span>
    </p> : null}
    {invoice.status === "draft" ? <p className="border-hairline bg-surface-sunken text-ink-muted rounded-lg border px-4 py-2.5 text-[13px]">{t("A draft: nothing is in the books until it is issued.")}</p> : null}
    {send && !invoice.sent_at && open ? <div className="flex flex-wrap items-center gap-3">
      <p className="text-ink-muted text-[13px]">{t("Not sent to {name} yet.", { name: invoice.client_name })}</p>
      <SendInvoicePanel data={send} primary />
    </div> : null}
    {late && reminder && reminder.overdue.length ? <div className="flex flex-wrap items-center gap-3">
      <p className="text-critical text-[13px] font-medium">{t.n(invoice.days_overdue, "{count} day overdue.", "{count} days overdue.")}</p>
      <ReminderPanel data={{ customerId: invoice.customer_id, customerName: reminder.customer.name, to: reminder.to, greeting: reminder.greeting, company: org.name, sender: reminder.sender,
        overdue: reminder.overdue.map(item => ({ ...item, balance: Number(item.balance) })), bank: reminder.bank, statementHref: `/c/${org.slug}/customers/${invoice.customer_id}/statement`, lastSent: reminder.lastSent, language: reminder.language }} />
    </div> : null}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <RecordSection title={t("Invoice")} hint={t(TREATMENT_LABELS[invoice.vat_treatment])}>
          <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 text-[13px] leading-relaxed">
              <p className="ll-eyebrow mb-1">{t("Billed to")}</p>
              <Link href={`/accounts/customers/${invoice.customer_id}`} className="text-ink hover:text-brand text-[14px] font-semibold">{invoice.client_name}</Link>
              {customer?.address ? <p className="text-ink-muted whitespace-pre-line">{customer.address}</p> : null}
              {customer && customer.country !== "CY" ? <p className="text-ink-muted">{countryName(customer.country)}</p> : null}
              {invoice.client_vat_number ? <p className="text-ink-muted text-[12.5px]">{t("VAT")} <span className="font-mono">{invoice.client_vat_number}</span></p> : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 self-start text-[13px] sm:grid-cols-1 sm:text-right">
              <div><dt className="ll-eyebrow">{t("Date")}</dt><dd className="text-ink">{formatDate(invoice.issued_on)}</dd></div>
              {invoice.reference ? <div><dt className="ll-eyebrow">{t("Their reference")}</dt><dd className="text-ink font-mono text-[12.5px]">{invoice.reference}</dd></div> : null}
              <div><dt className="ll-eyebrow">{t("Due")}</dt><dd className={cn(late ? "text-critical font-medium" : "text-ink")}>{invoice.due_on ? formatDate(invoice.due_on) : t("On receipt")}</dd></div>
            </dl>
          </div>
          {reverseCharge && invoice.client_vat_number ? <div className="border-hairline border-t px-4 py-3">
            <p className="ll-eyebrow mb-2">{t("Zero-rated under the reverse charge: the customer’s VAT number")}</p>
            <VatCheckButton vat={invoice.client_vat_number} country={invoice.client_country} organisationId={org.id} expectName={invoice.client_name} kept={answerView(vat ? checks.get(vat) : null, invoice.client_name)} />
          </div> : null}
          <DocumentLines lines={lines} treatment={invoice.vat_treatment} registered={org.vat_registered} net={Number(invoice.net)} total={Number(invoice.total)} />
          {invoice.notes ? <p className="border-hairline text-ink-muted border-t px-4 py-3 text-[13px] whitespace-pre-line">{invoice.notes}</p> : null}
        </RecordSection>
        {invoice.status !== "draft" ? <details className="group">
          <summary className="text-ink-muted hover:text-brand cursor-pointer px-1 text-[13px] font-medium">{t("How it posted to the books")}</summary>
          <div className="mt-2"><Postings entries={postings.entries} empty={invoice.status === "void" ? t("A void invoice is not in the books.") : t("Nothing posted.")} /></div>
        </details> : null}
      </div>

      <div className="min-w-0 space-y-4">
        {invoice.status !== "draft" && invoice.status !== "void" ? <RecordSection title={open ? t("To collect") : credited >= Number(invoice.total) ? t("Credited in full") : t("Paid in full")}>
          <div className="px-4 py-3.5">
            <p className={cn("text-[22px] leading-tight font-semibold tabular-nums", late ? "text-critical" : "text-ink")}>{formatAmount(open ? balance : invoice.total)}</p>
            <p className="text-ink-muted mt-0.5 text-[12.5px]">{open ? `${credited ? t("{paid} received, {credited} credited of {total}", { paid: formatAmount(paid), credited: formatAmount(credited), total: formatAmount(invoice.total) })
              : t("{paid} received of {total}", { paid: formatAmount(paid), total: formatAmount(invoice.total) })}${late ? ` · ${t.n(invoice.days_overdue, "{count} day overdue", "{count} days overdue")}` : ""}`
              : credited >= Number(invoice.total) ? t("Credited in full") : payments.length ? `${payments.length === 1 ? t("Received on {date}", { date: formatDate(payments[0].received_on) }) : t("Received in {count} payments", { count: payments.length })}${credited ? t(", and {amount} credited", { amount: formatAmount(credited) }) : ""}`
              : t("{amount} credited", { amount: formatAmount(credited) })}</p>
          </div>
          {credits.length ? <ul aria-label={t("Credit notes")} className="divide-hairline border-hairline divide-y border-t">{credits.map(item => <li key={`${item.credit_note_id}-${item.id ?? "raised"}`} className="flex items-baseline gap-3 px-4 py-2">
            <span className="text-ink-muted w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(item.issued_on)}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{t("Credit note")} <Link href={`/accounts/credit-notes/${item.credit_note_id}`} className="text-brand font-mono hover:underline">{item.number}</Link>{item.status !== "issued" ? <span className="text-ink-faint"> · {t(item.status)}</span> : item.amount === null ? <span className="text-ink-faint"> · {t("kept as credit")}</span> : null}</span>
            {item.amount !== null ? <span className="text-ink shrink-0 text-[13px] font-medium tabular-nums">{formatAmount(item.amount)}</span> : null}
          </li>)}</ul> : null}
          {payments.length ? <ul aria-label={t("Payments received")} className="divide-hairline border-hairline divide-y border-t">{payments.map(payment => <li key={payment.id} className="flex items-baseline gap-3 px-4 py-2">
            <span className="text-ink-muted w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(payment.received_on)}</span>
            <span className="text-ink-muted min-w-0 flex-1 truncate text-[12.5px]">{payment.bank_name}{payment.reference ? ` · ${payment.reference}` : ""}</span>
            <span className="text-ink shrink-0 text-[13px] font-medium tabular-nums">{formatAmount(payment.amount)}</span>
            {payment.matched ? <span className="text-positive text-[11.5px]" title={t("Matched to a bank statement line")}>{t("Reconciled")}</span>
              : <form action={removeInvoicePayment}><input type="hidden" name="id" value={payment.id} /><InlineSubmit destructive title={t("Remove this payment")}>{t("Remove")}</InlineSubmit></form>}
          </li>)}</ul> : null}
          {open ? <div className="border-hairline border-t px-4 py-3.5">
            <p className="text-ink mb-2.5 text-[13.5px] font-semibold">{t("Record a payment")}</p>
            <RecordPaymentForm invoiceId={id} balance={balance} banks={banks} defaultBank={org.default_bank_account_id} today={today} />
          </div> : null}
        </RecordSection> : null}

        {sendable ? <RecordSection title={t("Share with {name}", { name: invoice.client_name })} hint={t("As a link: nothing to attach")}>
          <div className="px-4 py-3.5"><ShareLinkPanel key={link?.id ?? "none"} kind="invoice" documentId={id} number={invoice.number} link={link} origin={origin}
            customer={{ name: invoice.client_name, email: customer?.email ?? null, phone: customer?.phone ?? null, country: customer?.country ?? org.country }}
            subject={share.subject} message={share.message} /></div>
        </RecordSection> : null}

        <RecordSection title={t("Details")}>
          <dl className="divide-hairline divide-y px-4">
            <RecordDetail label={t("Customer")} value={<Link href={`/accounts/customers/${invoice.customer_id}`} className="text-brand hover:underline">{invoice.client_name}</Link>} />
            <RecordDetail label={t("VAT")} value={t(treatmentDetail(org.vat_registered ? invoice.vat_treatment : "exempt", org.country))} />
            {quote ? <RecordDetail label={t("From quote")} value={<Link href={`/accounts/quotes/${quote.id}`} className="text-brand font-mono hover:underline">{quote.number}</Link>} /> : null}
            {invoice.repeating_id ? <RecordDetail label={t("Repeating")} value={<Link href={`/accounts/repeating/${invoice.repeating_id}`} className="text-brand hover:underline">{t("Raised on a schedule")}</Link>} /> : null}
            <RecordDetail label={t("Pays into")} value={banks.find(bank => bank.id === org.default_bank_account_id)?.name ?? null} />
            {invoice.sent_at ? <RecordDetail label={t("Sent")} value={invoice.sent_to ? t("{date}, to {to}", { date: formatDate(invoice.sent_at), to: invoice.sent_to }) : formatDate(invoice.sent_at)} /> : null}
          </dl>
          {send && invoice.sent_at ? <div className="border-hairline border-t px-4 py-3"><SendInvoicePanel data={send} /></div> : null}
          {invoice.status === "draft" ? <form action={deleteDraftInvoice} className="border-hairline border-t px-4 py-3"><input type="hidden" name="id" value={id} />
            <SubmitButton variant="outline" size="sm" pendingLabel={t("Deleting…")}><Trash2 className="size-3.5" />{t("Delete this draft")}</SubmitButton>
          </form> : null}
          {invoice.status === "issued" && paid === 0 && credited === 0 ? <div className="border-hairline border-t px-4 py-3"><InvoiceStatusButton id={id} to="void" /></div> : null}
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
