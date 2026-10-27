import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getQuotes } from "@/lib/data/sales";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordEmpty, RecordFilterLinks, RecordHeader, recordButton } from "@/components/records/record-layout";
import { QuoteStatusBadge } from "@/components/sales/sales-parts";

export const metadata: Metadata = { title: "Quotes" };

const VIEWS = [{ key: "open", label: "Open" }, { key: "accepted", label: "Accepted" }, { key: "declined", label: "Declined" }, { key: "all", label: "All" }] as const;

/** Prices offered and not yet invoiced. An accepted quote becomes its invoice in one press. */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const view = VIEWS.find(item => item.key === query.view)?.key ?? "open";
  const { rows } = await getQuotes(view);
  const open = rows.filter(row => row.status === "draft" || row.status === "sent");
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title="Quotes" description={view === "open" && open.length ? `${open.length} open, worth ${formatAmount(open.reduce((sum, row) => sum + Number(row.total), 0))}. Accept one to raise its invoice.` : "Prices offered. Accept one to raise its invoice with the same lines."}
      action={<Link href="/accounts/quotes/new" className={recordButton}><Plus className="size-4" />New quote</Link>} />
    <Panel className="overflow-hidden">
      <div className="border-hairline border-b px-4 py-2.5"><RecordFilterLinks label="Quotes" options={VIEWS.map(item => ({ label: item.label, href: `/accounts/quotes?view=${item.key}`, active: view === item.key }))} /></div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Number</th><th scope="col" className={head}>Customer</th><th scope="col" className={head}>Date</th><th scope="col" className={head}>Valid until</th>
          <th scope="col" className={cn(head, "text-right")}>Total</th><th scope="col" className={head}>Status</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2.5 text-[13px]"><Link href={`/accounts/quotes/${row.id}`} className="text-brand font-mono font-medium hover:underline">{row.number}</Link></td>
          <td className="text-ink px-3 py-2.5 text-[13px]">{row.client_name}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[13px] whitespace-nowrap">{formatDate(row.issued_on)}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[13px] whitespace-nowrap">{row.valid_until ? formatDate(row.valid_until) : "—"}</td>
          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{formatAmount(row.total)}</td>
          <td className="px-3 py-2.5"><span className="flex items-center gap-2"><QuoteStatusBadge status={row.status} expired={row.expired} />{row.invoice_number ? <Link href={`/invoices/${row.invoice_id}`} className="text-ink-muted hover:text-brand font-mono text-[12px]">{row.invoice_number}</Link> : null}</span></td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title="No quotes here">{view === "open" ? <>Nothing waiting on a customer. <Link href="/accounts/quotes/new" className="text-brand font-medium">Write a quote</Link>.</> : "Nothing in this view."}</RecordEmpty>}
    </Panel>
  </PageBody>;
}
