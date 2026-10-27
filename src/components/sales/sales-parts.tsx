import { FileDown, FileText } from "lucide-react";

import { formatQuantity, formatUnitPrice } from "@/lib/domain/line-math";
import { requestCurrency } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { RecordBadge, recordOutlineButton } from "@/components/records/record-layout";
import type { SalesLine } from "@/lib/data/sales";
import type { CreditNoteStatus, InvoiceStatus, VatTreatment } from "@/types/database";

/** The pieces the invoice, quote and credit note pages share: server components, in the language of the person reading. */

export const TREATMENT_LABELS: Record<VatTreatment, string> = {
  standard: "Standard VAT", exempt: "Exempt from VAT", reverse_charge: "Reverse charge", outside_scope: "Outside the scope of VAT",
};
const DETAIL: Record<"CY" | "GB", Record<VatTreatment, string>> = {
  CY: {
    standard: "VAT charged as each line shows, owed in box 1",
    exempt: "No VAT charged: box 6 only",
    reverse_charge: "No VAT charged: the customer accounts for it (Article 196). Box 8B and the VIES statement",
    outside_scope: "No VAT charged: supplied outside Cyprus. Box 10",
  },
  GB: {
    standard: "VAT charged as each line shows, owed in box 1",
    exempt: "No VAT charged: an exempt supply, in box 6",
    reverse_charge: "No VAT charged: the customer pays it to HMRC under the CIS domestic reverse charge. Box 6",
    outside_scope: "No VAT charged: supplied outside the UK. Box 6",
  },
};
/** What a sale's VAT treatment means for the company's own return. */
export const treatmentDetail = (treatment: VatTreatment, country: string) => DETAIL[country === "GB" ? "GB" : "CY"][treatment];

const INVOICE_LABELS: Record<InvoiceStatus, string> = { draft: "Draft", issued: "Awaiting payment", part_paid: "Part paid", paid: "Paid", void: "Void" };

/** Where an invoice stands. Fully covered by credit notes reads "Credited", not "Paid". */
export async function InvoiceStatusBadge({ status, daysOverdue, credited = 0, total = 0 }: { status: InvoiceStatus; daysOverdue: number; credited?: number; total?: number }) {
  const { t } = await getI18n();
  const late = daysOverdue > 0 && (status === "issued" || status === "part_paid");
  if (status === "paid" && total > 0 && Number(credited) >= Number(total)) return <RecordBadge>{t("Credited")}</RecordBadge>;
  return <RecordBadge tone={status === "paid" ? "positive" : late ? "critical" : status === "part_paid" ? "caution" : "neutral"}>
    {late ? t.n(daysOverdue, "{count} day overdue", "{count} days overdue") : t(INVOICE_LABELS[status])}
  </RecordBadge>;
}

const QUOTE_LABELS = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined" } as const;
export async function QuoteStatusBadge({ status, expired }: { status: "draft" | "sent" | "accepted" | "declined"; expired: boolean }) {
  const { t } = await getI18n();
  if (expired && (status === "draft" || status === "sent")) return <RecordBadge tone="caution">{t("Expired")}</RecordBadge>;
  return <RecordBadge tone={status === "accepted" ? "positive" : status === "declined" ? "critical" : "neutral"}>{t(QUOTE_LABELS[status])}</RecordBadge>;
}

/** A credit note: a draft, used up, credit still to use, or void. */
export async function CreditNoteStatusBadge({ status, remaining }: { status: CreditNoteStatus; remaining: number }) {
  const { t, formatAmount } = await getI18n();
  if (status === "draft") return <RecordBadge>{t("Draft")}</RecordBadge>;
  if (status === "void") return <RecordBadge>{t("Void")}</RecordBadge>;
  return Number(remaining) > 0 ? <RecordBadge tone="caution">{t("{amount} to use", { amount: formatAmount(remaining) })}</RecordBadge> : <RecordBadge tone="positive">{t("Used")}</RecordBadge>;
}

/** Whether lines are worth showing with quantities and prices, or are single amounts. */
export const isItemised = (lines: SalesLine[]) => lines.some(line => line.unit_price !== null && (Number(line.quantity) !== 1 || Number(line.discount_pct) > 0 || line.item_id));

