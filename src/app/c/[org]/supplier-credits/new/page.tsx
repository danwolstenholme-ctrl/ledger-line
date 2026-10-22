import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSupplierCreditFormData } from "@/lib/data/purchases";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { SupplierCreditForm } from "@/components/purchases/supplier-credit-form";

export const metadata: Metadata = { title: "Record a supplier credit" };

const plain = (value: number | string) => Number(value).toFixed(2);

/** A supplier's credit note: from the bill it corrects (`?bill=`), or on its own. */
export default async function NewSupplierCreditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const data = await getSupplierCreditFormData(params.bill ?? null);
  if (params.bill && !data.bill) redirect(`/c/${data.org.slug}/bills`);
  const bill = data.bill;
  return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title="Record a supplier's credit note" back={bill ? { href: `/accounts/bills/${bill.id}`, label: bill.number ?? "The bill" } : { href: "/accounts/supplier-credits", label: "Supplier credits" }}
      description="As the supplier printed it: what they took back, at what VAT." />
    <Panel className="p-4 sm:p-5">
      <SupplierCreditForm suppliers={data.suppliers} accounts={data.accounts} today={data.today} cancelHref={bill ? `/accounts/bills/${bill.id}` : "/accounts/supplier-credits"}
        bill={bill ? { id: bill.id, number: bill.number, supplier_id: bill.supplier_id, supplier_name: bill.supplier_name, total: Number(bill.total), balance: Number(bill.balance),
          credited_before: Number(bill.credited_before), reverse_charge: bill.reverse_charge,
          lines: bill.lines.map(line => ({ description: line.description, account_id: line.account_id, net: plain(line.net), vat_rate: Number(line.vat_rate), vat_amount: plain(line.vat_amount) })) } : null} />
    </Panel>
  </PageBody>;
}
