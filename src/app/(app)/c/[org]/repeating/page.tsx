import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getRepeatingInvoices } from "@/lib/data/sales";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordBadge, RecordEmpty, RecordHeader } from "@/components/records/record-layout";
import { RaiseDueButton } from "@/components/sales/repeating-forms";

export const metadata: Metadata = { title: "Repeating invoices" };

const EVERY: Record<number, string> = { 1: "Monthly", 2: "Every two months", 3: "Quarterly", 6: "Every six months", 12: "Yearly" };

/** Invoices raised on a schedule: leases, retainers, management fees. Due ones are raised from here in one press. */
export default async function RepeatingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ rows }, query] = await Promise.all([getRepeatingInvoices(), searchParams]);
  const due = rows.filter(row => row.due);
  const head = "text-ink-faint px-3 py-2 text-left text-[11px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  return <PageBody className="space-y-4">
    <RecordHeader title="Repeating invoices" back={{ href: "/invoices", label: "Invoices" }}
      description="The same invoice every month, quarter or year. Start one from any invoice with Repeat." />
    {query.raised ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]">
      <CheckCircle2 className="size-4 shrink-0" /><span>{query.raised.split(",").length} invoice{query.raised.split(",").length === 1 ? "" : "s"} raised: {query.raised.split(",").join(", ")}.{query.problem ? ` ${query.problem}` : ""}</span>
    </p> : null}
    {due.length ? <section className="ll-panel border-caution-line bg-caution-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-ink text-[12.5px]"><span className="font-medium">{due.length} due:</span> {due.map(row => row.name).join(", ")}. Each is raised on its own date with the next number.</p>
      <RaiseDueButton count={due.length} />
    </section> : null}
    <Panel className="overflow-hidden">
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Name</th><th scope="col" className={head}>Customer</th><th scope="col" className={head}>How often</th><th scope="col" className={head}>Next</th>
          <th scope="col" className={cn(head, "text-right")}>Each</th><th scope="col" className={head}>Status</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className={cn("hover:bg-surface-sunken", !row.is_active && "opacity-60")}>
          <td className="px-3 py-2.5 text-[12.5px]"><Link href={`/accounts/repeating/${row.id}`} className="text-ink hover:text-brand font-medium">{row.name}</Link></td>
          <td className="text-ink-muted px-3 py-2.5 text-[12.5px]">{row.client_name}</td>
          <td className="text-ink-muted px-3 py-2.5 text-[12.5px]">{EVERY[row.every_months]}{row.issue ? "" : ", as drafts"}</td>
          <td className={cn("px-3 py-2.5 text-[12.5px] whitespace-nowrap", row.due ? "text-caution font-medium" : "text-ink-muted")}>{row.is_active ? formatDate(row.next_on) : "—"}</td>
          <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums">{formatAmount(row.total)}</td>
          <td className="px-3 py-2.5">{!row.is_active ? <RecordBadge>{row.ends_on && row.next_on > row.ends_on ? "Ended" : "Paused"}</RecordBadge> : row.due ? <RecordBadge tone="caution">Due</RecordBadge> : <RecordBadge tone="positive">Scheduled</RecordBadge>}</td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title="No repeating invoices">Open an invoice and press <span className="text-ink font-medium">Repeat</span> to raise it every month, quarter or year.</RecordEmpty>}
    </Panel>
  </PageBody>;
}
