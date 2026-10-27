import type { Metadata } from "next";
import { CheckCircle2, Plus } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getItems } from "@/lib/data/sales";
import { formatUnitPrice } from "@/lib/domain/line-math";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordBadge, RecordEmpty, RecordHeader, recordButton, recordOutlineButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Products and services" };

/** What the company sells, priced once: on an invoice, typing a name fills in the price, the VAT rate and the income account. */
export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { added } = await searchParams;
  const { org, rows } = await getItems();
  const fresh = rows.find(row => row.id === added);
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title="Products and services" description="Priced once. On an invoice or a quote, type a name and its price, VAT rate and income account fill themselves in."
      action={<><Link href="/accounts/items/import" className={recordOutlineButton}>Import</Link><a href={`/c/${org.slug}/items/export`} className={recordOutlineButton}>Export</a><Link href="/accounts/items/new" className={recordButton}><Plus className="size-4" />New product</Link></>} />
    {fresh ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]"><CheckCircle2 className="size-4" />{fresh.name} added. It is ready to use on invoices and quotes.</p> : null}
    <Panel className="overflow-hidden">
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Product or service</th><th scope="col" className={head}>Code</th><th scope="col" className={cn(head, "text-right")}>Price</th>
          <th scope="col" className={head}>VAT</th><th scope="col" className={head}>Income account</th><th scope="col" className={cn(head, "text-right")}>Used</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className={cn("hover:bg-surface-sunken", !row.is_active && "opacity-60")}>
          <td className="px-3 py-2.5 text-[12.5px]"><Link href={`/accounts/items/${row.id}`} className="text-ink hover:text-brand font-medium">{row.name}</Link>{!row.is_active ? <span className="ml-2"><RecordBadge>Not sold</RecordBadge></span> : null}</td>
          <td className="text-ink-muted px-3 py-2.5 font-mono text-[11.5px]">{row.code ?? "—"}</td>
          <td className="px-3 py-2.5 text-right text-[12.5px] whitespace-nowrap tabular-nums">{formatUnitPrice(row.unit_price)}{row.unit ? <span className="text-ink-faint"> / {row.unit}</span> : null}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[12.5px]">{Number(row.vat_rate)}%</td>
          <td className="text-ink-muted px-3 py-2.5 text-[12.5px]"><span className="font-mono text-[11.5px]">{row.account_code}</span> · {row.account_name}</td>
          <td className="text-ink-muted px-3 py-2.5 text-right text-[12.5px] tabular-nums">{Number(row.used) ? `${row.used} line${Number(row.used) === 1 ? "" : "s"}` : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title="No products yet"><Link href="/accounts/items/new" className="text-brand font-medium">Add the first</Link>: what you sell most, with its price.</RecordEmpty>}
    </Panel>
  </PageBody>;
}
