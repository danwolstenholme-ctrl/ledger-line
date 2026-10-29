import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getGeneralLedger } from "@/lib/data/accounts";
import { JOURNAL_SOURCE_LABELS, sideBalance } from "@/lib/domain/accounts";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading, periodLabel } from "@/components/accounts/report-parts";
import { RecordEmpty, RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "General ledger" };

/** Every transaction in the period, account by account: Sage's nominal activity. */
export default async function GeneralLedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const report = await getGeneralLedger(await searchParams);
  const { period } = report;
  const query = new URLSearchParams({ range: period.range, from: period.from, to: period.to });
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase";
  const cell = "px-3 py-1.5 text-[13px] tabular-nums whitespace-nowrap";
  const amount = (value: number) => value ? formatAmount(value) : "";
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="General ledger" back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/general-ledger" range={period.range} from={period.from} to={period.to} />
    <ReportHeading period={periodLabel(period.from, period.to)} exportHref={`/accounts/reports/general-ledger/export?${query}`} />
    {report.failed ? <RecordFailure what="the general ledger" /> : !report.accounts.length ? <div className="ll-panel"><RecordEmpty title="Nothing posted">Nothing was posted in this period.</RecordEmpty></div>
      : <div className="ll-panel overflow-x-auto"><table className="w-full min-w-[46rem] border-collapse">
        <thead><tr className="border-hairline bg-surface-sunken border-b">
          <th scope="col" className={head}>Date</th><th scope="col" className={head}>Detail</th>
          <th scope="col" className={cn(head, "text-right")}>Debit</th><th scope="col" className={cn(head, "text-right")}>Credit</th><th scope="col" className={cn(head, "text-right")}>Balance</th>
        </tr></thead>
        {report.accounts.map(account => <tbody key={account.id} className="border-hairline-strong border-t first:border-t-0">
          <tr>
            <th scope="colgroup" colSpan={5} className="px-3 pt-3 pb-1.5 text-left">
              <Link href={`/accounts/chart/${account.id}?range=custom&from=${period.from}&to=${period.to}`} className="text-ink hover:text-brand text-[13.5px] font-semibold hover:underline touch:inline-flex touch:min-h-10 touch:items-center">
                <span className="text-ink-faint mr-2 font-mono text-[12.5px]">{account.code}</span>{account.name}
              </Link>
            </th>
          </tr>
          <tr className="text-ink-faint"><td className={cell}>{formatDate(period.from)}</td><td className="px-3 py-1.5 text-[12.5px]" colSpan={3}>Brought forward</td><td className={cn(cell, "text-right")}>{sideBalance(account.opening)}</td></tr>
          {account.lines.map(line => <tr key={line.id} className="hover:bg-surface-sunken">
            <td className={cn(cell, "text-ink-muted")}>{formatDate(line.entry_date)}</td>
            <td className="max-w-[44ch] px-3 py-1.5 text-[13px]">
              {line.href ? <Link href={line.href} className="text-ink hover:text-brand block truncate hover:underline touch:flex touch:min-h-10 touch:items-center">{line.description ?? line.narration}</Link> : <span className="text-ink block truncate">{line.description ?? line.narration}</span>}
              <span className="text-ink-faint block text-[11.5px]">{JOURNAL_SOURCE_LABELS[line.source]}{line.reference ? ` · ${line.reference}` : ""}</span>
            </td>
            <td className={cn(cell, "text-right")}>{amount(Number(line.debit))}</td>
            <td className={cn(cell, "text-right")}>{amount(Number(line.credit))}</td>
            <td className={cn(cell, "text-ink-muted text-right")}>{sideBalance(line.balance)}</td>
          </tr>)}
          <tr className="border-hairline bg-surface-sunken border-t">
            <td className={cn(cell, "text-ink-muted")}>{formatDate(period.to)}</td>
            <th scope="row" className="text-ink px-3 py-2 text-left text-[13px] font-semibold">Carried forward</th>
            <td className={cn(cell, "text-ink py-2 text-right font-medium")}>{formatAmount(account.debit)}</td>
            <td className={cn(cell, "text-ink py-2 text-right font-medium")}>{formatAmount(account.credit)}</td>
            <td className={cn(cell, "text-ink py-2 text-right font-semibold")}>{sideBalance(account.closing)}</td>
          </tr>
        </tbody>)}
        <tfoot className="border-ink bg-surface-sunken border-t"><tr>
          <th scope="row" colSpan={2} className="text-ink px-3 py-2.5 text-left text-[13.5px] font-semibold">{report.debit === report.credit ? "Total for the period" : "Total — debits and credits do not agree"}</th>
          <td className={cn(cell, "py-2.5 text-right font-semibold", report.debit !== report.credit && "text-critical")}>{formatAmount(report.debit)}</td>
          <td className={cn(cell, "py-2.5 text-right font-semibold", report.debit !== report.credit && "text-critical")}>{formatAmount(report.credit)}</td>
          <td />
        </tr></tfoot>
      </table></div>}
    {report.truncated ? <p className="text-ink-muted text-[12.5px]">Only the first transactions are shown. Choose a shorter period to see them all.</p> : null}
  </PageBody>;
}
