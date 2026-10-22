import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { getAccountingSettings, getBankAccounts, getLedgerAccounts } from "@/lib/data/accounts";
import { PageBody, Panel } from "@/components/common/primitives";
import { BankTransactionForm } from "@/components/accounts/forms";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";
import { BANK_TRANSACTION_KINDS, type BankTransactionKind } from "@/types/database";

export const metadata: Metadata = { title: "Bank transaction" };

export default async function NewBankTransactionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const params = await searchParams;
  const kind: BankTransactionKind = BANK_TRANSACTION_KINDS.find(value => value === params.kind) ?? "spend";
  const [accounts, banks, settings] = await Promise.all([getLedgerAccounts({ activeOnly: true }), getBankAccounts(), getAccountingSettings()]);
  const active = banks.rows.filter(bank => bank.isActive);
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title={kind === "spend" ? "Spend money" : kind === "receive" ? "Receive money" : "Transfer between accounts"} back={{ href: "/accounts/bank", label: "Bank" }} />
    {accounts.failed || banks.failed ? <RecordFailure what="the accounts" /> : <Panel className="p-4 sm:p-5">
      <BankTransactionForm initialKind={kind} accounts={accounts.rows} bankAccounts={active} defaultBank={active.find(bank => bank.id === params.bank)?.id ?? settings.settings.default_bank_account_id} today={settings.today} />
    </Panel>}
  </PageBody>;
}
