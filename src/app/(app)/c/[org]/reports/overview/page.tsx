import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";
import { AlertTriangle, CheckCircle2, FileText, Info } from "lucide-react";

import { requireOrg } from "@/lib/org";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getAccountsDashboard } from "@/lib/data/accounts";
import { yearOnYear, type BooksCheck } from "@/lib/domain/accounts-insights";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { reportMonths } from "@/lib/domain/billing-report";
import { formatAmount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel, PanelHeader } from "@/components/common/primitives";
import { AiOverview } from "@/components/accounts/ai-overview";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";
import { BarList, ChartFrame, ColumnChart, LineChart, StackedBars, StatTile, type ChartSeries } from "@/components/reports/report-charts";

export const metadata: Metadata = { title: "Business overview" };

const RESULT: ChartSeries[] = [
  { key: "income", label: "Income", swatch: "bg-chart-billed" },
  { key: "expenses", label: "Expenses", swatch: "bg-chart-cost" },
];
// Written out whole: Tailwind only makes the classes it can read in the source.
const AGE_SWATCHES = ["bg-chart-age-1", "bg-chart-age-2", "bg-chart-age-3", "bg-chart-age-4", "bg-chart-age-5"];
const AGES: ChartSeries[] = AGEING_BUCKETS.map((bucket, index) => ({ key: bucket.key, label: bucket.key === "current" ? "Not yet due" : bucket.label, swatch: AGE_SWATCHES[index] ?? AGE_SWATCHES[AGE_SWATCHES.length - 1] }));
const euros = (value: number) => formatAmount(value);
const whole = (value: number) => formatMoney(value, "EUR");
const tick = (value: number) => formatMoney(value, "EUR", { compact: true });
const onLastYear = (change: number | null) => change === null ? null : `${change > 0 ? "+" : ""}${change.toFixed(0)}% on last year`;

const CHECK_ICONS = {
  ok: { icon: CheckCircle2, className: "text-positive", label: "Passes" },
  attention: { icon: AlertTriangle, className: "text-caution", label: "Needs a look" },
  info: { icon: Info, className: "text-ink-faint", label: "Note" },
} as const;

function CheckRow({ check }: { check: BooksCheck }) {
  const look = CHECK_ICONS[check.state];
  const body = <>
    <look.icon aria-label={look.label} className={cn("mt-0.5 size-4 shrink-0", look.className)} />
    <span className="min-w-0">
      <span className="text-ink block text-[13.5px] font-medium">{check.title}</span>
      <span className="text-ink-muted block text-[12.5px] leading-relaxed">{check.detail}</span>
    </span>
  </>;
  return <li>{check.href
    ? <Link href={check.href} className="hover:bg-surface-sunken flex gap-3 px-4 py-2.5 touch:min-h-11">{body}</Link>
    : <div className="flex gap-3 px-4 py-2.5">{body}</div>}</li>;
}

/**
 * The books at a glance: what is in the bank and owed each way, how the year
 * is going against the last, twelve months of income, costs and cash, where
 * the money goes, the checks an accountant runs first — and an AI read of
 * all of it on request.
 */
