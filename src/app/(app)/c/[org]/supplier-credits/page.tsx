import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getSupplierCredits } from "@/lib/data/purchases";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordBadge, RecordEmpty, RecordFilterLinks, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Supplier credits" };

const VIEWS = [{ key: "all", label: "All" }, { key: "unused", label: "Credit to use" }] as const;

/** Credit notes received from suppliers: what each took back, and what is left to use or to have refunded. */
export default async function SupplierCreditsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const view = VIEWS.find(item => item.key === query.view)?.key ?? "all";
  const { rows, unused } = await getSupplierCredits(view);
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title="Supplier credits" back={{ href: "/accounts/bills", label: "Bills" }}
      description={unused > 0 ? `${formatAmount(unused)} of suppliers' credit is still to use against bills or to have refunded.` : "Record one from the bill it corrects: open the bill and choose More, then Supplier credit note."} />
    <Panel className="overflow-hidden">
      <div className="border-hairline border-b px-4 py-2.5"><RecordFilterLinks label="Supplier credits" options={VIEWS.map(item => ({ label: item.label, href: `/accounts/supplier-credits?view=${item.key}`, active: view === item.key }))} /></div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Supplier</th><th scope="col" className={head}>Their number</th><th scope="col" className={head}>Date</th><th scope="col" className={head}>Corrects</th>
          <th scope="col" className={cn(head, "text-right")}>Total</th><th scope="col" className={head}>Status</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className={cn("hover:bg-surface-sunken", row.status === "void" && "opacity-60")}>
          <td className="px-3 py-2.5 text-[13px]"><Link href={`/accounts/supplier-credits/${row.id}`} className="text-ink hover:text-brand font-medium">{row.supplier_name}</Link></td>
          <td className="text-ink-muted px-3 py-2.5 font-mono text-[12.5px]">{row.number ?? "—"}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[13px] whitespace-nowrap">{formatDate(row.issued_on)}</td>
          <td className="px-3 py-2.5 text-[13px]">{row.bill_id ? <Link href={`/accounts/bills/${row.bill_id}`} className="text-ink-muted hover:text-brand font-mono">{row.bill_number ?? "Bill"}</Link> : <span className="text-ink-faint">—</span>}</td>
          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums">{formatAmount(row.total)}</td>
          <td className="px-3 py-2.5">{row.status === "void" ? <RecordBadge>Void</RecordBadge> : Number(row.remaining) > 0 ? <RecordBadge tone="caution">{formatAmount(row.remaining)} to use</RecordBadge> : <RecordBadge tone="positive">Used</RecordBadge>}</td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title="No supplier credits here">{view === "unused" ? "Every credit has been used or refunded." : "Record one from the bill it corrects."}</RecordEmpty>}
    </Panel>
  </PageBody>;
}
