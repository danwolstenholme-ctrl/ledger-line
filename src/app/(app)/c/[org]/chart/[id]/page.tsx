import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { requireOrg } from "@/lib/org";
import { getAccountingSettings, getAccountTransactions } from "@/lib/data/accounts";
import { ACCOUNT_TYPES, isResultAccount, normalSign, resolvePeriod } from "@/lib/domain/accounts";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { LedgerAccountForm } from "@/components/accounts/forms";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { RecordFailure, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Account" };

const SOURCE_LABELS = { invoice: "Invoice", invoice_payment: "Payment received", bill: "Bill", bill_payment: "Bill paid", bank: "Bank", manual: "Journal", credit_note: "Credit note", supplier_credit: "Supplier credit", payroll: "Payroll" } as const;

/**
 * One account's transactions for a period, with the balance after each: the
 * bank register for a bank account, and where every report line comes from.
 */
export default async function LedgerAccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const query = await searchParams;
  const { settings, today } = await getAccountingSettings();
  const period = resolvePeriod(query, today, settings.year_end_month);
  const result = await getAccountTransactions(id, period.from, period.to);
  if (result.failed && !result.account) return <PageBody><RecordFailure what="this account" /></PageBody>;
  const account = result.account;
  if (!account) notFound();
  const sign = normalSign(account.type);
  const shown = (value: number) => value * sign;
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase";
  const cell = "px-3 py-2 text-[13px] whitespace-nowrap tabular-nums";

  return <PageBody className="space-y-4">
    <RecordHeader title={`${account.code} · ${account.name}`} description={`${ACCOUNT_TYPES[account.type].label}${account.is_active ? "" : " · inactive"}${account.system_role ? " · used by the books" : ""}`}
      back={{ href: account.type === "bank" ? "/accounts/bank" : "/accounts/chart", label: account.type === "bank" ? "Bank" : "Chart of accounts" }}
      action={account.type === "bank" && account.is_active ? <div className="flex flex-wrap gap-2">
        <Link href={`/accounts/bank/new?kind=spend&bank=${account.id}`} className={recordOutlineButton}><ArrowUpRight className="size-3.5" />Spend money</Link>
        <Link href={`/accounts/bank/new?kind=receive&bank=${account.id}`} className={recordOutlineButton}><ArrowDownLeft className="size-3.5" />Receive money</Link>
      </div> : null} />

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <RecordSection title="Transactions" hint={`${formatDate(period.from)} – ${formatDate(period.to)}`}>
        <div className="border-hairline border-b px-4 py-2.5"><PeriodPicker action={`/accounts/chart/${account.id}`} range={period.range} from={period.from} to={period.to} /></div>
        {result.failed ? <RecordFailure what="the transactions" /> : <div className="w-full overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr className="border-hairline bg-surface-sunken border-b">
            <th scope="col" className={head}>Date</th><th scope="col" className={head}>Detail</th>
            <th scope="col" className={cn(head, "text-right")}>Debit</th><th scope="col" className={cn(head, "text-right")}>Credit</th>
            <th scope="col" className={cn(head, "hidden text-right sm:table-cell")}>Balance</th>
          </tr></thead>
          <tbody className="divide-hairline divide-y">
            <tr className="text-ink-muted"><td className={cell}>{formatDate(period.from)}</td><td className="px-3 py-2 text-[13px]" colSpan={3}>{isResultAccount(account.type) ? "Start of the period" : "Opening balance"}</td><td className={cn(cell, "hidden text-right sm:table-cell")}>{formatAmount(shown(result.opening))}</td></tr>
            {result.rows.map(line => <tr key={line.id} className="hover:bg-surface-sunken">
              <td className={cn(cell, "text-ink-muted")}>{formatDate(line.entry_date)}</td>
              <td className="max-w-[40ch] px-3 py-2 text-[13px]">
                {line.href ? <Link href={line.href} className="text-ink hover:text-brand block truncate hover:underline touch:flex touch:min-h-10 touch:items-center">{line.description ?? line.narration}</Link> : <span className="text-ink block truncate">{line.description ?? line.narration}</span>}
                <span className="text-ink-faint block text-[11.5px]">{SOURCE_LABELS[line.source]}{line.reference ? ` · ${line.reference}` : ""}</span>
              </td>
              <td className={cn(cell, "text-right")}>{Number(line.debit) ? formatAmount(Number(line.debit)) : ""}</td>
              <td className={cn(cell, "text-right")}>{Number(line.credit) ? formatAmount(Number(line.credit)) : ""}</td>
              <td className={cn(cell, "text-ink-muted hidden text-right sm:table-cell")}>{formatAmount(shown(line.balance))}</td>
            </tr>)}
          </tbody>
          <tfoot className="border-hairline-strong bg-surface-sunken border-t"><tr>
            <td className={cn(cell, "text-ink-muted")}>{formatDate(period.to)}</td>
            <th scope="row" colSpan={3} className="text-ink px-3 py-2.5 text-left text-[13px] font-semibold">{isResultAccount(account.type) ? "Total for the period" : "Closing balance"}</th>
            <td className={cn(cell, "text-ink py-2.5 text-right font-semibold")}>{formatAmount(shown(result.closing))}</td>
          </tr></tfoot>
        </table></div>}
        {!result.failed && !result.rows.length ? <p className="text-ink-faint border-hairline border-t px-4 py-3 text-[13px]">Nothing posted to this account in the period.</p> : null}
        {result.truncated ? <p className="text-ink-muted border-hairline border-t px-4 py-2.5 text-[12.5px]">Only the first transactions are shown. Choose a shorter period to see them all.</p> : null}
      </RecordSection>

      <RecordSection title="Account">
        <div className="p-4 sm:p-5"><LedgerAccountForm key={account.updated_at} account={account} /></div>
      </RecordSection>
    </div>
  </PageBody>;
}
