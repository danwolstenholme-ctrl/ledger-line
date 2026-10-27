import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { CustomerForm } from "@/components/sales/sale-actions";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const org = await requireOrg();
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title="New customer" back={{ href: "/accounts/customers", label: "Customers" }} description="Their VAT number and country decide how VAT applies to what you sell them." />
    <Panel className="p-4 sm:p-5"><CustomerForm companyTerms={org.payment_terms_days} /></Panel>
  </PageBody>;
}
