import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getJobs, type CrmJob } from "@/lib/data/crm";
import { closingStage, fieldsFor, openStages, showFieldValue } from "@/lib/domain/business-types";
import { formatAmount, formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { CreateRecordLink, RecordEmpty, RecordFilterLinks, RecordHeader } from "@/components/records/record-layout";
import { KanbanBoard, type BoardCard } from "@/components/crm/board";
import { PriorityFlag, StageBadge, dueTone } from "@/components/crm/badges";

export const metadata: Metadata = { title: "Work" };

/** A day this year without its year; another year's with it. */
const short = (date: string, today: string) => date.slice(0, 4) === today.slice(0, 4) ? formatDate(date).replace(/ \d{4}$/, "") : formatDate(date);

/** The work the company does for its customers, whatever it calls it: a board of its stages, or a list. */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const view = query.view === "open" || query.view === "closed" || query.view === "all" ? query.view : "board";
  const { org, workspace, rows, today } = await getJobs(view);
  const [one, many] = workspace.labels.job;
  const base = `/c/${org.slug}/crm/jobs`;
  const fields = fieldsFor(workspace, "job").filter(field => field.on_card);
  const open = rows.filter(row => row.outcome === "open");
  const done = closingStage(workspace, "job", "won"), cancelled = closingStage(workspace, "job", "lost");
  const columns = [...openStages(workspace, "job"), ...(done ? [done] : [])];
  const openCount = openStages(workspace, "job").length;

  const card = (row: CrmJob): BoardCard => ({
    id: row.id, stageId: row.stage_id, href: `${base}/${row.id}`, title: row.title, subtitle: row.customer_name, value: row.value === null ? null : Number(row.value), priority: row.priority,
    detail: `#${row.reference}${row.due_on ? ` · ${row.outcome === "open" ? "due" : "was due"} ${short(row.due_on, today)}` : ""}${row.open_tasks ? ` · ${row.open_tasks} to-do${row.open_tasks === 1 ? "" : "s"}` : ""}`,
    badges: fields.map(field => showFieldValue(field, row.extra[field.key], amount => formatMoney(amount), formatDate)).filter((value): value is string => Boolean(value)),
    alert: row.outcome === "open" && row.due_on && row.due_on < today ? { text: `Past its due date, ${formatDate(row.due_on)}`, tone: "critical" } : null,
    note: row.outcome !== "open" ? { text: row.closed_on ? `${row.stage_name} ${short(row.closed_on, today)}` : row.stage_name, tone: "muted" }
      : row.next_action ? { text: `${row.next_action_due ? `${short(row.next_action_due, today)} · ` : ""}${row.next_action}`, tone: row.next_action_due && row.next_action_due < today ? "critical" : row.next_action_due === today ? "due" : "muted" } : null,
  });

  return <PageBody className="space-y-4">
    <RecordHeader title={many} description={`${open.length} open · ${formatMoney(open.reduce((sum, row) => sum + Number(row.value ?? 0), 0))} in hand`}
      action={<CreateRecordLink href={`${base}/new`}>New {one.toLowerCase()}</CreateRecordLink>} />
    <RecordFilterLinks label="View" options={[{ label: "Board", href: base, active: view === "board" }, { label: "Open", href: `${base}?view=open`, active: view === "open" },
      { label: "Closed", href: `${base}?view=closed`, active: view === "closed" }, { label: "All", href: `${base}?view=all`, active: view === "all" }]} />
    {view === "board" ? <KanbanBoard board="job" columns={columns} closing={cancelled ? [cancelled] : []} cards={rows.map(card)}
      hint={done ? `${done.name} keeps the last 30 days. Drag a card onto ${cancelled?.name ?? "the last column"} to close it without finishing.` : undefined} />
      : rows.length ? <Panel className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead className="border-hairline bg-surface-sunken border-b"><tr className="text-ink-faint text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            <th className="px-3 py-2">{one}</th><th className="px-3 py-2">{workspace.labels.customer[0]}</th><th className="px-3 py-2">Stage</th>
            {fields.map(field => <th key={field.key} className="px-3 py-2">{field.label}</th>)}
            <th className="px-3 py-2">Next action</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2 text-right">Value</th>
          </tr></thead>
          <tbody className="divide-hairline divide-y">{rows.map(row => <tr key={row.id} className="hover:bg-surface-sunken">
            <td className="px-3 py-2.5"><Link href={`${base}/${row.id}`} className="text-ink hover:text-brand font-medium">{row.title}</Link><span className="text-ink-faint block font-mono text-[11.5px]">#{row.reference}</span></td>
            <td className="text-ink-muted px-3 py-2.5">{row.customer_name ?? "—"}</td>
            <td className="px-3 py-2.5"><span className="flex items-center gap-1.5"><StageBadge name={row.stage_name} outcome={row.outcome} position={row.stage_position} openCount={openCount} /><PriorityFlag priority={row.priority} /></span></td>
            {fields.map(field => <td key={field.key} className="text-ink-muted px-3 py-2.5">{showFieldValue(field, row.extra[field.key], amount => formatAmount(amount), formatDate) ?? "—"}</td>)}
            <td className={cn("px-3 py-2.5", dueTone(row.next_action_due, today))}>{row.next_action ?? "—"}</td>
            <td className={cn("px-3 py-2.5 whitespace-nowrap", row.outcome === "open" ? dueTone(row.due_on, today) : "text-ink-muted")}>{row.due_on ? formatDate(row.due_on) : "—"}</td>
            <td className="text-ink-muted px-3 py-2.5">{row.owner}</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{row.value ? formatAmount(row.value) : "—"}</td>
          </tr>)}</tbody>
        </table>
      </Panel> : <Panel><RecordEmpty title={`No ${many.toLowerCase()} here`}>Add one, or win one from the pipeline: it opens with its first to-do.</RecordEmpty></Panel>}
  </PageBody>;
}
