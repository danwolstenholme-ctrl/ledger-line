import type { Metadata } from "next";

import { getDocumentStyles } from "@/lib/data/document-styles";
import { getWorkspace } from "@/lib/data/workspace";
import { requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { CustomerForm } from "@/components/sales/sale-actions";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const org = await requireOrg();
  const [workspace, styles] = await Promise.all([getWorkspace(org.id), getDocumentStyles()]);
  const labels = workspace.labels.customer;
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title={`New ${labels[0].toLowerCase()}`} back={{ href: "/accounts/customers", label: labels[1] }} />
    <Panel className="p-4 sm:p-5"><CustomerForm companyTerms={org.payment_terms_days} companyLanguage={org.document_language} styles={styles.map(({ id, name, is_default }) => ({ id, name, is_default }))} /></Panel>
  </PageBody>;
}
