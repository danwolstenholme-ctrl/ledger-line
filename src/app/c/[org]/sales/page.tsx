import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { INVOICE_VIEWS, getInvoices, type InvoiceView } from "@/lib/data/sales";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { NavigationForm } from "@/components/navigation/navigation-form";
import { RecordEmpty, RecordFilterLinks, RecordHeader, recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { InvoiceStatusBadge } from "@/components/sales/sales-parts";

export const metadata: Metadata = { title: "Invoices" };

/** The company's sales invoices: what is still to collect first, then everything else. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const customer = query.customer && UUID_PATTERN.test(query.customer) ? query.customer : null;
  const requested = INVOICE_VIEWS.find(item => item.key === query.view)?.key;
  const first = await getInvoices({ view: requested ?? "open", q: query.q, customerId: customer });
  // Nothing to collect: show everything rather than an empty page.
  const view: InvoiceView = requested ?? (first.counts.open ? "open" : "all");
  const { rows, counts, owed, overdue } = view === (requested ?? "open") ? first : await getInvoices({ view, q: query.q, customerId: customer });
  const href = (key: InvoiceView) => `/invoices?view=${key}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}${customer ? `&customer=${customer}` : ""}`;
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title="Invoices" description={counts.all ? `${formatAmount(owed)} to collect${overdue ? `, ${formatAmount(overdue)} of it overdue` : ""}.` : "Raise the first invoice: it posts itself to the books."}
      action={<>{first.repeating ? <Link href="/accounts/repeating" className={recordOutlineButton}>Repeating</Link> : null}{first.creditNotes ? <Link href="/accounts/credit-notes" className={recordOutlineButton}>Credit notes</Link> : null}<Link href="/accounts/quotes/new" className={recordOutlineButton}>New quote</Link><Link href={`/invoices/new${customer ? `?customer=${customer}` : ""}`} className={recordButton}><Plus className="size-4" />New invoice</Link></>} />
    <Panel className="overflow-hidden">
      <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <RecordFilterLinks label="Invoices" options={INVOICE_VIEWS.map(item => ({ label: `${item.label}${counts[item.key] ? ` · ${counts[item.key]}` : ""}`, href: href(item.key), active: view === item.key }))} />
        <NavigationForm action="" method="get" className="border-hairline-strong flex h-8 w-full items-center gap-2 rounded-md border px-2.5 sm:w-64">
          <input type="hidden" name="view" value={view} />
          <Search className="text-ink-faint size-3.5 shrink-0" />
          <input name="q" defaultValue={query.q ?? ""} placeholder="Number, customer or their reference" aria-label="Search invoices" className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
        </NavigationForm>
        <a href={`/c/${first.org.slug}/sales/export`} className="text-ink-muted hover:text-brand text-[12px]">Export all</a>
      </div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Number</th><th scope="col" className={head}>Customer</th><th scope="col" className={head}>Date</th><th scope="col" className={head}>Due</th>
          <th scope="col" className={cn(head, "text-right")}>Total</th><th scope="col" className={cn(head, "text-right")}>To collect</th><th scope="col" className={head}>Status</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2.5 text-[12.5px]"><Link href={`/invoices/${row.id}`} className="text-brand font-mono font-medium hover:underline">{row.number}</Link></td>
          <td className="text-ink px-3 py-2.5 text-[12.5px]">{row.client_name}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[12.5px] whitespace-nowrap">{formatDate(row.issued_on)}</td>
          <td className={cn("px-3 py-2.5 text-[12.5px] whitespace-nowrap", row.days_overdue > 0 && row.status !== "paid" && row.status !== "void" ? "text-critical" : "text-ink-muted")}>{row.due_on ? formatDate(row.due_on) : "—"}</td>
          <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums">{formatAmount(row.total)}</td>
          <td className="px-3 py-2.5 text-right text-[12.5px] font-medium tabular-nums">{Number(row.balance) && row.status !== "void" && row.status !== "draft" ? formatAmount(row.balance) : "—"}</td>
          <td className="px-3 py-2.5"><InvoiceStatusBadge status={row.status} daysOverdue={row.days_overdue} credited={Number(row.amount_credited)} total={Number(row.total)} /></td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title={query.q ? "No invoices match" : "No invoices here"}>{query.q ? "Try another number or customer name." : <>Nothing in this view. <Link href="/invoices/new" className="text-brand font-medium">Raise an invoice</Link>.</>}</RecordEmpty>}
    </Panel>
  </PageBody>;
}
