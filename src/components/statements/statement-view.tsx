import Link from "@/components/navigation/navigation-link";

import type { StatementData, StatementLine } from "@/lib/data/statements";
import { AGEING_BUCKETS } from "@/lib/domain/billing";
import { REPORT_RANGES } from "@/lib/domain/accounts";
import { STATEMENT_KIND_LABELS, STATEMENT_RANGES, STATEMENT_VIEWS, statementQuery, type StatementPeriod } from "@/lib/domain/statements";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/common/primitives";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { RecordFilterLinks } from "@/components/records/record-layout";
import { StatTile } from "@/components/reports/report-charts";

/** Where a line opens: the invoice or bill a payment paid, the credit note a refund was of. */
function recordHref(line: StatementLine) {
  switch (line.kind) {
    case "invoice": case "payment": return `/accounts/sales/${line.record_id}`;
    case "credit_note": case "refund": return `/accounts/credit-notes/${line.record_id}`;
    case "bill": case "bill_payment": return `/accounts/bills/${line.record_id}`;
    default: return `/accounts/supplier-credits/${line.record_id}`;
  }
}

const head = "text-ink-muted px-3 py-2 text-left text-[11.5px] font-medium tracking-[0.04em] uppercase first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const cell = "px-3 py-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const amount = "text-right tabular-nums whitespace-nowrap";

/**
 * A statement on screen, as its PDF and CSV have it: activity in a period
 * with the running balance, or open items on a day; what is owed by how
 * late; and the period chosen above it.
 */
