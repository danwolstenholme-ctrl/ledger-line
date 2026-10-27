import type { Metadata } from "next";
import { CheckCircle2, Clock, FileDown, Landmark, TriangleAlert } from "lucide-react";

import { countView, openSharedDocument } from "@/lib/data/document-links";
import { accentOf, treatmentNote } from "@/lib/documents/document-text";
import { formatQuantity, formatUnitPrice } from "@/lib/domain/line-math";
import { countryName } from "@/lib/domain/countries";
import { firmToday } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LedgerlineMark } from "@/components/brand/ledgerline-mark";
import { AcceptQuoteForm, CopyValue } from "@/components/documents/shared-parts";

export const metadata: Metadata = { title: "Your document", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const lines = (text: string | null | undefined) => (text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
/** What to copy from a line of bank details: the IBAN, BIC or account after its label, without spaces. */
const bankValue = (line: string) => { const match = /^(IBAN|BIC|SWIFT|Account(?: number)?|Sort code)[:\s]+(.+)$/i.exec(line); return match ? { label: match[1], value: match[2].replace(/\s+/g, "") } : null; };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * An invoice or quote as its customer opens it from a link (data/document-links):
 * what is owed and by when, the lines, how to pay, the PDF, and for a quote,
 * accepting it. In the issuing company's name and colours; nothing else of
 * its books. `?preview=1`: the company looking at its own link, not counted.
 */
export default async function SharedDocumentPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const shared = await openSharedDocument(token);
  if (!shared) return <main className="bg-canvas grid min-h-dvh place-items-center px-4">
    <div className="ll-panel max-w-md space-y-2 p-6 text-center">
      <h1 className="text-ink text-[19px] font-semibold">This link can’t be used</h1>
      <p className="text-ink-muted text-[14px] leading-relaxed">It was stopped, or the document was withdrawn. Ask whoever sent it to you for a new one.</p>
    </div>
  </main>;
  const preview = query.preview === "1";
  if (!preview) await countView(shared.link.id);
  const { kind, link, data } = shared;
  const { org, document, lines: items, customer, bank, logo } = data;
  const { accent, onAccent } = accentOf(org);
  const currency = ("currency" in document && document.currency) || org.currency;
  const money = (value: number | string) => formatAmount(value, currency);
  const today = firmToday();
  const isInvoice = kind === "invoice";
  const status = String(document.status);
  const balance = "balance" in document ? Number(document.balance) : Number(document.total);
  const paid = "amount_paid" in document ? Number(document.amount_paid) : 0, credited = "amount_credited" in document ? Number(document.amount_credited) : 0;
  const until = "due_on" in document ? document.due_on : "valid_until" in document ? document.valid_until : null;
  const settled = isInvoice && (status === "paid" || balance <= 0);
  const late = isInvoice && !settled && until !== null && until < today;
  const payable = isInvoice && !settled && status !== "void";
  const charged = document.vat_treatment === "standard" && org.vat_registered;
  const itemised = items.some(item => item.unit_price !== null && (Number(item.quantity) !== 1 || Number(item.discount_pct) > 0 || item.item_id));
  const vatByRate = [...items.reduce((rates, line) => Number(line.vat_rate) > 0 ? rates.set(Number(line.vat_rate), (rates.get(Number(line.vat_rate)) ?? 0) + Number(line.vat_amount)) : rates, new Map<number, number>())].sort(([a], [b]) => b - a);
  const note = treatmentNote({ document, org });
  const quoteOpen = !isInvoice && (status === "draft" || status === "sent") && !("expired" in document && document.expired);
  const title = `${isInvoice ? "Invoice" : "Quote"} ${document.number}`;
  const chip = isInvoice
    ? settled ? { tone: "positive", icon: CheckCircle2, text: "Paid" } : status === "void" ? { tone: "neutral", icon: TriangleAlert, text: "Withdrawn" }
      : late ? { tone: "critical", icon: TriangleAlert, text: `${daysBetween(until!, today)} days overdue` }
      : { tone: "neutral", icon: Clock, text: until ? (until === today ? "Due today" : `Due in ${daysBetween(today, until)} days`) : "Due" }
    : link.accepted_at || status === "accepted" ? { tone: "positive", icon: CheckCircle2, text: "Accepted" } : status === "declined" ? { tone: "neutral", icon: TriangleAlert, text: "Declined" }
      : "expired" in document && document.expired ? { tone: "neutral", icon: Clock, text: "Expired" } : { tone: "neutral", icon: Clock, text: until ? `Valid until ${formatDate(until)}` : "Open" };

  // The company's colour on its buttons and links too, where white reads on it; Ledgerline's own where it would not.
  const brand = onAccent === "#ffffff" ? { "--brand": accent, "--brand-dark": `color-mix(in oklab, ${accent} 82%, black)`, "--brand-50": `color-mix(in oklab, ${accent} 6%, white)` } as React.CSSProperties : undefined;
  return <main className="bg-canvas min-h-dvh pb-10" style={brand}>
    <div aria-hidden className="h-1.5" style={{ background: accent }} />
    {preview ? <p className="bg-caution-soft text-caution border-caution-line border-b px-4 py-2 text-center text-[13px]">This is what {customer?.name ?? document.client_name} sees. Opening it here isn’t counted.</p> : null}
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 pt-6 sm:px-5 sm:pt-10">
      <header className="flex items-center gap-3 px-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- the logo is a data URL from the database: nothing for the image optimiser to fetch */}
        {logo ? <img src={logo} alt={org.name} className="max-h-12 max-w-[180px] object-contain" />
          : <span className="grid size-11 shrink-0 place-items-center rounded-xl text-[15px] font-semibold" style={{ background: accent, color: onAccent }}>{org.name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase()}</span>}
        <span className={cn("min-w-0", logo && "max-sm:hidden")}>
          <span className="text-ink block truncate text-[15px] font-semibold">{org.name}</span>
          <span className="text-ink-faint block truncate text-[12.5px]">{[org.vat_number ? `VAT ${org.vat_number}` : null, org.contact_email].filter(Boolean).join(" · ")}</span>
        </span>
      </header>

      <section className="ll-panel overflow-hidden">
        <div className="space-y-4 px-5 pt-5 pb-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-ink text-[22px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
              <p className="text-ink-muted mt-1 text-[13.5px]">For {customer?.name ?? document.client_name} · {formatDate(document.issued_on)}</p>
            </div>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium", chip.tone === "positive" ? "border-positive-line bg-positive-soft text-positive" : chip.tone === "critical" ? "border-critical-line bg-critical-soft text-critical" : "border-hairline bg-surface-sunken text-ink-muted")}>
              <chip.icon className="size-3.5" />{chip.text}
            </span>
          </div>
          <div className="bg-surface-sunken border-hairline flex flex-wrap items-end justify-between gap-4 rounded-xl border px-4 py-4">
            <div>
              <p className="ll-eyebrow">{isInvoice ? settled ? "Paid in full" : paid + credited > 0 ? "Balance due" : "Amount due" : "Quote total"}</p>
              <p className="text-ink mt-1 text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{money(isInvoice ? Math.max(balance, 0) : document.total)}</p>
              {isInvoice && until && !settled ? <p className={cn("mt-1.5 text-[13px]", late ? "text-critical font-medium" : "text-ink-muted")}>By {formatDate(until)}</p> : null}
            </div>
            <a href={`/d/${token}/pdf?download=1`} className="bg-ink hover:bg-ink/90 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[14px] font-medium text-white"><FileDown className="size-4" />Download PDF</a>
          </div>
        </div>

        {payable && bank ? <div className="border-hairline space-y-2 border-t px-5 py-4 sm:px-6">
          <p className="text-ink flex items-center gap-2 text-[14px] font-semibold"><Landmark className="text-ink-muted size-4" />Pay by bank transfer to {bank.name}</p>
          <ul className="divide-hairline border-hairline divide-y rounded-lg border">
            {lines(bank.bank_details).map((line, index) => { const value = bankValue(line); return <li key={index} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-ink min-w-0 font-mono text-[13px] break-all">{line}</span>{value ? <CopyValue label={value.label} value={value.value} /> : null}
            </li>; })}
            <li className="flex items-center justify-between gap-3 px-3 py-2"><span className="text-ink-muted text-[13px]">Reference <span className="text-ink font-mono">{document.number}</span></span><CopyValue label="the reference" value={document.number} /></li>
          </ul>
        </div> : null}

        {quoteOpen && !link.accepted_at ? <div className="border-hairline space-y-3 border-t px-5 py-4 sm:px-6">
          <p className="text-ink text-[14px] font-semibold">Happy to go ahead?</p>
          <p className="text-ink-muted text-[13px]">Accept it here and {org.name} will send the invoice.</p>
          <AcceptQuoteForm token={token} company={org.name} />
        </div> : null}
        {!isInvoice && link.accepted_at ? <p className="border-hairline text-positive border-t px-5 py-4 text-[14px] sm:px-6"><CheckCircle2 className="mr-1.5 inline size-4" />Accepted by {link.accepted_name} on {formatDate(link.accepted_at.slice(0, 10))}.</p> : null}

        <div className="border-hairline border-t">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr className="text-ink-faint border-hairline border-b text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase">
              <th scope="col" className="px-5 py-2 sm:px-6">Description</th>{charged ? <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell">VAT</th> : null}<th scope="col" className="px-5 py-2 text-right sm:px-6">{charged ? "Net" : "Amount"}</th>
            </tr></thead>
            <tbody className="divide-hairline divide-y">{items.map(item => <tr key={item.id}>
              <td className="px-5 py-2.5 sm:px-6"><span className="text-ink">{item.description}</span>
                {itemised ? <span className="text-ink-faint block text-[12.5px]">{formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""} × {formatUnitPrice(item.unit_price ?? item.net, currency)}{Number(item.discount_pct) ? `, less ${Number(item.discount_pct)}%` : ""}</span> : null}
                {charged ? <span className="text-ink-faint block text-[12.5px] sm:hidden">VAT {Number(item.vat_rate)}%</span> : null}</td>
              {charged ? <td className="text-ink-muted hidden px-2 py-2.5 text-right sm:table-cell">{Number(item.vat_rate)}%</td> : null}
              <td className="text-ink px-5 py-2.5 text-right tabular-nums sm:px-6">{money(item.net)}</td>
            </tr>)}</tbody>
          </table>
          <dl className="border-hairline ml-auto max-w-xs space-y-1 border-t px-5 py-3 text-[13.5px] sm:px-6">
            <div className="flex justify-between gap-4"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{money(document.net)}</dd></div>
            {charged ? vatByRate.map(([rate, amount]) => <div key={rate} className="flex justify-between gap-4"><dt className="text-ink-muted">VAT at {rate}%</dt><dd className="tabular-nums">{money(amount)}</dd></div>)
              : <div className="flex justify-between gap-4"><dt className="text-ink-muted">VAT</dt><dd className="tabular-nums">{money(0)}</dd></div>}
            <div className="flex justify-between gap-4 rounded-md px-2 py-1.5 font-semibold" style={{ background: accent, color: onAccent }}><dt>Total</dt><dd className="tabular-nums">{money(document.total)}</dd></div>
            {isInvoice && paid > 0 ? <div className="flex justify-between gap-4"><dt className="text-ink-muted">Paid</dt><dd className="tabular-nums">−{money(paid)}</dd></div> : null}
            {isInvoice && credited > 0 ? <div className="flex justify-between gap-4"><dt className="text-ink-muted">Credited</dt><dd className="tabular-nums">−{money(credited)}</dd></div> : null}
          </dl>
          {note ? <p className="text-ink-muted px-5 pb-3 text-[12.5px] sm:px-6">{note}</p> : null}
          {document.notes ? <div className="border-hairline border-t px-5 py-3 text-[13.5px] sm:px-6">{lines(document.notes).map((line, index) => <p key={index} className="text-ink">{line}</p>)}</div> : null}
        </div>

        <div className="border-hairline bg-surface-sunken text-ink-muted grid gap-1 border-t px-5 py-3 text-[12.5px] sm:grid-cols-2 sm:px-6">
          <p><span className="text-ink-faint">From</span> {org.name}{org.address ? <span className="block">{lines(org.address).join(", ")}</span> : null}{org.vat_number ? <span className="block">VAT {org.vat_number}</span> : null}</p>
          <p><span className="text-ink-faint">To</span> {customer?.name ?? document.client_name}{customer?.address ? <span className="block">{lines(customer.address).join(", ")}</span> : null}
            {customer && customer.country !== org.country ? <span className="block">{countryName(customer.country)}</span> : null}{customer?.vat_number ? <span className="block">VAT {customer.vat_number}</span> : null}</p>
        </div>
      </section>
      {org.invoice_footer ? <p className="text-ink-faint px-1 text-[12.5px] leading-relaxed">{org.invoice_footer}</p> : null}
      <p className="text-ink-faint flex items-center justify-center gap-1.5 pt-2 text-[12px]">Sent with <LedgerlineMark className="size-3.5" title="" /><span className="text-ink-muted font-semibold">Ledgerline</span></p>
    </div>
  </main>;
}
