import type { Metadata } from "next";

import { getLedgerAccounts, getManualJournal } from "@/lib/data/accounts";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import { formatDate } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { JournalForm } from "@/components/accounts/forms";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "New journal" };

/** The first day of the month after a date: where an accrual's reversal usually goes. */
const nextMonthStart = (date: string) => {
  const [year, month] = date.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
};

/** A new journal, or with ?reverse= one that undoes another: every debit becomes a credit, dated in the next month. */
export default async function NewJournalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOrg();
  const { reverse } = await searchParams;
  const [accounts, source] = await Promise.all([
    getLedgerAccounts({ activeOnly: true }),
    reverse && UUID_PATTERN.test(reverse) ? getManualJournal(reverse) : null,
  ]);
  const today = firmToday();
  let prefill;
  if (source) {
    const proposed = nextMonthStart(source.journal.entry_date);
    const date = source.lockDate && proposed <= source.lockDate ? today : proposed;
    const amount = (value: number) => Number(value) ? Number(value).toFixed(2) : "";
    prefill = { entry_date: date, reference: source.journal.reference, narration: `Reversal of ${source.journal.narration}`.slice(0, 300),
      lines: source.lines.map(line => ({ account_id: line.account_id, description: line.description ?? "", debit: amount(line.credit), credit: amount(line.debit) })) };
  }
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title={source ? "Reverse a journal" : "New journal"} back={source ? { href: `/accounts/journals/${source.journal.id}`, label: source.journal.narration } : { href: "/accounts/journals", label: "Journals" }}
      description={source ? `Every debit of the journal of ${formatDate(source.journal.entry_date)} becomes a credit. Check the date, then post it.` : "Debits and credits must be equal before it posts."} />
    {accounts.failed ? <RecordFailure what="the chart of accounts" /> : <Panel className="p-4 sm:p-5"><JournalForm accounts={accounts.rows} today={today} prefill={prefill} /></Panel>}
  </PageBody>;
}
