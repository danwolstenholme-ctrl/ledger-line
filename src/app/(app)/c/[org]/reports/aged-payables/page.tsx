import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";
import { Download } from "lucide-react";

import { requireOrg } from "@/lib/org";
import { getAgedPayables } from "@/lib/data/accounts";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { RecordEmpty, RecordFailure, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Aged payables" };

/** What the company owes its suppliers, oldest first, by how far past due. */
export default async function AgedPayablesPage() {
  await requireOrg();
  const report = await getAgedPayables();
  const head = "text-ink-faint px-3 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  const cell = "px-3 py-2 text-[13px] tabular-nums whitespace-nowrap";
  const narrow = (key: string) => key !== "current" && key !== "d30" && "hidden md:table-cell";
  const amount = (value: number) => value ? formatAmount(value) : <span className="text-ink-faint">—</span>;
  return <PageBody className="space-y-4">
    <RecordHeader title="Aged payables" description="Unpaid bills, by how far past their due date they are."
      back={{ href: "/accounts/reports", label: "Reports" }}
      action={<a href="/accounts/reports/aged-payables/export" download className={recordOutlineButton}><Download className="size-3.5" />Export</a>} />
    <AccountsNav current="/accounts/reports" />
    {report.failed ? <RecordFailure what="the aged payables" /> : <Panel className="overflow-hidden">
      {report.suppliers.length ? <div className="w-full overflow-x-auto"><table className="w-full border-collapse text-left">
        <thead><tr className="border-hairline bg-surface-sunken border-b">
          <th scope="col" className={head}>Supplier</th>
          {AGEING_BUCKETS.map(bucket => <th key={bucket.key} scope="col" className={cn(head, "text-right", narrow(bucket.key))}>{bucket.key === "current" ? "Not yet due" : bucket.label}</th>)}
          <th scope="col" className={cn(head, "text-right")}>Total</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{report.suppliers.map(supplier => <tr key={supplier.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2.5 text-[13.5px]">
            <Link href={`/accounts/suppliers/${supplier.id}`} className="text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{supplier.name}</Link>
            <span className="text-ink-faint block text-[12px] sm:ml-2 sm:inline">{supplier.count} bill{supplier.count === 1 ? "" : "s"}{supplier.oldest ? ` · oldest ${supplier.oldest} day${supplier.oldest === 1 ? "" : "s"} late` : ""}</span>
          </td>
          {AGEING_BUCKETS.map(bucket => <td key={bucket.key} className={cn(cell, "text-right", narrow(bucket.key), supplier.buckets[bucket.key] && (bucket.key === "d90" || bucket.key === "older") ? "text-critical" : "text-ink-muted")}>{amount(supplier.buckets[bucket.key])}</td>)}
          <td className={cn(cell, "text-ink text-right font-medium")}>{formatAmount(supplier.total)}</td>
        </tr>)}</tbody>
        <tfoot className="border-hairline-strong bg-surface-sunken border-t"><tr>
          <th scope="row" className="text-ink px-3 py-3 text-left text-[13.5px] font-semibold">All suppliers</th>
          {AGEING_BUCKETS.map(bucket => <td key={bucket.key} className={cn(cell, "text-ink py-3 text-right font-semibold", narrow(bucket.key))}>{formatAmount(report.totals[bucket.key])}</td>)}
          <td className={cn(cell, "text-ink py-3 text-right font-semibold")}>{formatAmount(report.total)}</td>
        </tr></tfoot>
      </table></div> : <RecordEmpty title="Nothing is owed">Every bill has been paid or voided.</RecordEmpty>}
      <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12.5px]">{report.count} unpaid bill{report.count === 1 ? "" : "s"} · as at {formatDate(report.today)} · ages run from each bill’s due date</p>
    </Panel>}
  </PageBody>;
}
