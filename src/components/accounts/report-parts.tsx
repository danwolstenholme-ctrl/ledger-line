import type { ReactNode } from "react";
import Link from "@/components/navigation/navigation-link";
import { Download } from "lucide-react";

import { sectionTotalLabel, variance, type ReportLine, type StatementColumn, type StatementRow } from "@/lib/domain/accounts";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recordOutlineButton } from "@/components/records/record-layout";
import { PrintButton } from "@/components/accounts/print-button";
import { currentOrg } from "@/lib/org";

/**
 * The shared layout of a financial statement: sections of account lines with
 * a total under each, and the figures that matter (gross profit, net profit,
 * net assets) as ruled rows between them. Every figure opens that account's
 * transactions for the period of its column.
 */

export function periodLabel(from: string, to: string) {
  return `${formatDate(from)} – ${formatDate(to)}`;
}

/** The statement's own heading: whose books, and the period. The page title above names the report. */
export async function ReportHeading({ period, children, exportHref }: { period: string; children?: ReactNode; exportHref?: string }) {
  const org = await currentOrg();
  return <div className="flex flex-wrap items-end justify-between gap-3 px-0.5">
    <div>
      <p className="text-ink-faint text-[11px] font-semibold tracking-[0.06em] uppercase">{org?.name}{org?.vat_number ? ` · VAT ${org.vat_number}` : ""}</p>
      <p className="text-ink mt-0.5 text-[13.5px] font-medium">{period}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {children}
      <PrintButton />
      {exportHref && org ? <a href={exportHref.replace(/^\/accounts/, `/c/${org.slug}`)} download className={recordOutlineButton}><Download className="size-3.5" />Export</a> : null}
    </div>
  </div>;
}

const ACCOUNT = /^[0-9a-f-]{36}$/;
const accountHref = (accountId: string, column: StatementColumn) =>
  ACCOUNT.test(accountId) ? `/accounts/chart/${accountId}?range=custom&from=${column.from}&to=${column.to}` : null;
const signed = (value: number) => `${value > 0 ? "+" : ""}${formatAmount(value)}`;
const percent = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

/**
 * A statement in one column or several. With two periods compared, the
 * change and the change as a percentage follow. Wide statements (month by
 * month) scroll sideways with the account names held in place.
 */
export function Statement({ rows, columns, compared = false }: { rows: StatementRow[]; columns: StatementColumn[]; compared?: boolean }) {
  const multi = columns.length > 1;
  const wide = columns.length > 3;
  const figureCount = columns.length + (compared ? 2 : 0);
  const sticky = wide ? "sticky left-0 z-[1] bg-surface" : "";
  const amountCell = "px-3 py-1.5 text-right text-[12.5px] tabular-nums whitespace-nowrap";
  const figure = (value: number, faintZero: boolean) => faintZero && value === 0 ? <span className="text-ink-faint">—</span> : formatAmount(value);
  const extra = (amounts: number[], className: string) => {
    if (!compared) return null;
    const result = variance(amounts[0], amounts[1]);
    return <>
      <td className={cn(className, "text-ink-muted")}>{signed(result.change)}</td>
      <td className={cn(className, "text-ink-muted")}>{percent(result.percent)}</td>
    </>;
  };
  const line = (item: ReportLine) => <tr key={item.accountId} className="group hover:bg-surface-sunken">
    <td className={cn("px-4 py-1.5 text-[12.5px]", sticky, wide && "group-hover:bg-surface-sunken")}>
      {accountHref(item.accountId, columns[0])
        ? <Link href={accountHref(item.accountId, columns[0])!} className="text-ink hover:text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center"><span className="text-ink-faint mr-2 font-mono text-[11.5px]">{item.code}</span>{item.name}</Link>
        : <span className="text-ink">{item.code ? <span className="text-ink-faint mr-2 font-mono text-[11.5px]">{item.code}</span> : null}{item.name}</span>}
    </td>
    {item.amounts.map((amount, index) => {
      const href = multi ? accountHref(item.accountId, columns[index]) : null;
      return <td key={columns[index].label} className={cn(amountCell, "text-ink")}>
        {href && amount !== 0 ? <Link href={href} className="hover:text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{formatAmount(amount)}</Link> : figure(amount, multi)}
      </td>;
    })}
    {extra(item.amounts, amountCell)}
  </tr>;

  return <div className="ll-panel overflow-x-auto">
    <table className={cn("w-full border-collapse", wide && "min-w-max")}>
      <thead className={multi ? "border-hairline bg-surface-sunken border-b" : "sr-only"}>
        <tr>
          <th scope="col" className={cn("text-ink-faint px-4 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase", sticky, wide && "bg-surface-sunken")}>Account</th>
          {columns.map(column => <th key={column.label} scope="col" className="text-ink-faint px-3 py-2 text-right text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase">{column.label}</th>)}
          {compared ? <>
            <th scope="col" className="text-ink-faint px-3 py-2 text-right text-[11px] font-semibold tracking-[0.06em] uppercase">Change</th>
            <th scope="col" className="text-ink-faint px-3 py-2 text-right text-[11px] font-semibold tracking-[0.06em] uppercase">%</th>
          </> : null}
        </tr>
      </thead>
      {rows.map((row, index) => row.kind === "section" ? (
        <tbody key={row.section.key} className={cn(index > 0 && "border-hairline border-t")}>
          <tr><th colSpan={figureCount + 1} scope="colgroup" className="text-ink-faint px-4 pt-3 pb-1 text-left text-[11px] font-semibold tracking-[0.06em] uppercase">
            <span className={cn(wide && "sticky left-4")}>{row.section.title}</span>
          </th></tr>
          {row.section.lines.length ? row.section.lines.map(line)
            : <tr><td colSpan={figureCount + 1} className="text-ink-faint px-4 py-1.5 text-[12px]">Nothing in this period</td></tr>}
          <tr className="border-hairline border-t">
            <td className={cn("text-ink px-4 py-2 text-[12.5px] font-medium", sticky)}>{sectionTotalLabel(row)}</td>
            {row.section.totals.map((total, column) => <td key={columns[column].label} className={cn(amountCell, "text-ink py-2 font-medium")}>{formatAmount(total)}</td>)}
            {extra(row.section.totals, cn(amountCell, "py-2 font-medium"))}
          </tr>
        </tbody>
      ) : (
        <tbody key={`total-${row.label}`} className={cn("border-t", row.strong ? "border-ink bg-surface-sunken" : "border-hairline-strong")}>
          <tr>
            <th scope="row" className={cn("px-4 py-2.5 text-left font-semibold text-ink", row.strong ? "text-[13.5px]" : "text-[13px]", sticky, wide && row.strong && "bg-surface-sunken")}>{row.label}</th>
            {row.amounts.map((amount, column) => <td key={columns[column].label} className={cn("px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold", row.strong ? "text-[14px]" : "text-[13px]",
              column === 0 && row.tone === "critical" ? "text-critical" : "text-ink")}>{formatAmount(amount)}</td>)}
            {extra(row.amounts, cn("px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold", row.strong ? "text-[14px]" : "text-[13px]"))}
          </tr>
        </tbody>
      ))}
    </table>
  </div>;
}