export function StatementView({ data, period, base }: { data: StatementData; period: StatementPeriod; base: string }) {
  const supplier = data.party === "supplier";
  const owed = supplier ? "Balance we owe" : "Balance owed";
  const viewHref = (view: string) => `${base}?${statementQuery({ ...period, view: view as StatementPeriod["view"], ...(view === "open" ? { range: "this_month" } : { range: "last_3_months" }) })}`;
  const rows = period.order === "newest" ? [...data.lines].reverse() : data.lines;
  return <>
    <section aria-label="The account" className="ll-panel divide-hairline grid grid-cols-3 divide-x overflow-hidden">
      {period.view === "activity" ? <>
        <StatTile label="Brought forward" value={formatAmount(data.opening)} context={`on ${formatDate(data.from)}`} />
        <StatTile label={supplier ? "Billed, less paid and credited" : "Charged, less paid and credited"} value={formatAmount(data.charged - data.settled)}
          context={`${formatAmount(data.charged)} ${supplier ? "billed" : "charged"}, ${formatAmount(data.settled)} paid or credited`} />
      </> : <>
        <StatTile label="Open items" value={String(data.open.length)} context={data.open.length ? `${formatAmount(data.open.reduce((sum, item) => sum + item.outstanding, 0))} unpaid` : "Nothing unpaid"} />
        <StatTile label="Overdue" value={formatAmount(data.overdue)} tone={data.overdue > 0 ? "critical" : undefined} context={data.overdue > 0 ? "past its due date" : "Nothing overdue"} />
      </>}
      <StatTile label={owed} value={formatAmount(data.closing)} context={`on ${formatDate(data.to)}${data.unusedCredit > 0 ? `, after ${formatAmount(data.unusedCredit)} of credit` : ""}`} />
    </section>

    <Panel className="overflow-hidden">
      <div className="border-hairline flex flex-wrap items-end justify-between gap-3 border-b px-4 py-2.5">
        <RecordFilterLinks label="Statement" options={STATEMENT_VIEWS.map(view => ({ label: view.label, href: viewHref(view.key), active: period.view === view.key }))} />
        <PeriodPicker action={base} range={period.range} from={data.from} to={data.to} extra={{ view: period.view }}
          asAt={period.view === "open"} ranges={period.view === "open" ? REPORT_RANGES : STATEMENT_RANGES}
          choices={period.view === "activity" ? [{ name: "order", label: "Order", value: period.order, options: [{ key: "oldest", label: "Oldest first" }, { key: "newest", label: "Newest first" }] }] : []} />
      </div>
      <div className="overflow-x-auto">
        {period.view === "activity" ? <table className="w-full min-w-[640px] text-[13px]">
          <thead className="border-hairline bg-surface-sunken border-b"><tr>
            <th className={head}>Date</th><th className={head}>Details</th>
            <th className={cn(head, "text-right")}>{supplier ? "Billed" : "Charged"}</th><th className={cn(head, "text-right")}>Paid or credited</th><th className={cn(head, "text-right")}>Balance</th>
          </tr></thead>
          <tbody className="divide-hairline divide-y">
            {period.order === "oldest" ? <tr className="text-ink-muted"><td className={cell}>{formatDate(data.from)}</td><td className={cell}>Brought forward</td><td className={cell} /><td className={cell} /><td className={cn(cell, amount)}>{formatAmount(data.opening)}</td></tr> : null}
            {rows.map((line, index) => <tr key={`${line.kind}-${line.record_id}-${index}`}>
              <td className={cn(cell, "text-ink-muted whitespace-nowrap tabular-nums")}>{formatDate(line.date)}</td>
              <td className={cell}>
                <Link href={recordHref(line)} className="text-ink hover:text-brand">{STATEMENT_KIND_LABELS[line.kind]} <span className="font-mono text-[12.5px]">{line.reference || "—"}</span></Link>
                {line.against && line.against !== line.reference ? <span className="text-ink-faint"> · {line.against}</span> : null}
                {line.due_on ? <span className="text-ink-faint"> · due {formatDate(line.due_on)}</span> : null}
              </td>
              <td className={cn(cell, amount)}>{line.charged ? formatAmount(line.charged) : ""}</td>
              <td className={cn(cell, amount)}>{line.settled ? formatAmount(line.settled) : ""}</td>
              <td className={cn(cell, amount)}>{formatAmount(line.balance)}</td>
            </tr>)}
            {period.order === "newest" ? <tr className="text-ink-muted"><td className={cell}>{formatDate(data.from)}</td><td className={cell}>Brought forward</td><td className={cell} /><td className={cell} /><td className={cn(cell, amount)}>{formatAmount(data.opening)}</td></tr> : null}
            {rows.length ? null : <tr><td colSpan={5} className={cn(cell, "text-ink-faint py-4")}>Nothing in this period.</td></tr>}
          </tbody>
          <tfoot className="border-hairline border-t"><tr className="font-medium">
            <td className={cn(cell, "tabular-nums")}>{formatDate(data.to)}</td><td className={cell}>{owed}</td>
            <td className={cn(cell, amount)}>{formatAmount(data.charged)}</td><td className={cn(cell, amount)}>{formatAmount(data.settled)}</td><td className={cn(cell, amount)}>{formatAmount(data.closing)}</td>
          </tr></tfoot>
        </table> : <table className="w-full min-w-[640px] text-[13px]">
          <thead className="border-hairline bg-surface-sunken border-b"><tr>
            <th className={head}>Date</th><th className={head}>{supplier ? "Bill" : "Invoice"}</th><th className={head}>Due</th>
            <th className={cn(head, "text-right")}>Original</th><th className={cn(head, "text-right")}>Outstanding</th>
          </tr></thead>
          <tbody className="divide-hairline divide-y">
            {data.open.map(item => <tr key={item.id}>
              <td className={cn(cell, "text-ink-muted whitespace-nowrap tabular-nums")}>{formatDate(item.issued_on)}</td>
              <td className={cell}><Link href={supplier ? `/accounts/bills/${item.id}` : `/accounts/sales/${item.id}`} className="text-ink hover:text-brand font-mono text-[12.5px]">{item.number || "—"}</Link></td>
              <td className={cn(cell, "whitespace-nowrap tabular-nums", item.days_overdue > 0 ? "text-critical" : "text-ink-muted")}>{item.due_on ? formatDate(item.due_on) : "—"}{item.days_overdue > 0 ? ` · ${item.days_overdue} days late` : ""}</td>
              <td className={cn(cell, amount, "text-ink-muted")}>{formatAmount(item.total)}</td>
              <td className={cn(cell, amount)}>{formatAmount(item.outstanding)}</td>
            </tr>)}
            {data.unusedCredit > 0 ? <tr className="text-ink-muted"><td className={cell} /><td className={cell} colSpan={3}>Credit not yet used</td><td className={cn(cell, amount)}>−{formatAmount(data.unusedCredit)}</td></tr> : null}
            {data.open.length || data.unusedCredit > 0 ? null : <tr><td colSpan={5} className={cn(cell, "text-ink-faint py-4")}>Nothing was unpaid on {formatDate(data.to)}.</td></tr>}
          </tbody>
          <tfoot className="border-hairline border-t"><tr className="font-medium">
            <td className={cell} /><td className={cell} colSpan={3}>{owed} on {formatDate(data.to)}</td><td className={cn(cell, amount)}>{formatAmount(data.closing)}</td>
          </tr></tfoot>
        </table>}
      </div>
      <div className="border-hairline grid grid-cols-5 border-t">
        {AGEING_BUCKETS.map((bucket, index) => <div key={bucket.key} className={cn("px-3 py-2.5 sm:px-4", index ? "border-hairline border-l" : "")}>
          <p className="text-ink-faint text-[11px] tracking-[0.04em] uppercase">{index ? bucket.label : "Not yet due"}</p>
          <p className={cn("text-[13px] font-medium tabular-nums", index && data.ageing[bucket.key] > 0 ? "text-critical" : "text-ink")}>{formatAmount(data.ageing[bucket.key])}</p>
        </div>)}
      </div>
    </Panel>
  </>;
}
