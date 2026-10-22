import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getAsAtPeriod, getLedgerBalances } from "@/lib/data/accounts";
import { ACCOUNT_TYPES, trialBalance } from "@/lib/domain/accounts";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading } from "@/components/accounts/report-parts";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const period = await getAsAtPeriod(await searchParams);
  const balances = await getLedgerBalances(period.yearFrom, period.asAt);
  const tb = trialBalance(balances.rows);
  const query = new URLSearchParams({ range: period.range, from: period.from, to: period.to });
  const head = "text-ink-faint px-4 py-2 text-left text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase";
  const cell = "px-4 py-1.5 text-[12.5px] tabular-nums";
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Trial balance" back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/trial-balance" range={period.range} from={period.from} to={period.asAt} asAt />
    <ReportHeading period={`As at ${formatDate(period.asAt)} · income and expenses since ${formatDate(period.yearFrom)}`} exportHref={`/accounts/reports/trial-balance/export?${query}`} />
    {balances.failed ? <RecordFailure what="the trial balance" /> : <div className="ll-panel overflow-x-auto"><table className="w-full border-collapse">
      <thead><tr className="border-hairline bg-surface-sunken border-b">
        <th scope="col" className={head}>Account</th><th scope="col" className={cn(head, "hidden sm:table-cell")}>Type</th>
        <th scope="col" className={cn(head, "text-right")}>Debit</th><th scope="col" className={cn(head, "text-right")}>Credit</th>
      </tr></thead>
      <tbody className="divide-hairline divide-y">{tb.lines.map(line => <tr key={line.accountId} className="hover:bg-surface-sunken">
        <td className="px-4 py-1.5 text-[12.5px]"><Link href={`/accounts/chart/${line.accountId}?range=custom&from=${period.yearFrom}&to=${period.asAt}`} className="text-ink hover:text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center"><span className="text-ink-faint mr-2 font-mono text-[11.5px]">{line.code}</span>{line.name}</Link></td>
        <td className="text-ink-muted hidden px-4 py-1.5 text-[12px] sm:table-cell">{ACCOUNT_TYPES[line.type].label}</td>
        <td className={cn(cell, "text-right")}>{line.debit ? formatAmount(line.debit) : ""}</td>
        <td className={cn(cell, "text-right")}>{line.credit ? formatAmount(line.credit) : ""}</td>
      </tr>)}</tbody>
      <tfoot className="border-ink bg-surface-sunken border-t"><tr>
        <th scope="row" colSpan={2} className="text-ink px-4 py-2.5 text-left text-[13px] font-semibold">{tb.balanced ? "Total" : "Total — the columns do not agree"}</th>
        <td className={cn(cell, "py-2.5 text-right font-semibold", !tb.balanced && "text-critical")}>{formatAmount(tb.debit)}</td>
        <td className={cn(cell, "py-2.5 text-right font-semibold", !tb.balanced && "text-critical")}>{formatAmount(tb.credit)}</td>
      </tr></tfoot>
    </table></div>}
  </PageBody>;
}
