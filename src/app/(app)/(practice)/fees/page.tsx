import type { Metadata } from "next";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getFees, monthName } from "@/lib/data/work";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { StatTile } from "@/components/reports/report-charts";
import { RecordBadge, RecordPagination, RecordEmpty, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";
import { ClientFeeForm, FeeFloorForm, RaiseFeesButton } from "@/components/work/forms";
import { ListSearch, clientMatches } from "@/components/common/list-search";

export const metadata: Metadata = { title: "Fees" };

const hoursOf = (minutes: number) => (minutes / 60).toFixed(1);
const STATUS: Record<string, { label: string; tone: "positive" | "caution" | "neutral" }> = { paid: { label: "Paid", tone: "positive" }, part_paid: { label: "Part paid", tone: "caution" }, issued: { label: "Invoiced", tone: "neutral" }, draft: { label: "Draft", tone: "neutral" } };

/** What each client pays the firm against the hours its books take, and the month's fees invoiced in one press. */
const PAGE_SIZE = 40;

export default async function FeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const data = await getFees(query.period);
  const matching = data.rows.filter(row => clientMatches(query.q ?? "", { name: row.name }));
  const page = Math.max(1, Math.min(Number(query.page) || 1, Math.ceil(matching.length / PAGE_SIZE) || 1));
  const rows = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const listHref = `/fees?${new URLSearchParams({ ...(query.period ? { period: query.period } : {}), ...(query.q ? { q: query.q } : {}) })}`;
  const month = monthName(data.month), short = month.split(" ")[0];
  const top = Math.max(data.floor * 1.6, ...data.rows.map(row => row.perHour ?? 0));
  const books = data.books ? `/c/${data.books.slug}` : null;

  return <PageBody className="space-y-4">
    <RecordHeader title="Fees"
      action={<div className="flex items-center gap-1.5">
        <Link href={`/fees?period=${data.previous}`} aria-label={`${monthName(data.previous)}`} className={recordOutlineButton}><ChevronLeft className="size-3.5" /></Link>
        <span className="text-ink min-w-28 px-1 text-center text-[13px] font-medium">{month}</span>
        <Link href={`/fees?period=${data.next}`} aria-label={`${monthName(data.next)}`} className={recordOutlineButton}><ChevronRight className="size-3.5" /></Link>
      </div>} />

    {query.raised ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex flex-wrap items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px]">
      <CheckCircle2 className="size-4 shrink-0" /><span><span className="font-medium">{query.raised} fee invoice{query.raised === "1" ? "" : "s"} raised for {month}</span>, issued in the firm’s own books and posted to its ledger.</span>
      {books ? <Link href={`${books}/sales`} className="font-medium underline-offset-2 hover:underline">Open them</Link> : null}
    </p> : null}

    <section aria-label={`${month} at a glance`} className="ll-panel bg-hairline grid grid-cols-2 gap-px overflow-hidden lg:grid-cols-4 [&>*]:bg-surface">
      <StatTile label="Fees this month" value={formatAmount(data.totals.fees)} context="Monthly fees and extra work, before VAT" />
      <StatTile label="Hours on clients" value={data.totals.hours.toFixed(1)} context={data.month === `${data.today.slice(0, 7)}-01` ? "So far this month" : "In the month"} href="/time" />
      <StatTile label="Earned per hour" value={data.totals.perHour ? formatAmount(data.totals.perHour) : "—"} context="Across every client" />
      <StatTile label={`Below your ${formatAmount(data.floor).replace(".00", "")} floor`} value={String(data.totals.below)} tone={data.totals.below ? "critical" : undefined} context={data.totals.below ? "Reprice at the next renewal" : "Every client clears it"} />
    </section>

    <Panel className="overflow-hidden">
      <header className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div><h2 className="text-ink text-[13.5px] font-semibold">What each client earns you</h2><p className="text-ink-faint text-[12px]">{month}: the fee against the hours logged</p></div>
        {data.rows.length > PAGE_SIZE ? <ListSearch action="/fees" value={query.q} placeholder="Find a client" keep={{ period: query.period }} /> : null}
        {data.isFuture ? <span className="text-ink-muted text-[12.5px]">{month} has not begun</span>
          : data.totals.toRaise.count ? <RaiseFeesButton period={data.month} month={short} count={data.totals.toRaise.count} net={data.totals.toRaise.net} />
          : <RecordBadge tone="positive">{short}’s fees are invoiced</RecordBadge>}
      </header>
      {data.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-[13px]">
        <thead><tr className="border-hairline bg-surface-sunken border-b text-left">
          {["Client", "Monthly fee", "App", "Extra work", "Hours", "Per hour", "Invoice"].map((label, index) => <th key={label} scope="col" className={cn("text-ink-faint px-4 py-2 text-[11.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase", index > 0 && index < 5 && "text-right", index === 5 && "w-[26%]")}>{label}</th>)}
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => {
          const status = row.invoice ? STATUS[row.invoice.status] ?? STATUS.issued : null;
          return <tr key={row.organisation_id} className="align-top">
            <td className="px-4 py-3">
              <Link href={`/c/${row.slug}`} className="text-ink hover:text-brand font-medium hover:underline">{row.name}</Link>
              <span className="text-ink-faint block text-[12px]">{row.manager ?? "No one yet"}</span>
              <details className="mt-1.5"><summary className="text-brand cursor-pointer text-[12px]">Change the fee</summary>
                <div className="pt-2"><ClientFeeForm organisationId={row.organisation_id} fee={row.monthly_fee} rate={row.hourly_rate} app={row.app_fee} /></div></details>
            </td>
            <td className="px-4 py-3 text-right tabular-nums">{formatAmount(row.monthly_fee)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{row.app_fee ? formatAmount(row.app_fee) : <span className="text-ink-faint">—</span>}</td>
            <td className="px-4 py-3 text-right tabular-nums">{row.extraMinutes ? <>{formatAmount(row.extraValue)}<span className="text-ink-faint block text-[12px]">{hoursOf(row.extraMinutes)}h at {formatAmount(row.hourly_rate).replace(".00", "")}</span></> : <span className="text-ink-faint">—</span>}</td>
            <td className="px-4 py-3 text-right tabular-nums">{hoursOf(row.minutes)}</td>
            <td className="px-4 py-3">
              {row.perHour === null ? <span className="text-ink-faint">No time logged</span> : <>
                <span className={cn("block font-semibold tabular-nums", row.belowFloor ? "text-caution" : "text-ink")}>{formatAmount(row.perHour)}</span>
                <span className="relative mt-1.5 block h-1.5 rounded-full bg-[var(--surface-sunken)] shadow-[inset_0_0_0_1px_var(--hairline)]" aria-hidden>
                  <span className={cn("absolute inset-y-0 left-0 rounded-full", row.belowFloor ? "bg-caution" : "bg-brand")} style={{ width: `${Math.min(100, row.perHour / top * 100)}%` }} />
                  <span className="border-ink-faint absolute -top-1 -bottom-1 border-l border-dashed" style={{ left: `${data.floor / top * 100}%` }} />
                </span>
                {row.belowFloor ? <span className="text-caution mt-1 block text-[12px]">Below your floor: reprice at renewal</span> : null}
              </>}
            </td>
            <td className="px-4 py-3">{row.invoice && status && books
              ? <span className="flex flex-col items-start gap-1"><Link href={`${books}/sales/${row.invoice.id}`} className="text-brand font-mono text-[12.5px] hover:underline">{row.invoice.number}</Link><RecordBadge tone={status.tone}>{status.label} · {formatAmount(row.invoice.total)}</RecordBadge></span>
              : <span className="text-ink-faint">Not invoiced</span>}</td>
          </tr>;
        })}</tbody>
      </table>{matching.length > PAGE_SIZE ? <RecordPagination page={page} total={matching.length} pageSize={PAGE_SIZE} href={listHref} /> : null}
      {!rows.length && query.q ? <RecordEmpty title={`No client matches “${query.q}”`}>Try part of the name.</RecordEmpty> : null}</div> : <RecordEmpty title="No client fees yet">Set a monthly fee for each client to see what it earns you.</RecordEmpty>}
      <div className="border-hairline bg-surface-sunken flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[13px]">
        <span className="text-ink-muted"><span className="text-ink font-medium">Ledgerline, resold under your name:</span> {data.totals.app.clients} client{data.totals.app.clients === 1 ? "" : "s"} pay you {formatAmount(data.totals.app.monthly)} a month for the app, invoiced with their fee. You keep all of it.</span>
        <span className="text-ink-faint">Set each client’s price under Change the fee.</span>
      </div>
      <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <FeeFloorForm floor={data.floor} />
        <span className="text-ink-faint text-[12px]">The dashed line on each bar is your floor.</span>
      </div>
    </Panel>
  </PageBody>;
}
