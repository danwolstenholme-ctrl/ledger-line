import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { getLedgerAccounts, getSuppliers } from "@/lib/data/accounts";
import { firmToday } from "@/lib/domain/invoices";
import { PageBody, Panel } from "@/components/common/primitives";
import { BillForm } from "@/components/accounts/forms";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Record a bill" };

export default async function NewBillPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const params = await searchParams;
  const [accounts, suppliers] = await Promise.all([getLedgerAccounts({ activeOnly: true }), getSuppliers({ activeOnly: true })]);
  const supplier = typeof params.supplier === "string" ? params.supplier : undefined;
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title="Record a bill" back={{ href: "/accounts/bills", label: "Purchases" }} />
    {accounts.failed || suppliers.failed ? <RecordFailure what="the accounts and suppliers" /> : <Panel className="p-4 sm:p-5">
      <BillForm suppliers={suppliers.rows} accounts={accounts.rows} today={firmToday()} defaultSupplierId={supplier} />
    </Panel>}
  </PageBody>;
}
