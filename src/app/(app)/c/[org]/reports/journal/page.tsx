import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getJournalReport } from "@/lib/data/accounts";
import { JOURNAL_SOURCE_LABELS, JOURNAL_VIEWS } from "@/lib/domain/accounts";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading, periodLabel } from "@/components/accounts/report-parts";
import { RecordEmpty, RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Journal report" };

/** Every entry in the period with its lines and who posted it: Sage's day books and audit trail. */
export default async function JournalReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const report = await getJournalReport(await searchParams);
  const { period } = report;
  const query = new URLSearchParams({ range: period.range, from: period.from, to: period.to, source: report.view });
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase";
  const cell = "px-3 py-1.5 text-[13px] tabular-nums whitespace-nowrap";
  const balanced = report.debit === report.credit;
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="Journal report" back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/journal" range={period.range} from={period.from} to={period.to}
      choices={[{ name: "source", label: "Entries", value: report.view, options: JOURNAL_VIEWS }]} />
    <ReportHeading period={`${periodLabel(period.from, period.to)} · ${report.entries.length} entr${report.entries.length === 1 ? "y" : "ies"}`} exportHref={`/accounts/reports/journal/export?${query}`} />
    {report.failed ? <RecordFailure what="the journal report" /> : !report.entries.length ? <div className="ll-panel"><RecordEmpty title="No entries">Nothing was posted in this period.</RecordEmpty></div>
      : <div className="ll-panel overflow-x-auto"><table className="w-full min-w-[44rem] border-collapse">
        <thead><tr className="border-hairline bg-surface-sunken border-b">
          <th scope="col" className={head}>Date</th><th scope="col" className={head}>Entry and account</th>
          <th scope="col" className={cn(head, "text-right")}>Debit</th><th scope="col" className={cn(head, "text-right")}>Credit</th>
        </tr></thead>
        {report.entries.map(entry => <tbody key={entry.id} className="border-hairline border-t first:border-t-0">
          <tr>
            <td className={cn(cell, "text-ink-muted pt-2.5 align-top")}>{formatDate(entry.entry_date)}</td>
            <td colSpan={3} className="px-3 pt-2.5 pb-1 text-[13px]">
              <span className="text-ink-faint mr-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase">{JOURNAL_SOURCE_LABELS[entry.source]}</span>
              {entry.href ? <Link href={entry.href} className="text-ink hover:text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{entry.narration}</Link> : <span className="text-ink font-medium">{entry.narration}</span>}
              {entry.reference ? <span className="text-ink-faint font-mono text-[12px]"> · {entry.reference}</span> : null}
              <span className="text-ink-faint block text-[11.5px]">Posted {formatDateTime(entry.created_at)}{entry.postedBy ? ` by ${entry.postedBy}` : ""}</span>
            </td>
          </tr>
          {entry.lines.map(line => <tr key={line.id} className="hover:bg-surface-sunken">
            <td />
            <td className="px-3 py-1 pl-6 text-[13px]">
              <Link href={`/accounts/chart/${line.account_id}?range=custom&from=${period.from}&to=${period.to}`} className="text-ink hover:text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center">
                <span className="text-ink-faint mr-2 font-mono text-[12px]">{line.account_code}</span>{line.account_name}
              </Link>
              {line.description && line.description !== entry.narration ? <span className="text-ink-faint"> · {line.description}</span> : null}
            </td>
            <td className={cn(cell, "py-1 text-right")}>{Number(line.debit) ? formatAmount(Number(line.debit)) : ""}</td>
            <td className={cn(cell, "py-1 text-right")}>{Number(line.credit) ? formatAmount(Number(line.credit)) : ""}</td>
          </tr>)}
          <tr><td colSpan={4} className="pb-1.5" /></tr>
        </tbody>)}
        <tfoot className="border-ink bg-surface-sunken border-t"><tr>
          <th scope="row" colSpan={2} className="text-ink px-3 py-2.5 text-left text-[13.5px] font-semibold">{balanced ? "Total — every entry balances" : "Total — debits and credits do not agree"}</th>
          <td className={cn(cell, "py-2.5 text-right font-semibold", !balanced && "text-critical")}>{formatAmount(report.debit)}</td>
          <td className={cn(cell, "py-2.5 text-right font-semibold", !balanced && "text-critical")}>{formatAmount(report.credit)}</td>
        </tr></tfoot>
      </table></div>}
    {report.truncated ? <p className="text-ink-muted text-[12.5px]">Only the first entries are shown. Choose a shorter period to see them all.</p> : null}
  </PageBody>;
}
