import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getAgedPayables, getSuppliers } from "@/lib/data/accounts";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { PurchasesNav } from "@/components/accounts/accounts-nav";
import { CreateRecordLink, RecordEmpty, RecordFailure, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Suppliers" };

const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase";

export default async function SuppliersPage() {
  const org = await requireOrg();
  const [suppliers, payables] = await Promise.all([getSuppliers(), getAgedPayables()]);
  const owed = new Map(payables.suppliers.map(supplier => [supplier.id, supplier]));
  return <PageBody className="space-y-4">
    <RecordHeader title="Suppliers" description="Who the company buys from, and what it owes each of them."
      action={<><Link href="/accounts/suppliers/import" className={recordOutlineButton}>Import</Link><a href={`/c/${org.slug}/suppliers/export`} className={recordOutlineButton}>Export</a><CreateRecordLink href="/accounts/suppliers/new">Add supplier</CreateRecordLink></>} />
    <PurchasesNav current="/accounts/suppliers" />
    <Panel className="overflow-hidden">
      {suppliers.failed ? <RecordFailure what="the suppliers" /> : !suppliers.rows.length ? <RecordEmpty title="No suppliers yet">
        A supplier is added the first time you record one of their bills, or here. <Link href="/accounts/suppliers/new" className="text-brand">Add supplier</Link>
      </RecordEmpty> : <div className="w-full overflow-x-auto"><table className="w-full border-collapse">
        <thead><tr className="border-hairline bg-surface-sunken border-b">
          <th scope="col" className={head}>Supplier</th><th scope="col" className={cn(head, "hidden md:table-cell")}>Email</th>
          <th scope="col" className={cn(head, "hidden sm:table-cell")}>VAT number</th><th scope="col" className={cn(head, "text-right")}>Owed</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{suppliers.rows.map(supplier => {
          const debt = owed.get(supplier.id);
          return <tr key={supplier.id} className={cn("hover:bg-surface-sunken", !supplier.is_active && "opacity-60")}>
            <td className="px-3 py-2 text-[12.5px]"><Link href={`/accounts/suppliers/${supplier.id}`} className="text-ink hover:text-brand font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">{supplier.name}</Link>{!supplier.is_active ? <span className="text-ink-faint ml-2 text-[11px]">Inactive</span> : null}</td>
            <td className="text-ink-muted hidden px-3 py-2 text-[12.5px] md:table-cell">{supplier.email ?? "—"}</td>
            <td className="text-ink-muted hidden px-3 py-2 font-mono text-[12px] sm:table-cell">{supplier.vat_number ?? "—"}</td>
            <td className={cn("px-3 py-2 text-right text-[12.5px] tabular-nums", debt && debt.oldest > 0 ? "text-critical font-medium" : "text-ink")}>{debt ? formatAmount(debt.total) : "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </Panel>
  </PageBody>;
}
