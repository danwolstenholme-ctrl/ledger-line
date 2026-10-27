import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getAccountingSettings, getLedgerBalances } from "@/lib/data/accounts";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_ORDER, financialYear, normalSign, trialBalance } from "@/lib/domain/accounts";
import { toCents } from "@/lib/domain/invoice-math";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { CreateRecordLink, RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Chart of accounts" };

/**
 * Every account the books post to, grouped as the statements group them, with
 * where each stands today. Income and expense accounts show this financial
 * year; everything else its balance.
 */
export default async function ChartPage() {
  await requireOrg();
  const { settings, today } = await getAccountingSettings();
  const year = financialYear(today, settings.year_end_month);
  const balances = await getLedgerBalances(year.from, today);
  const tb = new Map(trialBalance(balances.rows).lines.map(line => [line.accountId, (toCents(line.debit) - toCents(line.credit)) / 100]));
  const groups = ACCOUNT_TYPE_ORDER.map(type => ({ type, rows: balances.rows.filter(row => row.type === type).sort((a, b) => a.code.localeCompare(b.code)) })).filter(group => group.rows.length);

  return <PageBody className="space-y-4">
    <RecordHeader title="Chart of accounts" description={`Balances today · income and expenses since ${formatDate(year.from)}`} action={<CreateRecordLink href="/accounts/chart/new">Add an account</CreateRecordLink>} />
    <AccountsNav current="/accounts/chart" />
    <Panel className="overflow-hidden">
      {balances.failed ? <RecordFailure what="the chart of accounts" /> : <table className="w-full border-collapse">
        <thead className="sr-only"><tr><th scope="col">Code</th><th scope="col">Account</th><th scope="col">Balance</th></tr></thead>
        {groups.map((group, index) => <tbody key={group.type} className={cn(index > 0 && "border-hairline border-t")}>
          <tr><th colSpan={3} scope="colgroup" className="text-ink-faint bg-surface-sunken px-4 py-1.5 text-left text-[11px] font-semibold tracking-[0.06em] uppercase">{ACCOUNT_TYPES[group.type].group}</th></tr>
          {group.rows.map(row => {
            const balance = (tb.get(row.account_id) ?? 0) * normalSign(row.type);
            return <tr key={row.account_id} className={cn("hover:bg-surface-sunken border-hairline border-t", !row.is_active && "opacity-60")}>
              <td className="text-ink-faint w-20 px-4 py-2 font-mono text-[11.5px]">{row.code}</td>
              <td className="py-2 pr-3 text-[12.5px]">
                <Link href={`/accounts/chart/${row.account_id}`} className="text-ink hover:text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{row.name}</Link>
                {!row.is_active ? <span className="text-ink-faint ml-2 text-[11px]">Inactive</span> : null}
              </td>
              <td className={cn("px-4 py-2 text-right text-[12.5px] tabular-nums", balance < 0 ? "text-critical" : balance ? "text-ink" : "text-ink-faint")}>{balance ? formatAmount(balance) : "—"}</td>
            </tr>;
          })}
        </tbody>)}
      </table>}
    </Panel>
  </PageBody>;
}
