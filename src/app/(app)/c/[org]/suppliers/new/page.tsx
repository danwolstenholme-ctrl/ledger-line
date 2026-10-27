import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { getLedgerAccounts } from "@/lib/data/accounts";
import { codableAccounts } from "@/lib/domain/accounts";
import { PageBody, Panel } from "@/components/common/primitives";
import { SupplierForm } from "@/components/accounts/forms";
import { RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  await requireOrg();
  const accounts = await getLedgerAccounts({ activeOnly: true });
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title="Add supplier" back={{ href: "/accounts/suppliers", label: "Suppliers" }} />
    <Panel className="p-4 sm:p-5"><SupplierForm accounts={codableAccounts(accounts.rows)} /></Panel>
  </PageBody>;
}
