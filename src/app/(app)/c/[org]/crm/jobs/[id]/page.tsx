import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getCrmPeople, getCustomerChoices, getJob } from "@/lib/data/crm";
import { getWorkspace } from "@/lib/data/workspace";
import { businessType, fieldsFor, uses } from "@/lib/domain/business-types";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { requireOrg } from "@/lib/org";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordDetail, RecordDisclosure, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { AddTodo, JobForm, NextActionForm, NoteForm, StageBar, TaskCheck } from "@/components/crm/forms";
import { PriorityFlag, dueTone } from "@/components/crm/badges";
import { fieldValue } from "@/components/crm/field-value";

export async function generateMetadata(): Promise<Metadata> {
  const org = await requireOrg();
  return { title: (await getWorkspace(org.id)).labels.job[0] };
}

/** One job, whatever the company calls it: where it stands, its next step and to-dos, what was said, and its details. */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, people, customers] = await Promise.all([getJob(id), getCrmPeople(), getCustomerChoices()]);
  if (!data) notFound();
  const { org, workspace, job, tasks, activities, enquiry, today } = data;
  const [one, many] = workspace.labels.job;
  const fields = fieldsFor(workspace, "job");
  const note = businessType(workspace.typeKey).note;
  return <PageBody className="space-y-4">
    <RecordHeader title={job.title} back={{ href: `/c/${org.slug}/crm/jobs`, label: many }}
      description={`${one} #${job.reference}${job.customer_name ? ` · ${job.customer_name}` : ""}${job.outcome === "open" && job.due_on ? ` · due ${formatDate(job.due_on)}` : job.closed_on ? ` · ${job.stage_name.toLowerCase()} ${formatDate(job.closed_on)}` : ""}`}
      action={<div className="flex flex-wrap items-center gap-2"><PriorityFlag priority={job.priority} />
        {job.customer_id ? <Link href={`/c/${org.slug}/sales/new?customer=${job.customer_id}`} className={recordOutlineButton}><FilePlus2 className="size-3.5" />Raise an invoice</Link> : null}
        {job.customer_id && uses(workspace, "quotes") && job.outcome === "open" ? <Link href={`/c/${org.slug}/quotes/new?customer=${job.customer_id}`} className={recordOutlineButton}>Write a quote</Link> : null}
      </div>} />
    <StageBar board="job" id={job.id} stages={workspace.stages.job} current={job.stage_id} />
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {job.outcome === "open" ? <RecordSection title="Next action" hint={job.next_action_due ? `Due ${formatDate(job.next_action_due)}` : undefined}>
          <NextActionForm link={{ job_id: job.id }} action={job.next_action} due={job.next_action_due} />
        </RecordSection> : null}
        <RecordSection title="To-dos" hint={`${tasks.filter(task => !task.done_at).length} open`}>
          <div className="p-3"><AddTodo link={{ job_id: job.id }} placeholder={`Add a to-do for this ${one.toLowerCase()}…`} /></div>
          <ul className="divide-hairline border-hairline divide-y border-t">{tasks.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2">
            <TaskCheck id={task.id} done={Boolean(task.done_at)} />
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", task.done_at ? "text-ink-faint line-through" : "text-ink")}>{task.title}</span>
            <span className="text-ink-muted hidden text-[12px] sm:inline">{task.owner}</span>
            <span className={cn("w-20 text-right text-[12px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? formatDate(task.due_on) : ""}</span>
          </li>)}</ul>
        </RecordSection>
        <RecordSection title="Activity">
          <NoteForm link={{ job_id: job.id, ...(job.customer_id ? { customer_id: job.customer_id } : {}) }} />
          <ol className="divide-hairline border-hairline divide-y border-t">{activities.map(activity => <li key={activity.id} className="px-4 py-2.5"><span className="text-ink block text-[12.5px] whitespace-pre-line">{activity.body}</span><span className="text-ink-faint text-[11.5px]">{activity.actor} · {formatDateTime(activity.occurred_at)}</span></li>)}</ol>
        </RecordSection>
      </div>
      <RecordSection title="Details">
        <dl className="divide-hairline divide-y px-4">
          <RecordDetail label={workspace.labels.customer[0]} value={job.customer_id ? <Link href={`/c/${org.slug}/customers/${job.customer_id}`} className="text-brand hover:underline">{job.customer_name}</Link> : null} />
          {fields.map(field => <RecordDetail key={field.key} label={field.label} value={fieldValue(field, job.extra[field.key])} />)}
          <RecordDetail label="Value" value={job.value ? formatAmount(job.value) : null} />
          <RecordDetail label="Starts" value={job.starts_on ? formatDate(job.starts_on) : null} />
          <RecordDetail label="Due" value={job.due_on ? formatDate(job.due_on) : null} />
          <RecordDetail label="Owner" value={job.owner} />
          <RecordDetail label="Opened" value={<>{formatDate(job.opened_on)}{enquiry ? <> from <Link href={`/c/${org.slug}/crm/pipeline/${enquiry.id}`} className="text-brand hover:underline">{workspace.labels.deal[0].toLowerCase()} {enquiry.reference}</Link></> : null}</>} />
          <RecordDetail label="Summary" value={job.summary} />
        </dl>
        {note ? <p className="text-ink-muted border-hairline border-t px-4 py-2.5 text-[12px] leading-relaxed">{note}</p> : null}
        <RecordDisclosure title="Change the details">
          <JobForm job={job} fields={fields} customers={customers} people={people} labels={{ job: one, customer: workspace.labels.customer[0] }} />
        </RecordDisclosure>
      </RecordSection>
    </div>
  </PageBody>;
}
