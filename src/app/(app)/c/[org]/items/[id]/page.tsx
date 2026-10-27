import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { setItemActive } from "@/lib/actions/sales";
import { getItem } from "@/lib/data/sales";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatQuantity } from "@/lib/domain/line-math";
import { formatAmount, formatDate } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { SubmitButton } from "@/components/common/form-fields";
import { RecordHeader, RecordSection } from "@/components/records/record-layout";
import { ItemForm } from "@/components/sales/item-form";

export const metadata: Metadata = { title: "Product" };

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getItem(id);
  if (!data) notFound();
  const { item, sold, accounts } = data;
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title={item.name} back={{ href: "/accounts/items", label: "Products and services" }}
      description={Number(sold.lines) ? `Sold ${formatQuantity(sold.quantity)}${item.unit ? ` ${item.unit}` : ""} on ${sold.lines} invoice line${Number(sold.lines) === 1 ? "" : "s"}, ${formatAmount(sold.net)} before VAT${sold.last ? `; last on ${formatDate(sold.last)}` : ""}.` : "Not on an invoice yet."} />
    <Panel className="p-4 sm:p-5"><ItemForm item={item} accounts={accounts} defaultAccount={item.account_id} /></Panel>
    <RecordSection title={item.is_active ? "Stop selling it" : "Sell it again"}>
      <form action={setItemActive} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <input type="hidden" name="id" value={item.id} /><input type="hidden" name="active" value={item.is_active ? "false" : "true"} />
        <p className="text-ink-muted min-w-0 flex-1 text-[12.5px]">{item.is_active ? "It leaves the list offered on new invoices. Invoices that have it keep it." : "It is offered on new invoices and quotes again."}</p>
        <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">{item.is_active ? "Stop selling it" : "Sell it again"}</SubmitButton>
      </form>
    </RecordSection>
  </PageBody>;
}
