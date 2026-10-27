import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getClients } from "@/lib/data/crm";
import { countryName } from "@/lib/domain/countries";
import { formatAmount, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { NavigationForm } from "@/components/navigation/navigation-form";
import { RecordEmpty, RecordHeader, recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { getWorkspace } from "@/lib/data/workspace";

export const metadata: Metadata = { title: "Customers" };

/** Who the company sells to: one record each, with their people and work from the CRM and what they owe from the books. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = (await searchParams).q;
  const { org, rows } = await getClients(query);
  const [one, many] = (await getWorkspace(org.id)).labels.customer;
  const owed = rows.reduce((sum, row) => sum + Number(row.owed), 0);
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title={many} description={`${rows.length} ${(rows.length === 1 ? one : many).toLowerCase()}${query ? ` matching “${query}”` : ""}${owed ? `, owing ${formatAmount(owed)} between them` : ""}.`}
      action={<><Link href="/accounts/customers/import" className={recordOutlineButton}>Import</Link><a href={`/c/${org.slug}/customers/export`} className={recordOutlineButton}>Export</a><Link href="/accounts/customers/new" className={recordButton}><Plus className="size-4" />New {one.toLowerCase()}</Link></>} />
    <Panel className="overflow-hidden">
      <div className="border-hairline flex justify-end border-b px-4 py-2.5">
        <NavigationForm action="" method="get" className="border-hairline-strong flex h-8 w-full items-center gap-2 rounded-md border px-2.5 sm:w-64">
          <Search className="text-ink-faint size-3.5 shrink-0" />
          <input name="q" defaultValue={query ?? ""} placeholder="Name or contact" aria-label="Search customers" className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
        </NavigationForm>
      </div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-[12.5px]">
        <thead className="border-hairline bg-surface-sunken border-b"><tr><th className={head}>Customer</th><th className={head}>People</th><th className={cn(head, "text-right")}>Owed</th><th className={cn(head, "text-right")}>Overdue</th><th className={head}>Last activity</th></tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2.5"><Link href={`/accounts/customers/${row.id}`} className="text-ink hover:text-brand text-[13px] font-medium">{row.name}</Link><span className="text-ink-faint block text-[11.5px]">{[row.vat_number, row.country !== "CY" ? countryName(row.country) : null].filter(Boolean).join(" · ") || "Cyprus"}</span></td>
          <td className="text-ink-muted max-w-[18rem] truncate px-3 py-2.5">{row.people ?? "—"}</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{Number(row.owed) ? formatAmount(row.owed) : "—"}</td>
          <td className={cn("px-3 py-2.5 text-right tabular-nums", Number(row.overdue) ? "text-critical font-medium" : "text-ink-faint")}>{Number(row.overdue) ? formatAmount(row.overdue) : "—"}</td>
          <td className="text-ink-muted px-3 py-2.5 whitespace-nowrap">{row.last_activity ? formatRelative(row.last_activity) : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title={query ? "No customers match" : "No customers yet"}>{query ? "Try another name." : <><Link href="/accounts/customers/new" className="text-brand font-medium">Add a customer</Link>, or name one on a new invoice.</>}</RecordEmpty>}
    </Panel>
  </PageBody>;
}