/** The lines as the customer sees them, with VAT by rate and the total. */
export async function DocumentLines({ lines, treatment, registered, net, total, totalLabel }: { lines: SalesLine[]; treatment: VatTreatment; registered: boolean; net: number; total: number; totalLabel?: string }) {
  const { t, formatAmount, locale } = await getI18n();
  const charged = treatment === "standard" && registered;
  const itemised = isItemised(lines), discounted = lines.some(line => Number(line.discount_pct) > 0);
  const byRate = [...lines.reduce((rates, line) => Number(line.vat_rate) > 0 ? rates.set(Number(line.vat_rate), (rates.get(Number(line.vat_rate)) ?? 0) + Number(line.vat_amount)) : rates, new Map<number, number>())].sort(([a], [b]) => b - a);
  const span = 1 + (itemised ? 2 : 0) + (discounted ? 1 : 0) + (charged ? 1 : 0);
  const cell = "px-4 py-2 text-[13px]", number = "text-ink-muted px-3 py-2 text-right text-[12.5px] tabular-nums whitespace-nowrap";
  return <div className="overflow-x-auto"><table className="w-full border-collapse">
    <thead><tr className="border-hairline bg-surface-sunken text-ink-faint border-b text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase">
      <th scope="col" className="px-4 py-2">{t("Description")}</th>
      {itemised ? <th scope="col" className="px-3 py-2 text-right">{t("Qty")}</th> : null}
      {itemised ? <th scope="col" className="px-3 py-2 text-right">{t("Unit price")}</th> : null}
      {discounted ? <th scope="col" className="px-3 py-2 text-right">{t("Disc")}</th> : null}
      {charged ? <th scope="col" className="px-3 py-2 text-right">{t("VAT")}</th> : null}
      <th scope="col" className="px-4 py-2 text-right">{charged ? t("Net") : t("Amount")}</th>
    </tr></thead>
    <tbody className="divide-hairline divide-y">{lines.map(line => <tr key={line.id}>
      <td className={cell}>{line.description}<span className="text-ink-faint block text-[11.5px]">{line.code} · {line.account_name}</span></td>
      {itemised ? <td className={number}>{formatQuantity(line.quantity, locale)}{line.unit ? <span className="text-ink-faint"> {line.unit}</span> : null}</td> : null}
      {itemised ? <td className={number}>{formatUnitPrice(line.unit_price ?? line.net, requestCurrency(), locale)}</td> : null}
      {discounted ? <td className={number}>{Number(line.discount_pct) ? `${Number(line.discount_pct)}%` : ""}</td> : null}
      {charged ? <td className={number}>{Number(line.vat_rate)}%</td> : null}
      <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(line.net)}</td>
    </tr>)}</tbody>
    <tfoot className="border-hairline-strong border-t text-[13px]">
      <tr><td className="text-ink-muted px-4 pt-2" colSpan={span}>{t("Subtotal")}</td><td className="px-4 pt-2 text-right tabular-nums">{formatAmount(net)}</td></tr>
      {charged ? byRate.map(([rate, amount]) => <tr key={rate}><td className="text-ink-muted px-4" colSpan={span}>{t("VAT at {rate}%", { rate })}</td><td className="px-4 text-right tabular-nums">{formatAmount(amount)}</td></tr>)
        : <tr><td className="text-ink-muted px-4" colSpan={span}>{t("VAT")}</td><td className="px-4 text-right tabular-nums">{formatAmount(0)}</td></tr>}
      <tr><td className="text-ink px-4 pt-1 pb-2.5 font-semibold" colSpan={span}>{totalLabel ?? t("Total")}</td><td className="px-4 pt-1 pb-2.5 text-right text-[14px] font-semibold tabular-nums">{formatAmount(total)}</td></tr>
    </tfoot>
  </table></div>;
}

/** Open the PDF in a new tab, or save it. Plain links: a PDF is not a page to navigate to. */
export async function PdfLinks({ href }: { href: string }) {
  const { t } = await getI18n();
  return <>
    <a href={href} target="_blank" rel="noopener" className={recordOutlineButton}><FileText className="size-3.5" />{t("View PDF")}</a>
    <a href={`${href}?download=1`} className={recordOutlineButton}><FileDown className="size-3.5" />{t("Download")}</a>
  </>;
}