export default async function OverviewPage() {
  await requireOrg();
  const books = await getAccountsDashboard();
  const labels = new Map(reportMonths(books.today, 12).map(month => [month.key, month]));
  // Each month opens the figures behind it: its profit and loss, or where its cash came from and went.
  const monthPeriod = (key: string) => {
    const [year, month] = key.split("-").map(Number);
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return `range=custom&from=${key}-01&to=${end < books.today ? end : books.today}`;
  };
  const months = books.months.map(month => ({ ...month, label: labels.get(month.key)?.label ?? month.key, title: labels.get(month.key)?.title ?? month.key, period: monthPeriod(month.key) }));
  const activeBanks = books.banks.filter(bank => bank.isActive);
  const yearToDate = `range=custom&from=${books.year.from}&to=${books.today}`;
  const ai = !aiConfigured() ? "Add ANTHROPIC_API_KEY to .env.local and restart to switch this on."
    : !books.settings.ai_suggestions ? "Switched off for this company. Switch it on in its Settings." : null;
  // The books start on 1 July 2025: a comparison with a year they only half cover would mislead.
  const comparable = books.lastYear.from >= "2025-07-01";
  const head = "text-ink-faint px-3 py-2 text-[11.5px] font-semibold tracking-[0.06em] uppercase";
  const cell = "px-3 py-2 text-right text-[13px] tabular-nums";

  return <PageBody className="space-y-4">
    <RecordHeader title="Business overview" back={{ href: "/accounts/reports", label: "Reports" }}
      description="Cash, what is owed each way, the year so far, twelve months of income, costs and cash, and an AI read of all of it." />

    {books.failed ? <RecordFailure what="the books" /> : <>
      <section aria-label="Headline figures" className="ll-panel bg-hairline grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 xl:grid-cols-6 [&>*]:bg-surface">
        <StatTile label="Cash in the bank" value={euros(books.position.cash)} tone={books.position.cash < 0 ? "critical" : undefined}
          context={`${activeBanks.length} bank account${activeBanks.length === 1 ? "" : "s"}`} href="/accounts/bank" />
        <StatTile label="Owed to the company" value={euros(books.position.receivable)}
          context={books.receivables.overdue > 0 ? `${whole(books.receivables.overdue)} overdue` : "Nothing overdue"} href="/invoices/ageing" />
        <StatTile label="Owed by the company" value={euros(books.position.payable)} tone={books.payables.overdue > 0 ? "critical" : undefined}
          context={books.payables.overdue > 0 ? `${whole(books.payables.overdue)} overdue` : `${books.payables.count} unpaid bill${books.payables.count === 1 ? "" : "s"}`} href="/accounts/bills" />
        <StatTile label="Income this year" value={euros(books.thisYear.income)}
          context={(comparable ? onLastYear(yearOnYear(books.thisYear.income, books.priorYear.income)) : null) ?? `Since ${formatDate(books.year.from)}`} href={`/accounts/reports/profit-and-loss?range=this_year&compare=previous_year`} />
        <StatTile label="Profit this year" value={euros(books.thisYear.profit)} tone={books.thisYear.profit < 0 ? "critical" : undefined}
          context={[books.thisYear.margin !== null ? `${books.thisYear.margin.toFixed(0)}% margin` : null, comparable ? onLastYear(yearOnYear(books.thisYear.profit, books.priorYear.profit)) : null].filter(Boolean).join(" · ") || `Since ${formatDate(books.year.from)}`}
          href="/accounts/reports/profit-and-loss?range=this_year&compare=previous_year" />
        <StatTile label="VAT this quarter" value={euros(Math.abs(books.vat.net))} context={books.vat.net >= 0 ? "To pay, so far" : "To reclaim, so far"} href={`/accounts/reports/vat?range=custom&from=${books.quarterStart}&to=${books.today}`} />
      </section>

      <AiOverview unavailable={ai} />

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <ChartFrame title="Income and expenses" hint="By month · press a month for its profit and loss" legend={RESULT}
          table={<table className="w-full border-collapse">
            <thead><tr className="border-hairline border-b text-left"><th scope="col" className={head}>Month</th><th scope="col" className={cn(head, "text-right")}>Income</th><th scope="col" className={cn(head, "text-right")}>Expenses</th><th scope="col" className={cn(head, "text-right")}>Profit</th></tr></thead>
            <tbody className="divide-hairline divide-y">{months.map(month => <tr key={month.key}>
              <th scope="row" className="px-3 py-2 text-left text-[13px] font-normal">{month.title}</th>
              <td className={cell}>{euros(month.income)}</td><td className={cell}>{euros(month.expenses)}</td>
              <td className={cn(cell, month.profit < 0 && "text-critical")}>{euros(month.profit)}</td>
            </tr>)}</tbody>
          </table>}>
          <ColumnChart series={RESULT} columns={months.map(month => ({ key: month.key, label: month.label, title: month.title, values: { income: month.income, expenses: month.expenses }, href: `/accounts/reports/profit-and-loss?${month.period}` }))}
            format={euros} formatTick={tick} label="Income and expenses by month" />
        </ChartFrame>
        <ChartFrame title="Cash in the bank" hint="At each month’s end · press a month for where the money came from and went"
          table={<table className="w-full border-collapse">
            <thead><tr className="border-hairline border-b text-left"><th scope="col" className={head}>Month</th><th scope="col" className={cn(head, "text-right")}>In</th><th scope="col" className={cn(head, "text-right")}>Out</th><th scope="col" className={cn(head, "text-right")}>Balance</th></tr></thead>
            <tbody className="divide-hairline divide-y">{months.map(month => <tr key={month.key}>
              <th scope="row" className="px-3 py-2 text-left text-[13px] font-normal">{month.title}</th>
              <td className={cell}>{euros(month.moneyIn)}</td><td className={cell}>{euros(month.moneyOut)}</td>
              <td className={cn(cell, month.cash < 0 && "text-critical")}>{euros(month.cash)}</td>
            </tr>)}</tbody>
          </table>}>
          <LineChart points={months.map(month => ({ key: month.key, label: month.label, title: month.title, value: month.cash, detail: `${euros(month.moneyIn)} in · ${euros(month.moneyOut)} out`, href: `/accounts/reports/cash-flow?${month.period}` }))}
            format={euros} formatTick={tick} label="Cash in the bank at each month's end" stroke="var(--color-chart-received)" dot="bg-chart-received" />
        </ChartFrame>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <ChartFrame title="Where the money goes" hint={`Expenses since ${formatDate(books.year.from)}`}
          table={<table className="w-full border-collapse">
            <thead><tr className="border-hairline border-b text-left"><th scope="col" className={head}>Account</th><th scope="col" className={cn(head, "text-right")}>Amount</th><th scope="col" className={cn(head, "text-right")}>Share</th></tr></thead>
            <tbody className="divide-hairline divide-y">
              {books.expenses.top.map(item => <tr key={item.accountId}><th scope="row" className="px-3 py-2 text-left text-[13px] font-normal">{item.code} · {item.name}</th><td className={cell}>{euros(item.amount)}</td><td className={cell}>{item.share.toFixed(1)}%</td></tr>)}
              {books.expenses.other > 0 ? <tr><th scope="row" className="px-3 py-2 text-left text-[13px] font-normal">Everything else</th><td className={cell}>{euros(books.expenses.other)}</td><td className={cell}>{(100 - books.expenses.top.reduce((sum, item) => sum + item.share, 0)).toFixed(1)}%</td></tr> : null}
            </tbody>
          </table>}>
          <BarList empty="Nothing spent yet this year." rows={[
            ...books.expenses.top.map(item => ({ key: item.accountId, label: item.name, href: `/accounts/chart/${item.accountId}?${yearToDate}`, value: item.amount, display: euros(item.amount), note: `${item.share.toFixed(0)}% of expenses`, swatch: "bg-chart-cost" })),
            ...(books.expenses.other > 0 ? [{ key: "other", label: "Everything else", value: books.expenses.other, display: euros(books.expenses.other), note: `${books.expenses.otherCount} more account${books.expenses.otherCount === 1 ? "" : "s"}`, swatch: "bg-chart-cost/45", tone: "faint" as const }] : []),
          ]} />
        </ChartFrame>
        <ChartFrame title="Who owes what" hint="By how far past due" legend={AGES}
          table={<table className="w-full border-collapse">
            <thead><tr className="border-hairline border-b text-left"><th scope="col" className={head}>Owed</th>{AGES.map(age => <th key={age.key} scope="col" className={cn(head, "text-right")}>{age.label}</th>)}<th scope="col" className={cn(head, "text-right")}>Total</th></tr></thead>
            <tbody className="divide-hairline divide-y">
              {[{ label: "To the company", ageing: books.receivables }, { label: "By the company", ageing: books.payables }].map(row => <tr key={row.label}>
                <th scope="row" className="px-3 py-2 text-left text-[13px] font-normal">{row.label}</th>
                {AGES.map(age => <td key={age.key} className={cell}>{euros(row.ageing.buckets[age.key as keyof typeof row.ageing.buckets])}</td>)}
                <td className={cn(cell, "font-medium")}>{euros(row.ageing.total)}</td>
              </tr>)}
            </tbody>
          </table>}>
          <StackedBars series={AGES} format={euros} label="Owed to and by the company, by age" rows={[
            { key: "receivables", label: "Owed to the company", href: "/invoices/ageing", total: books.receivables.total, values: books.receivables.buckets, note: `${books.receivables.count} invoice${books.receivables.count === 1 ? "" : "s"} · ${books.receivables.clients} customer${books.receivables.clients === 1 ? "" : "s"}` },
            { key: "payables", label: "Owed by the company", href: "/accounts/reports/aged-payables", total: books.payables.total, values: books.payables.buckets, note: `${books.payables.count} bill${books.payables.count === 1 ? "" : "s"}` },
          ]} />
        </ChartFrame>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Books health" hint={books.checks.some(check => check.state === "attention") ? undefined : "All checks pass"} />
          <ul className="divide-hairline divide-y">{books.checks.map(check => <CheckRow key={check.key} check={check} />)}</ul>
        </Panel>
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Bank accounts" action={<Link href="/accounts/bank" className="text-brand text-[12.5px] touch:inline-flex touch:min-h-10 touch:items-center">Bank</Link>} />
          <ul className="divide-hairline divide-y">{activeBanks.map(bank => <li key={bank.id}>
            <Link href={`/accounts/chart/${bank.id}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2.5 touch:min-h-11 touch:items-center">
              <span className="text-ink-faint font-mono text-[12px]">{bank.code}</span>
              <span className="text-ink min-w-0 flex-1 truncate text-[13.5px]">{bank.name}</span>
              <span className={cn("text-[13.5px] font-medium tabular-nums", bank.balance < 0 ? "text-critical" : "text-ink")}>{euros(bank.balance)}</span>
            </Link>
          </li>)}</ul>
        </Panel>
        <Panel className="min-w-0 overflow-hidden">
          <PanelHeader title="Bills to pay" count={books.payables.count} action={<Link href="/accounts/bills" className="text-brand text-[12.5px] touch:inline-flex touch:min-h-10 touch:items-center">All bills</Link>} />
          {books.billsToPay.length ? <ul className="divide-hairline divide-y">{books.billsToPay.map(bill => <li key={bill.id}>
            <Link href={`/accounts/bills/${bill.id}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2.5 touch:min-h-11 touch:items-center">
              <FileText aria-hidden className="text-ink-faint size-3.5 shrink-0 translate-y-0.5" />
              <span className="min-w-0 flex-1 truncate text-[13.5px]"><span className="text-ink">{bill.supplier_name}</span>{bill.number ? <span className="text-ink-faint font-mono text-[12px]"> · {bill.number}</span> : null}</span>
              <span className={cn("shrink-0 text-[12.5px] tabular-nums", bill.days_overdue > 0 ? "text-critical font-medium" : "text-ink-muted")}>{bill.due_on ? (bill.days_overdue > 0 ? `${bill.days_overdue} days late` : `Due ${formatDate(bill.due_on)}`) : "No due date"}</span>
              <span className="text-ink shrink-0 text-[13.5px] font-medium tabular-nums">{euros(Number(bill.balance))}</span>
            </Link>
          </li>)}</ul> : <p className="text-ink-faint px-4 py-6 text-center text-[13px]">Nothing to pay. <Link href="/accounts/bills/new" className="text-brand">Record a bill</Link></p>}
        </Panel>
      </div>
    </>}
  </PageBody>;
}
