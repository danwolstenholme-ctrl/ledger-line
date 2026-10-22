import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { LedgerAccountForm } from "@/components/accounts/forms";
import { RecordHeader } from "@/components/records/record-layout";
import { LEDGER_ACCOUNT_TYPES } from "@/types/database";

export const metadata: Metadata = { title: "Add an account" };

export default async function NewLedgerAccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const params = await searchParams;
  const type = LEDGER_ACCOUNT_TYPES.find(value => value === params.type);
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title={type === "bank" ? "Add a bank account" : "Add an account"} back={{ href: "/accounts/chart", label: "Chart of accounts" }} />
    <Panel className="p-4 sm:p-5"><LedgerAccountForm defaultType={type} /></Panel>
  </PageBody>;
}
