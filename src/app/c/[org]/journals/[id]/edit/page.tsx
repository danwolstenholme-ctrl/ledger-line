import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getLedgerAccounts, getManualJournal } from "@/lib/data/accounts";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { orgPath } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { JournalForm } from "@/components/accounts/forms";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Edit journal" };

export default async function EditJournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, accounts] = await Promise.all([getManualJournal(id), getLedgerAccounts({ activeOnly: true })]);
  if (!data) notFound();
  if (data.locked) redirect(await orgPath(`/accounts/journals/${id}`));
  const { journal, lines } = data;
  const amount = (value: number) => Number(value) ? Number(value).toFixed(2) : "";
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title="Edit journal" description="Debits and credits must be equal before it saves." back={{ href: `/accounts/journals/${id}`, label: journal.narration }} />
    {accounts.failed ? <RecordFailure what="the chart of accounts" /> : <Panel className="p-4 sm:p-5">
      <JournalForm accounts={accounts.rows} today={firmToday()}
        journal={{ id, entry_date: journal.entry_date, reference: journal.reference, narration: journal.narration,
          lines: lines.map(line => ({ account_id: line.account_id, description: line.description ?? "", debit: amount(line.debit), credit: amount(line.credit) })) }} />
    </Panel>}
  </PageBody>;
}
