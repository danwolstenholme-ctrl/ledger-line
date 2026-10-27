import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getTasks } from "@/lib/data/crm";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordFilterLinks, RecordHeader } from "@/components/records/record-layout";
import { AddTodo, TaskCheck } from "@/components/crm/forms";
import { LinkChip, PriorityFlag, dueTone } from "@/components/crm/badges";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const requested = (await searchParams).view;
  const view = requested === "done" || requested === "all" ? requested : "open";
  const { org, rows, today } = await getTasks(view);
  const base = `/c/${org.slug}/crm/tasks`;
  const href = (task: (typeof rows)[number]) => task.enquiry_id ? `/c/${org.slug}/crm/enquiries/${task.enquiry_id}` : task.matter_id ? `/c/${org.slug}/crm/matters/${task.matter_id}` : task.customer_id ? `/c/${org.slug}/customers/${task.customer_id}` : null;
  return <PageBody className="space-y-4">
    <RecordHeader title="Tasks" description="Everything to do in this company, whatever it is about." />
    <RecordFilterLinks label="Tasks" options={[{ label: "Open", href: base, active: view === "open" }, { label: "Done", href: `${base}?view=done`, active: view === "done" }, { label: "All", href: `${base}?view=all`, active: view === "all" }]} />
    <Panel className="overflow-hidden">
      <div className="p-4"><AddTodo /></div>
      <ul className="divide-hairline border-hairline divide-y border-t">{rows.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
        <TaskCheck id={task.id} done={Boolean(task.done_at)} />
        <span className={cn("min-w-0 flex-1 truncate text-[13px]", task.done_at ? "text-ink-faint line-through" : "text-ink")}>{task.title}</span>
        <PriorityFlag priority={task.priority} />
        {href(task) ? <Link href={href(task)!} className="hidden md:inline-flex"><LinkChip kind={task.link_kind} label={task.link_label} /></Link> : null}
        <span className="text-ink-muted hidden w-36 truncate text-[12px] lg:inline">{task.owner}</span>
        <span className={cn("w-24 shrink-0 text-right text-[12.5px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? formatDate(task.due_on) : "—"}</span>
      </li>)}</ul>
      {!rows.length ? <p className="text-ink-muted px-4 py-3 text-[12.5px]">Nothing here.</p> : null}
    </Panel>
  </PageBody>;
}
