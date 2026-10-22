import type { Metadata } from "next";
import { Clock, Globe } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getEnquiries } from "@/lib/data/crm";
import { CRM_STAGES } from "@/lib/domain/crm";
import { formatAgo, formatAmount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { CreateRecordLink, RecordFilterLinks, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";
import { PriorityFlag, StageBadge, dueTone } from "@/components/crm/badges";

export const metadata: Metadata = { title: "Enquiries" };

const DAY = 86_400_000;
/** Whole days an untouched new enquiry has waited; 0 once anyone has acted on it, or within its first day. */
const waitingDays = (row: { untouched?: boolean; created_at: string }) => row.untouched ? Math.floor((Date.now() - Date.parse(row.created_at)) / DAY) : 0;

/** The pipeline as a board: a column per stage, each card its next action. Or the same as a table. */
export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { org, rows, today } = await getEnquiries();
  const view = (await searchParams).view === "list" ? "list" : "board";
  const open = rows.filter(row => !["won", "lost"].includes(row.stage));
  const pipeline = open.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
  const base = `/c/${org.slug}/crm/enquiries`;
  const won = rows.filter(row => row.stage === "won").length, lost = rows.filter(row => row.stage === "lost").length;
  return <PageBody className="space-y-4">
    <RecordHeader title="Enquiries" description={`${open.length} open · ${formatMoney(pipeline)} in the pipeline · ${won} won`}
      action={<><Link href={`${base}/website`} className={recordOutlineButton}><Globe className="size-3.5" />Website form</Link><CreateRecordLink href={`${base}/new`}>New enquiry</CreateRecordLink></>} />
    <RecordFilterLinks label="View" options={[{ label: "Board", href: base, active: view === "board" }, { label: "List", href: `${base}?view=list`, active: view === "list" }]} />
    {/* The board is the open pipeline; won and lost enquiries are closed, and the list keeps them. */}
    {view === "board" ? <><div className="flex gap-3 overflow-x-auto pb-2">
      {CRM_STAGES.filter(stage => stage.open).map(stage => {
        // Nobody waits: an enquiry left untouched for a day comes back to the top of its column.
        const cards = rows.filter(row => row.stage === stage.key).sort((a, b) => waitingDays(b) - waitingDays(a));
        const value = cards.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
        return <section key={stage.key} aria-label={stage.label} className="ll-panel flex min-w-[210px] flex-1 basis-0 flex-col overflow-hidden">
          <header className="border-hairline bg-surface-sunken border-b px-3 py-2">
            <div className="flex items-center justify-between gap-2"><StageBadge stage={stage.key} /><span className="text-ink-faint text-[11.5px] tabular-nums">{cards.length}</span></div>
            <p className="text-ink-faint mt-1 text-[11px] tabular-nums">{value ? formatMoney(value) : "—"}</p>
          </header>
          <ul className="space-y-2 p-2">{cards.map(card => <li key={card.id}>
            <Link href={`${base}/${card.id}`} className="border-hairline bg-surface hover:border-brand-400 block rounded-md border px-2.5 py-2 shadow-xs transition-colors">
              <span className="flex items-start justify-between gap-2"><span className="text-ink text-[12.5px] leading-snug font-medium">{card.full_name}</span><PriorityFlag priority={card.priority} /></span>
              {card.company ? <span className="text-ink-muted block truncate text-[11.5px]">{card.company}</span> : null}
              <span className="text-ink-faint mt-1 block truncate text-[11.5px]">{card.service}</span>
              {waitingDays(card) ? <span className="text-critical mt-1 flex items-center gap-1 text-[11.5px] font-medium"><Clock className="size-3" />Waiting {waitingDays(card)} day{waitingDays(card) === 1 ? "" : "s"} for a reply</span>
                : card.channel !== "manual" && card.stage === "new" ? <span className="text-brand mt-1 flex items-center gap-1 text-[11.5px]"><Globe className="size-3" />From your website · {formatAgo(card.created_at)}</span> : null}
              <span className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px]">
                <span className={cn("min-w-0 truncate", card.next_action ? dueTone(card.next_action_due, today) : "text-ink-faint")}>{stage.open ? card.next_action ? `${card.next_action_due ? formatDate(card.next_action_due).replace(/ \d{4}$/, "") : ""} · ${card.next_action}` : "No next action" : card.stage === "lost" ? card.lost_reason : "Customer"}</span>
                {card.value ? <span className="text-ink shrink-0 tabular-nums">{formatMoney(card.value, "EUR", { compact: true })}</span> : null}
              </span>
            </Link>
          </li>)}</ul>
          {!cards.length ? <p className="text-ink-faint px-3 pb-3 text-[11.5px]">Nothing here.</p> : null}
        </section>;
      })}
    </div>
    {won || lost ? <p className="text-ink-muted text-[12px]">{[won ? `${won} won` : null, lost ? `${lost} lost` : null].filter(Boolean).join(" and ")}: closed, and kept in <Link href={`${base}?view=list`} className="text-brand hover:underline">the list</Link>.</p> : null}</> : <Panel className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
        <thead className="border-hairline bg-surface-sunken border-b"><tr className="text-ink-faint text-left text-[11px] font-semibold tracking-[0.06em] uppercase">
          <th className="px-3 py-2">Enquiry</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Next action</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Source</th><th className="px-3 py-2 text-right">Value</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
          <td className="px-3 py-2"><Link href={`${base}/${row.id}`} className="text-ink font-medium hover:text-brand">{row.full_name}</Link><span className="text-ink-faint block text-[11.5px]">{row.company ?? row.reference} · {row.service}</span></td>
          <td className="px-3 py-2"><StageBadge stage={row.stage} /></td>
          <td className={cn("px-3 py-2", dueTone(row.next_action_due, today))}>{row.next_action ?? "—"}{row.next_action_due ? <span className="block text-[11.5px]">{formatDate(row.next_action_due)}</span> : null}</td>
          <td className="text-ink-muted px-3 py-2">{row.owner}</td><td className="text-ink-muted px-3 py-2">{row.source}</td>
          <td className="px-3 py-2 text-right tabular-nums">{row.value ? formatAmount(row.value) : "—"}</td>
        </tr>)}</tbody>
      </table>
    </Panel>}
  </PageBody>;
}
