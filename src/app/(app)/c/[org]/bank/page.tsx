import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";

import { requireOrg } from "@/lib/org";
import { getBankAccounts, getRecentBankTransactions } from "@/lib/data/accounts";
import { getBankStatementState } from "@/lib/data/bank";
import { formatAmount, formatDate, formatRelative, formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel, PanelHeader } from "@/components/common/primitives";
import { RecordFailure, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Bank" };

const KIND = { spend: { label: "Spent", tone: "text-ink" }, receive: { label: "Received", tone: "text-positive" }, transfer: { label: "Transfer", tone: "text-ink-muted" } } as const;

/**
 * The company's bank accounts and what went through them outside invoices and
 * bills: card spending, bank charges, interest, money moved between accounts.
 * Each account is reconciled against its statements, and its full register —
 * every payment in and out — opens from here.
 */
export default async function BankPage() {
  const org = await requireOrg();
  const [banks, recent, statements] = await Promise.all([getBankAccounts(), getRecentBankTransactions(12), getBankStatementState()]);
  return <PageBody className="space-y-4">
    <RecordHeader title="Bank"
      action={<div className="flex flex-wrap gap-2">
        <Link href="/accounts/bank/new?kind=spend" className={recordOutlineButton}><ArrowUpRight className="size-3.5" />Spend money</Link>
        <Link href="/accounts/bank/new?kind=receive" className={recordOutlineButton}><ArrowDownLeft className="size-3.5" />Receive money</Link>
        <Link href="/accounts/bank/new?kind=transfer" className={recordOutlineButton}><ArrowLeftRight className="size-3.5" />Transfer</Link>
      </div>} />
    {banks.failed ? <RecordFailure what="the bank accounts" /> : <section aria-label="Bank accounts" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {banks.rows.map(bank => {
        const toMatch = statements.toMatch.get(bank.id) ?? 0, imported = statements.lastImport.get(bank.id), feed = statements.feeds.get(bank.id);
        return <div key={bank.id} className={cn("ll-panel flex flex-col px-4 py-3", !bank.isActive && "opacity-60")}>
          <span className="text-ink-faint block font-mono text-[11.5px]">{bank.code}</span>
          <span className="text-ink block text-[13.5px] font-medium">{bank.name}</span>
          <span className={cn("mt-1 block text-[18px] font-semibold", bank.balance < 0 ? "text-critical" : "text-ink")}>{formatAmount(bank.balance)}</span>
          <span className={cn("mt-1 block text-[12.5px]", toMatch ? "text-caution font-medium" : "text-ink-muted")}>
            {statements.failed ? "Statements could not be checked" : toMatch ? `${toMatch} statement line${toMatch === 1 ? "" : "s"} to match` : imported ? `All matched · last import ${formatRelative(imported)}` : "No statement imported yet"}
          </span>
          {feed ? <span className={cn("block text-[12px]", feed.status === "active" ? "text-ink-faint" : "text-critical")}>
            {feed.status === "active" ? `Bank feed · ${feed.last_synced_at ? `fetched ${formatAgo(feed.last_synced_at)}` : "not fetched yet"}` : feed.status === "expired" ? "Bank feed needs authorising again" : feed.status === "error" ? "Bank feed stopped: open to see why" : "Bank feed waiting for the bank"}
          </span> : null}
          <span className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-[12.5px]">
            <Link href={`/accounts/bank/${bank.id}`} className="text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">Reconcile</Link>
            <Link href={`/accounts/bank/${bank.id}/import`} className="text-brand hover:underline touch:inline-flex touch:min-h-10 touch:items-center">Import a statement</Link>
            <Link href={`/accounts/chart/${bank.id}`} className="text-ink-muted hover:text-ink hover:underline touch:inline-flex touch:min-h-10 touch:items-center">Every transaction</Link>
          </span>
        </div>;
      })}
      <Link href="/accounts/chart/new?type=bank" className="border-hairline-strong text-ink-muted hover:text-ink hover:bg-surface-sunken grid place-items-center rounded-lg border border-dashed px-4 py-6 text-[13px]">Add a bank account</Link>
    </section>}
    <Panel className="overflow-hidden">
      <PanelHeader title="Spent and received directly" hint="Not through an invoice or a bill" />
      {recent.failed ? <RecordFailure what="the bank transactions" /> : recent.rows.length ? <ul className="divide-hairline divide-y">{recent.rows.map(item => <li key={item.id}>
        <Link href={`/accounts/bank/transactions/${item.id}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2.5">
          <span className="text-ink-muted w-24 shrink-0 text-[12.5px] tabular-nums">{formatDate(item.txn_date)}</span>
          <span className={cn("w-20 shrink-0 text-[12.5px] font-medium", KIND[item.kind].tone)}>{item.credit_note_id ? "Refunded" : KIND[item.kind].label}</span>
          <span className="text-ink min-w-0 flex-1 truncate text-[13px]">{item.kind === "transfer" ? `${item.bank_account_name} → ${item.transfer_account_name}` : item.contact ?? item.description ?? item.reference ?? item.bank_account_name}</span>
          <span className={cn("shrink-0 text-[13px] font-medium tabular-nums", item.kind === "receive" ? "text-positive" : "text-ink")}>{item.kind === "spend" ? "−" : ""}{formatAmount(Number(item.amount))}</span>
        </Link>
      </li>)}</ul> : <p className="text-ink-faint px-4 py-6 text-center text-[13px]">Nothing yet. Card spending, bank charges and interest are recorded here.</p>}
      {recent.rows.length === 12 && org.default_bank_account_id ? <p className="border-hairline border-t px-4 py-2.5 text-[12.5px]"><Link href={`/accounts/chart/${org.default_bank_account_id}`} className="text-brand font-medium hover:underline">Every transaction</Link><span className="text-ink-faint"> · the latest 12 are shown here</span></p> : null}
    </Panel>
  </PageBody>;
}
