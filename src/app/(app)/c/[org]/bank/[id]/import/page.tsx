import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireOrg } from "@/lib/org";
import { getBankAccounts } from "@/lib/data/accounts";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { PageBody } from "@/components/common/primitives";
import { StatementImport } from "@/components/bank/statement-import";
import { RecordFailure, RecordHeader, RecordSection } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Import a statement" };

export default async function ImportStatementPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrg();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const banks = await getBankAccounts();
  if (banks.failed) return <PageBody><RecordFailure what="the bank accounts" /></PageBody>;
  const bank = banks.rows.find(row => row.id === id);
  if (!bank) notFound();
  return <PageBody className="space-y-4">
    <RecordHeader title={`Import a statement · ${bank.name}`} back={{ href: `/accounts/bank/${bank.id}`, label: "Reconcile" }}
      description="Lines are read and shown here first. Nothing is saved until you import, and nothing is posted: each line waits to be matched." />
    <RecordSection title="Statement file">
      <div className="p-4 sm:p-5"><StatementImport bankAccountId={bank.id} bankName={bank.name} /></div>
    </RecordSection>
  </PageBody>;
}
