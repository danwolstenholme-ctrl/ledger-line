import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getMatters } from "@/lib/data/crm";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { MatterStatus, PriorityFlag, dueTone } from "@/components/crm/badges";

export const metadata: Metadata = { title: "Matters" };

export default async function MattersPage() {
  const { org, rows, today } = await getMatters();
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title="Matters" description={`${rows.filter(row => row.status !== "completed").length} open: each with its owner and next action.`} />
    <Panel className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-[12.5px]">
      <thead className="border-hairline bg-surface-sunken border-b"><tr><th className={head}>Matter</th><th className={head}>Customer</th><th className={head}>Next action</th><th className={head}>Owner</th><th className={head}>Status</th><th className={cn(head, "text-right")}>Value</th></tr></thead>
      <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
        <td className="px-3 py-2.5"><Link href={`/c/${org.slug}/crm/matters/${row.id}`} className="text-ink font-medium hover:text-brand">{row.title}</Link><span className="text-ink-faint block font-mono text-[11px]">{row.reference}</span></td>
        <td className="px-3 py-2.5">{row.customer_id ? <Link href={`/c/${org.slug}/customers/${row.customer_id}`} className="text-ink-muted hover:text-brand">{row.customer_name}</Link> : "—"}</td>
        <td className={cn("px-3 py-2.5", dueTone(row.next_action_due, today))}>{row.next_action ?? "—"}{row.next_action_due ? <span className="block text-[11.5px]">{formatDate(row.next_action_due)}</span> : null}</td>
        <td className="text-ink-muted px-3 py-2.5">{row.owner}</td>
        <td className="px-3 py-2.5"><span className="flex items-center gap-1.5"><MatterStatus status={row.status} /><PriorityFlag priority={row.priority} /></span></td>
        <td className="px-3 py-2.5 text-right tabular-nums">{row.value ? formatAmount(row.value) : "—"}</td>
      </tr>)}</tbody>
    </table></Panel>
  </PageBody>;
}
