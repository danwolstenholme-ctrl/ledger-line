import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";
import { Download } from "lucide-react";

import { requireOrg } from "@/lib/org";
import { getAgedPayables } from "@/lib/data/accounts";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { resolvePeriod, toDate } from "@/lib/domain/accounts";
import { firmToday } from "@/lib/domain/invoices";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { RecordEmpty, RecordFailure, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Aged payables" };

/** What the company owed its suppliers on a day, oldest first, by how far past due. */
export default async function AgedPayablesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const org = await requireOrg();
  const today = firmToday();
  const period = toDate(resolvePeriod(await searchParams, today, org.year_end_month, "this_month"), today);
  const report = await getAgedPayables({ at: period.to });
  const query = `range=${period.range}${period.range === "custom" ? `&from=${period.from}&to=${period.to}` : ""}`;
  const credit = report.credit > 0;
  const head = "text-ink-faint px-3 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  const cell = "px-3 py-2 text-[13px] tabular-nums whitespace-nowrap";
  const narrow = (key: string) => key !== "current" && key !== "d30" && "hidden md:table-cell";
  const amount = (value: number) => value ? formatAmount(value) : <span className="text-ink-faint">—</span>;
  return <PageBody className="space-y-4">
    <RecordHeader title="Aged payables"
      back={{ href: "/accounts/reports", label: "Reports" }}
      action={<a href={`/c/${org.slug}/reports/aged-payables/export?${query}`} download className={recordOutlineButton}><Download className="size-3.5" />Export</a>} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/aged-payables" range={period.range} from={period.from} to={period.to} asAt />
    {report.failed ? <RecordFailure what="the aged payables" /> : <Panel className="overflow-hidden">
      {report.suppliers.length ? <div className="w-full overflow-x-auto"><table className="w-full border-collapse text-left">
        <thead><tr className="border-hairline bg-surface-sunken border-b">
          <th scope="col" className={head}>Supplier</th>
          {AGEING_BUCKETS.map(bucket => <th key={bucket.key} scope="col" className={cn(head, "text-right", narrow(bucket.key))}>{bucket.key === "current" ? "Not yet due" : bucket.label}</th>)}
          {credit ? <th scope="col" className={cn(head, "text-right")}>Credit to use</th> : null}
          <th scope="col" className={cn(head, "text-right")}>Total</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{report.suppliers.map(supplier => <tr key={supplier.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2.5 text-[13.5px]">
            <Link href={`/accounts/suppliers/${supplier.id}/statement?view=open&range=custom&from=${period.to}&to=${period.to}`} className="text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{supplier.name}</Link>
            <span className="text-ink-faint block text-[12px] sm:ml-2 sm:inline">{supplier.count} bill{supplier.count === 1 ? "" : "s"}{supplier.oldest ? ` · oldest ${supplier.oldest} day${supplier.oldest === 1 ? "" : "s"} late` : ""}</span>
          </td>
          {AGEING_BUCKETS.map(bucket => <td key={bucket.key} className={cn(cell, "text-right", narrow(bucket.key), supplier.buckets[bucket.key] && (bucket.key === "d90" || bucket.key === "older") ? "text-critical" : "text-ink-muted")}>{amount(supplier.buckets[bucket.key])}</td>)}
          {credit ? <td className={cn(cell, "text-ink-muted text-right")}>{supplier.credit ? `−${formatAmount(supplier.credit)}` : <span className="text-ink-faint">—</span>}</td> : null}
          <td className={cn(cell, "text-ink text-right font-medium")}>{formatAmount(supplier.total)}</td>
        </tr>)}</tbody>
        <tfoot className="border-hairline-strong bg-surface-sunken border-t"><tr>
          <th scope="row" className="text-ink px-3 py-3 text-left text-[13.5px] font-semibold">All suppliers</th>
          {AGEING_BUCKETS.map(bucket => <td key={bucket.key} className={cn(cell, "text-ink py-3 text-right font-semibold", narrow(bucket.key))}>{formatAmount(report.totals[bucket.key])}</td>)}
          {credit ? <td className={cn(cell, "text-ink py-3 text-right font-semibold")}>−{formatAmount(report.credit)}</td> : null}
          <td className={cn(cell, "text-ink py-3 text-right font-semibold")}>{formatAmount(report.total)}</td>
        </tr></tfoot>
      </table></div> : <RecordEmpty title="Nothing is owed">Every bill has been paid or voided.</RecordEmpty>}
      <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12.5px]">{report.count} unpaid bill{report.count === 1 ? "" : "s"} · as at {formatDate(report.at)} · ages run from each bill’s due date · a supplier opens their open items that day</p>
    </Panel>}
  </PageBody>;
}
