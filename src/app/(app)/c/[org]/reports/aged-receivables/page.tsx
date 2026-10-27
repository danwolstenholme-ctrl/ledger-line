import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getAgeingReport } from "@/lib/data/bank";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { RecordEmpty, RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Aged receivables" };

/** What customers owe the company, oldest first, by how far past due. */
export default async function AgedReceivablesPage() {
  await requireOrg();
  const report = await getAgeingReport();
  const head = "text-ink-faint px-3 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  const cell = "px-3 py-2 text-[13px] tabular-nums whitespace-nowrap";
  const narrow = (key: string) => key !== "current" && key !== "d30" && "hidden md:table-cell";
  const amount = (value: number) => value ? formatAmount(value) : <span className="text-ink-faint">—</span>;
  return <PageBody className="space-y-4">
    <RecordHeader title="Aged receivables" description="Unpaid sales invoices, by how far past their due date they are."
      back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    {report.failed ? <RecordFailure what="the aged receivables" /> : <Panel className="overflow-hidden">
      {report.clients.length ? <div className="w-full overflow-x-auto"><table className="w-full border-collapse text-left">
        <thead><tr className="border-hairline bg-surface-sunken border-b">
          <th scope="col" className={head}>Customer</th>
          {AGEING_BUCKETS.map(bucket => <th key={bucket.key} scope="col" className={cn(head, "text-right", narrow(bucket.key))}>{bucket.key === "current" ? "Not yet due" : bucket.label}</th>)}
          <th scope="col" className={cn(head, "text-right")}>Total</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{report.clients.map(customer => <tr key={customer.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2.5 text-[13.5px]">
            <Link href={`/invoices?customer=${customer.id}`} className="text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{customer.name}</Link>
            <span className="text-ink-faint block text-[12px] sm:ml-2 sm:inline">{customer.count} invoice{customer.count === 1 ? "" : "s"}{customer.oldest ? ` · oldest ${customer.oldest} day${customer.oldest === 1 ? "" : "s"} late` : ""}</span>
          </td>
          {AGEING_BUCKETS.map(bucket => <td key={bucket.key} className={cn(cell, "text-right", narrow(bucket.key), customer.buckets[bucket.key] && (bucket.key === "d90" || bucket.key === "older") ? "text-critical" : "text-ink-muted")}>{amount(customer.buckets[bucket.key])}</td>)}
          <td className={cn(cell, "text-ink text-right font-medium")}>{formatAmount(customer.total)}</td>
        </tr>)}</tbody>
        <tfoot className="border-hairline-strong bg-surface-sunken border-t"><tr>
          <th scope="row" className="text-ink px-3 py-3 text-left text-[13.5px] font-semibold">All customers</th>
          {AGEING_BUCKETS.map(bucket => <td key={bucket.key} className={cn(cell, "text-ink py-3 text-right font-semibold", narrow(bucket.key))}>{formatAmount(report.totals[bucket.key])}</td>)}
          <td className={cn(cell, "text-ink py-3 text-right font-semibold")}>{formatAmount(report.total)}</td>
        </tr></tfoot>
      </table></div> : <RecordEmpty title="Nothing is owed">Every invoice has been paid.</RecordEmpty>}
      <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12.5px]">{report.count} unpaid invoice{report.count === 1 ? "" : "s"} · as at {formatDate(report.today)} · ages run from each invoice’s due date</p>
    </Panel>}
  </PageBody>;
}
