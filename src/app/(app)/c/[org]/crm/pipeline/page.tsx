import type { Metadata } from "next";
import { Globe } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getPipeline, type CrmDeal } from "@/lib/data/crm";
import { closingStage, fieldsFor, openStages, showFieldValue, uses } from "@/lib/domain/business-types";
import { QUIET_DAYS } from "@/lib/domain/crm";
import { formatAgo, formatAmount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { CreateRecordLink, RecordFilterLinks, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";
import { KanbanBoard, type BoardCard } from "@/components/crm/board";
import { PriorityFlag, StageBadge, dueTone } from "@/components/crm/badges";

export const metadata: Metadata = { title: "Pipeline" };

const DAY = 86_400_000;
const daysSince = (instant: string) => Math.floor((Date.now() - Date.parse(instant)) / DAY);
/** A day this year without its year; another year's with it. */
const short = (date: string, today: string) => date.slice(0, 4) === today.slice(0, 4) ? formatDate(date).replace(/ \d{4}$/, "") : formatDate(date);

/** The company's pipeline, in its own stages and words: a board to drag deals along, or the same as a list. */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ org, workspace, rows, today }, query] = await Promise.all([getPipeline(), searchParams]);
  const view = query.view === "list" ? "list" : "board";
  const [one, many] = workspace.labels.deal;
  const base = `/c/${org.slug}/crm/pipeline`;
  const open = rows.filter(row => row.outcome === "open");
  const pipeline = open.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
  const likely = open.reduce((sum, row) => sum + Number(row.value ?? 0) * (row.probability ?? 0) / 100, 0);
  const month = today.slice(0, 7);
  const wonThisMonth = rows.filter(row => row.outcome === "won" && row.stage_changed_at.slice(0, 7) === month).length;
  const fields = fieldsFor(workspace, "deal").filter(field => field.on_card);
  const won = closingStage(workspace, "deal", "won"), lost = closingStage(workspace, "deal", "lost");
  const stages = openStages(workspace, "deal");

  // Nobody waits: one left untouched comes to the top of its column.
  const waitingOf = (card: BoardCard) => { const row = open.find(item => item.id === card.id); return row?.untouched ? daysSince(row.created_at) : 0; };
  const card = (row: CrmDeal): BoardCard => {
    const waiting = row.untouched ? daysSince(row.created_at) : 0;
    const quiet = !row.untouched && row.last_activity ? daysSince(row.last_activity) : 0;
    return {
      id: row.id, stageId: row.stage_id, href: `${base}/${row.id}`, title: row.company || row.full_name, subtitle: row.company ? row.full_name : null, detail: row.service,
      value: row.value === null ? null : Number(row.value), priority: row.priority,
      badges: fields.map(field => showFieldValue(field, row.extra[field.key], amount => formatMoney(amount), formatDate)).filter((value): value is string => Boolean(value)),
      alert: waiting >= 1 ? { text: `Waiting ${waiting} day${waiting === 1 ? "" : "s"} for a reply`, tone: "critical" }
        : row.untouched && row.channel !== "manual" ? { text: `From your website · ${formatAgo(row.created_at)}`, tone: "new" }
        : quiet >= QUIET_DAYS ? { text: `Quiet for ${quiet} days`, tone: "caution" } : null,
      note: row.next_action ? { text: `${row.next_action_due ? `${short(row.next_action_due, today)} · ` : ""}${row.next_action}`, tone: row.next_action_due && row.next_action_due < today ? "critical" : row.next_action_due === today ? "due" : "muted" } : { text: "No next action", tone: "muted" },
    };
  };

  return <PageBody className="space-y-4">
    <RecordHeader title={many} description={`${open.length} open · ${formatMoney(pipeline)} in the pipeline, ${formatMoney(Math.round(likely))} likely · ${wonThisMonth} won this month`}
      action={<><Link href={`${base}/form`} className={recordOutlineButton}><Globe className="size-3.5" />Website form</Link><CreateRecordLink href={`${base}/new`}>New {one.toLowerCase()}</CreateRecordLink></>} />
    <RecordFilterLinks label="View" options={[{ label: "Board", href: base, active: view === "board" }, { label: "List", href: `${base}?view=list`, active: view === "list" }]} />
    {view === "board" ? <KanbanBoard board="deal" columns={stages} closing={[won, lost].filter(stage => stage !== null)}
      cards={open.map(card).sort((a, b) => waitingOf(b) - waitingOf(a))}
      hint={!won || !lost ? undefined : uses(workspace, "quotes") || uses(workspace, "jobs")
        ? `Drag a card onto ${won.name} to set it up as a ${workspace.labels.customer[0].toLowerCase()}${uses(workspace, "jobs") ? ` with its first ${workspace.labels.job[0].toLowerCase()}` : ""}, or onto ${lost.name}. Closed ones are kept in the list.`
        : `Drag a card onto ${won.name} or ${lost.name} to close it. Closed ones are kept in the list.`} />
      : <Panel className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead className="border-hairline bg-surface-sunken border-b"><tr className="text-ink-faint text-left text-[11px] font-semibold tracking-[0.06em] uppercase">
            <th className="px-3 py-2">{one}</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Next action</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Source</th>
            {fields.map(field => <th key={field.key} className="px-3 py-2">{field.label}</th>)}
            <th className="px-3 py-2">Expected</th><th className="px-3 py-2 text-right">Value</th>
          </tr></thead>
          <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
            <td className="px-3 py-2"><Link href={`${base}/${row.id}`} className="text-ink hover:text-brand font-medium">{row.company || row.full_name}</Link><span className="text-ink-faint block text-[11.5px]">{row.company ? `${row.full_name} · ` : ""}{row.service ?? row.reference}</span></td>
            <td className="px-3 py-2"><span className="flex items-center gap-1.5"><StageBadge name={row.stage_name} outcome={row.outcome} position={row.stage_position} openCount={stages.length} /><PriorityFlag priority={row.priority} /></span>{row.outcome === "lost" && row.lost_reason ? <span className="text-ink-faint block text-[11.5px]">{row.lost_reason}</span> : null}</td>
            <td className={cn("px-3 py-2", dueTone(row.next_action_due, today))}>{row.next_action ?? "—"}{row.next_action_due ? <span className="block text-[11.5px]">{formatDate(row.next_action_due)}</span> : null}</td>
            <td className="text-ink-muted px-3 py-2">{row.owner}</td><td className="text-ink-muted px-3 py-2">{row.source}</td>
            {fields.map(field => <td key={field.key} className="text-ink-muted px-3 py-2">{showFieldValue(field, row.extra[field.key], amount => formatAmount(amount), formatDate) ?? "—"}</td>)}
            <td className="text-ink-muted px-3 py-2 whitespace-nowrap">{row.expected_on ? formatDate(row.expected_on) : "—"}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.value ? formatAmount(row.value) : "—"}</td>
          </tr>)}</tbody>
        </table>
      </Panel>}
  </PageBody>;
}
