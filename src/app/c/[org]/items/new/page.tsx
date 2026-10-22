import type { Metadata } from "next";

import { getSalesFormData } from "@/lib/data/sales";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { ItemForm } from "@/components/sales/item-form";

export const metadata: Metadata = { title: "New product" };

export default async function NewItemPage() {
  const data = await getSalesFormData("invoice");
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title="New product or service" back={{ href: "/accounts/items", label: "Products and services" }} description="Its price before VAT, the VAT rate it is sold at, and the income account its sales go to." />
    <Panel className="p-4 sm:p-5"><ItemForm accounts={data.accounts} defaultAccount={data.salesAccount} /></Panel>
  </PageBody>;
}
