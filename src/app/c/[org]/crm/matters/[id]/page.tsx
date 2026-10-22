import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";

import { getMatter } from "@/lib/data/crm";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordDetail, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { AddTodo, NextActionForm, NoteForm, TaskCheck } from "@/components/crm/forms";
import { MatterStatus, dueTone } from "@/components/crm/badges";

export const metadata: Metadata = { title: "Matter" };

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getMatter(id);
  if (!data) notFound();
  const { org, matter, tasks, activities, today } = data;
  return <PageBody className="space-y-4">
    <RecordHeader title={matter.title} description={`${matter.reference}${matter.customer_name ? ` · ${matter.customer_name}` : ""}`} back={{ href: `/c/${org.slug}/crm/matters`, label: "Matters" }} action={<MatterStatus status={matter.status} />} />
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <RecordSection title="Next action"><NextActionForm link={{ matter_id: matter.id }} action={matter.next_action} due={matter.next_action_due} /></RecordSection>
        <RecordSection title="To-dos">
          <div className="p-3"><AddTodo link={{ matter_id: matter.id }} placeholder="Add a to-do for this matter…" /></div>
          <ul className="divide-hairline border-hairline divide-y border-t">{tasks.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2">
            <TaskCheck id={task.id} done={Boolean(task.done_at)} />
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", task.done_at ? "text-ink-faint line-through" : "text-ink")}>{task.title}</span>
            <span className="text-ink-muted text-[12px]">{task.owner}</span>
            <span className={cn("w-20 text-right text-[12px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? formatDate(task.due_on) : ""}</span>
          </li>)}</ul>
        </RecordSection>
        <RecordSection title="Activity">
          <NoteForm link={{ matter_id: matter.id }} />
          <ol className="divide-hairline border-hairline divide-y border-t">{activities.map(activity => <li key={activity.id} className="px-4 py-2.5"><span className="text-ink block text-[12.5px]">{activity.body}</span><span className="text-ink-faint text-[11.5px]">{activity.actor} · {formatDateTime(activity.occurred_at)}</span></li>)}</ol>
        </RecordSection>
      </div>
      <RecordSection title="Details">
        <dl className="divide-hairline divide-y px-4">
          <RecordDetail label="Customer" value={matter.customer_id ? <Link href={`/c/${org.slug}/customers/${matter.customer_id}`} className="text-brand hover:underline">{matter.customer_name}</Link> : null} />
          <RecordDetail label="Owner" value={matter.owner} />
          <RecordDetail label="Value" value={matter.value ? formatAmount(matter.value) : null} />
          <RecordDetail label="Opened" value={formatDate(matter.opened_on)} />
          <RecordDetail label="Summary" value={matter.summary} />
        </dl>
      </RecordSection>
    </div>
  </PageBody>;
}
