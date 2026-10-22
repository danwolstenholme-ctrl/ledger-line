import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getMyWork, type CrmTask } from "@/lib/data/crm";
import { getDemoUser } from "@/lib/org";
import { formatAmount, formatDate, greeting } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel, PanelHeader } from "@/components/common/primitives";
import { AddTodo, TaskCheck } from "@/components/crm/forms";
import { LinkChip, PriorityFlag, StageBadge, dueTone } from "@/components/crm/badges";
import { RecordHeader, recordButton } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "My work" };

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** My work, for this company: the to-dos, the enquiries and the matters, each with its next step. */
export default async function MyWorkPage() {
  const [{ org, today, tasks, enquiries, matters }, user] = await Promise.all([getMyWork(), getDemoUser()]);
  const week = addDays(today, 7);
  const overdue = tasks.filter(task => task.due_on && task.due_on < today), dueToday = tasks.filter(task => task.due_on === today);
  const soon = tasks.filter(task => task.due_on && task.due_on > today && task.due_on <= week), later = tasks.filter(task => !task.due_on || task.due_on > week);
  return <PageBody className="space-y-4">
    <RecordHeader title={`${greeting()}, ${user.name.split(" ")[0]}`}
      description={`${new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} · ${org.name} · ${tasks.length} to-dos, ${overdue.length} overdue`}
      action={<Link href={`/c/${org.slug}/crm/enquiries/new`} className={recordButton}>New enquiry</Link>} />
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <Panel className="overflow-hidden">
        <PanelHeader title="My to-dos" hint="Everything assigned, whatever it is about" action={<Link href={`/c/${org.slug}/crm/tasks`} className="text-brand text-[12.5px]">All tasks</Link>} />
        <div className="p-4"><AddTodo /></div>
        {[["Overdue", overdue, "critical"], ["Today", dueToday], ["Next 7 days", soon], ["Later", later]].map(([title, list, tone]) =>
          <TaskGroupLinks key={String(title)} title={String(title)} tasks={list as CrmTask[]} today={today} tone={tone as "critical" | undefined} slug={org.slug} />)}
        {!tasks.length ? <p className="text-ink-muted px-4 pb-4 text-[12.5px]">Nothing to do. Add a to-do above.</p> : null}
      </Panel>
      <div className="space-y-4">
        <Panel className="overflow-hidden">
          <PanelHeader title="My enquiries" count={enquiries.length} action={<Link href={`/c/${org.slug}/crm/enquiries`} className="text-brand text-[12.5px]">Board</Link>} />
          <ul className="divide-hairline divide-y">{enquiries.map(enquiry => <li key={enquiry.id}>
            <Link href={`/c/${org.slug}/crm/enquiries/${enquiry.id}`} className="hover:bg-surface-sunken block px-4 py-2.5">
              <span className="flex items-baseline justify-between gap-2"><span className="text-ink truncate text-[13px] font-medium">{enquiry.full_name}{enquiry.company ? <span className="text-ink-faint font-normal"> · {enquiry.company}</span> : null}</span><StageBadge stage={enquiry.stage} compact /></span>
              <span className={cn("block truncate text-[12px]", enquiry.next_action ? dueTone(enquiry.next_action_due, today) : "text-caution")}>{enquiry.next_action ? `${enquiry.next_action}${enquiry.next_action_due ? ` · ${formatDate(enquiry.next_action_due)}` : ""}` : "No next action"}</span>
            </Link>
          </li>)}</ul>
        </Panel>
        <Panel className="overflow-hidden">
          <PanelHeader title="My matters" count={matters.length} action={<Link href={`/c/${org.slug}/crm/matters`} className="text-brand text-[12.5px]">All</Link>} />
          <ul className="divide-hairline divide-y">{matters.map(matter => <li key={matter.id}>
            <Link href={`/c/${org.slug}/crm/matters/${matter.id}`} className="hover:bg-surface-sunken block px-4 py-2.5">
              <span className="text-ink block truncate text-[13px] font-medium">{matter.customer_name ?? "—"}<span className="text-ink-faint font-normal"> · {matter.title}</span></span>
              <span className={cn("block truncate text-[12px]", dueTone(matter.next_action_due, today))}>{matter.next_action ?? "No next action"}{matter.next_action_due ? ` · ${formatDate(matter.next_action_due)}` : ""}{matter.value ? <span className="text-ink-faint"> · {formatAmount(matter.value)}</span> : null}</span>
            </Link>
          </li>)}</ul>
        </Panel>
      </div>
    </div>
  </PageBody>;
}

function TaskGroupLinks(props: { title: string; tasks: CrmTask[]; today: string; tone?: "critical"; slug: string }) {
  return <TaskGroupInner {...props} />;
}
function TaskGroupInner({ title, tasks, today, tone, slug }: { title: string; tasks: CrmTask[]; today: string; tone?: "critical"; slug: string }) {
  if (!tasks.length) return null;
  const href = (task: CrmTask) => task.enquiry_id ? `/c/${slug}/crm/enquiries/${task.enquiry_id}` : task.matter_id ? `/c/${slug}/crm/matters/${task.matter_id}` : task.customer_id ? `/c/${slug}/customers/${task.customer_id}` : null;
  return <div>
    <p className={cn("border-hairline bg-surface-sunken border-y px-4 py-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase", tone === "critical" ? "text-critical" : "text-ink-muted")}>{title} <span className="text-ink-faint ml-1">{tasks.length}</span></p>
    <ul className="divide-hairline divide-y">{tasks.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
      <TaskCheck id={task.id} done={false} />
      <span className="text-ink min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
      <PriorityFlag priority={task.priority} />
      {href(task) ? <Link href={href(task)!} className="hidden md:inline-flex"><LinkChip kind={task.link_kind} label={task.link_label} /></Link> : null}
      <span className={cn("w-16 shrink-0 text-right text-[12.5px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? short(task.due_on) : "—"}</span>
    </li>)}</ul>
  </div>;
}
