import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getCreditNotes } from "@/lib/data/sales";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordEmpty, RecordFilterLinks, RecordHeader } from "@/components/records/record-layout";
import { CreditNoteStatusBadge } from "@/components/sales/sales-parts";

export const metadata: Metadata = { title: "Credit notes" };

const VIEWS = [{ key: "all", label: "All" }, { key: "unused", label: "Credit to use" }] as const;

/** Sales taken back: each against the invoice it corrects, and what is left of each credit to use or refund. */
export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const view = VIEWS.find(item => item.key === query.view)?.key ?? "all";
  const { rows, unused } = await getCreditNotes(view);
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title="Credit notes" back={{ href: "/invoices", label: "Invoices" }}
      description={unused > 0 ? `${formatAmount(unused)} of credit is still to use against invoices or to refund.` : "Raise one from the invoice it corrects: open the invoice and press Credit note."} />
    <Panel className="overflow-hidden">
      <div className="border-hairline border-b px-4 py-2.5"><RecordFilterLinks label="Credit notes" options={VIEWS.map(item => ({ label: item.label, href: `/accounts/credit-notes?view=${item.key}`, active: view === item.key }))} /></div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Number</th><th scope="col" className={head}>Customer</th><th scope="col" className={head}>Date</th><th scope="col" className={head}>Credits</th>
          <th scope="col" className={head}>Reason</th><th scope="col" className={cn(head, "text-right")}>Total</th><th scope="col" className={head}>Status</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2.5 text-[13px]"><Link href={`/accounts/credit-notes/${row.id}`} className="text-brand font-mono font-medium hover:underline">{row.number}</Link></td>
          <td className="text-ink px-3 py-2.5 text-[13px]">{row.client_name}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[13px] whitespace-nowrap">{formatDate(row.issued_on)}</td>
          <td className="px-3 py-2.5 text-[13px]">{row.invoice_id ? <Link href={`/invoices/${row.invoice_id}`} className="text-ink-muted hover:text-brand font-mono">{row.invoice_number}</Link> : <span className="text-ink-faint">—</span>}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[13px]">{row.reason}</td>
          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{formatAmount(row.total)}</td>
          <td className="px-3 py-2.5"><CreditNoteStatusBadge status={row.status} remaining={row.remaining} /></td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title="No credit notes here">{view === "unused" ? "Every credit has been used or refunded." : "A credit note is raised from the invoice it corrects."}</RecordEmpty>}
    </Panel>
  </PageBody>;
}
