import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { one, sql } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import { getBankAccounts } from "@/lib/data/accounts";
import { formatFromName } from "@/lib/domain/bank-statements";
import { ibanIn } from "@/lib/domain/iban";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody } from "@/components/common/primitives";
import { StatementImport } from "@/components/bank/statement-import";
import { RecordFailure, RecordHeader, RecordSection } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Import a statement" };

export default async function ImportStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const org = await requireOrg();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const banks = await getBankAccounts();
  if (banks.failed) return <PageBody><RecordFailure what="the bank accounts" /></PageBody>;
  const bank = banks.rows.find(row => row.id === id);
  if (!bank) notFound();
  // The latest statement already imported, which the first new one should follow on from; and the account's IBAN, which each should be for.
  const [before, details, history] = await Promise.all([
    one<{ last: string | null; closing: number | null; file_name: string | null }>(
      "select last_date as last, closing_balance as closing, file_name from bank_statement_imports where bank_account_id = $1 and organisation_id = $2 and last_date is not null order by last_date desc, imported_at desc limit 1", [bank.id, org.id]),
    one<{ bank_details: string | null }>("select bank_details from ledger_accounts where id = $1 and organisation_id = $2", [bank.id, org.id]),
    // The statements imported before, latest first: one covering the same days in another kind of file would bring them in twice.
    sql<{ first: string; last: string; file_name: string | null }>("select first_date as first, last_date as last, file_name from bank_statement_imports where bank_account_id = $1 and organisation_id = $2 and first_date is not null and last_date is not null order by last_date desc limit 60", [bank.id, org.id]),
  ]);
  return <PageBody className="space-y-4">
    <RecordHeader title={`Import statements · ${bank.name}`} back={{ href: `/accounts/bank/${bank.id}`, label: "Reconcile" }} />
    <RecordSection title="Statement files">
      <div className="p-4 sm:p-5"><StatementImport bankAccountId={bank.id} bankName={bank.name} iban={ibanIn(details?.bank_details)} history={history.map(row => ({ first: row.first, last: row.last, name: row.file_name, format: formatFromName(row.file_name) }))}
        before={before ? { last: before.last, closing: before.closing === null ? null : Number(before.closing), format: formatFromName(before.file_name) } : null} /></div>
    </RecordSection>
  </PageBody>;
}
