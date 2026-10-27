import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getAccountingSettings, getBankAccounts, getBankTransaction, getLedgerAccounts, getPostings } from "@/lib/data/accounts";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { PageBody } from "@/components/common/primitives";
import { BankTransactionForm, RemoveForm } from "@/components/accounts/forms";
import { Postings } from "@/components/accounts/postings";
import { RecordDisclosure, RecordFailure, RecordHeader, RecordSection } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Bank transaction" };

export default async function BankTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrg();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [result, accounts, banks, settings, postings] = await Promise.all([getBankTransaction(id), getLedgerAccounts(), getBankAccounts(), getAccountingSettings(), getPostings([id])]);
  if (result.failed) return <PageBody><RecordFailure what="this transaction" /></PageBody>;
  const item = result.transaction;
  if (!item) notFound();
  // A refund belongs to its credit note, the customer's or the supplier's: it is changed or removed there, never as a bank entry.
  const refund = item.credit_note_id ? { title: "Refund", href: `/accounts/credit-notes/${item.credit_note_id}`,
      body: `Money paid back to ${item.contact ?? "the customer"} against a credit note: it takes the credit off their account.` }
    : item.supplier_credit_id ? { title: "Refund received", href: `/accounts/supplier-credits/${item.supplier_credit_id}`,
      body: `Money ${item.contact ?? "the supplier"} paid back against their credit note: it settles the credit they owed the company.` } : null;
  const title = item.kind === "transfer" ? `Transfer to ${item.transfer_account_name}` : `${refund ? refund.title : item.kind === "spend" ? "Spent" : "Received"}${item.contact ? ` · ${item.contact}` : ""}`;
  const plain = (value: number | string) => Number(value).toFixed(2);
  if (refund) return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={title} description={`${formatDate(item.txn_date)} · ${item.bank_account_name} · ${formatAmount(Number(item.amount))}`} back={{ href: "/accounts/bank", label: "Bank" }} />
    <RecordSection title={refund.title}>
      <p className="text-ink-muted px-4 py-3.5 text-[12.5px] leading-relaxed sm:px-5">{refund.body}
        {" "}<Link href={refund.href} className="text-brand font-medium hover:underline">Open the credit note</Link> to change or remove it.</p>
    </RecordSection>
    <Postings entries={postings.entries} empty="Not posted yet." />
  </PageBody>;
  // The form needs the width for its lines, so how it posted sits below it rather than beside it.
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title={title} description={`${formatDate(item.txn_date)} · ${item.bank_account_name} · ${formatAmount(Number(item.amount))}`} back={{ href: "/accounts/bank", label: "Bank" }} />
    <RecordSection title="Transaction">
      <div className="p-4 sm:p-5">
        <BankTransactionForm accounts={accounts.rows} bankAccounts={banks.rows} defaultBank={settings.settings.default_bank_account_id} today={settings.today}
          transaction={{ id: item.id, kind: item.kind, bank_account_id: item.bank_account_id, transfer_account_id: item.transfer_account_id, txn_date: item.txn_date,
            contact: item.contact, reference: item.reference, amount: Number(item.amount), reverse_charge: item.reverse_charge, reverse_charge_kind: item.reverse_charge_kind,
            lines: result.lines.map(line => ({ description: line.description, account_id: line.account_id, net: plain(line.net), vat_rate: Number(line.vat_rate), vat_amount: plain(line.vat_amount) })) }} />
      </div>
      <RecordDisclosure title="Remove this transaction"><RemoveForm kind="bank" id={item.id} label="Remove from the books" /></RecordDisclosure>
    </RecordSection>
    <Postings entries={postings.entries} empty="Not posted yet." />
  </PageBody>;
}
