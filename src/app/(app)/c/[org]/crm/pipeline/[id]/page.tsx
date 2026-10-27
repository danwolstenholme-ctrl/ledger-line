import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { CheckCircle2, Mail, MessageSquare, Phone, Users } from "lucide-react";

import { takeOnFromEnquiry } from "@/lib/actions/clients";
import { winDeal } from "@/lib/actions/crm";
import { one } from "@/lib/db";
import { getCrmPeople, getDeal } from "@/lib/data/crm";
import { businessType, fieldsFor, uses } from "@/lib/domain/business-types";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordDetail, RecordDisclosure, RecordHeader, RecordSection, recordButton } from "@/components/records/record-layout";
import { AddTodo, DealForm, NextActionForm, NoteForm, StageBar, TaskCheck } from "@/components/crm/forms";
import { PriorityFlag, dueTone } from "@/components/crm/badges";
import { ContactLinks } from "@/components/crm/contact-links";
import { fieldValue } from "@/components/crm/field-value";

export const metadata: Metadata = { title: "Pipeline" };
const ICONS = { note: MessageSquare, call: Phone, email: Mail, meeting: Users, stage: CheckCircle2, won: CheckCircle2 } as Record<string, typeof Phone>;

/** One deal: where it stands on the company's board, what happens next, everything said, and the step that makes it a customer. */
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const [data, people] = await Promise.all([getDeal(id), getCrmPeople()]);
  if (!data) notFound();
  const { org, workspace, deal, activities, tasks, customer, jobs, today } = data;
  const fields = fieldsFor(workspace, "deal");
  const [one_, many] = workspace.labels.deal;
  // In the firm's own pipeline, winning an enquiry means taking the company on: it gets a client file, and its books once due diligence is done.
  const clientFile = org.is_practice ? await one<{ id: string }>("select id from client_files where enquiry_id = $1", [deal.id]) : null;
  const takeOn = org.is_practice && deal.outcome !== "lost";
  const customerLabel = workspace.labels.customer[0].toLowerCase(), jobLabel = workspace.labels.job[0].toLowerCase();
  return <PageBody className="space-y-4">
    <RecordHeader title={deal.company || deal.full_name} back={{ href: `/c/${org.slug}/crm/pipeline`, label: many }}
      description={`${one_} ${deal.reference}${deal.company ? ` · ${deal.full_name}` : ""}${deal.service ? ` · ${deal.service}` : ""}`}
      action={<div className="flex flex-wrap items-center gap-2"><PriorityFlag priority={deal.priority} />
        {clientFile ? <Link href={`/clients/${clientFile.id}`} className="text-brand text-[12.5px] font-medium hover:underline">Open the client file →</Link>
          : takeOn ? <form action={takeOnFromEnquiry}><input type="hidden" name="enquiry_id" value={deal.id} /><button className={recordButton}>{deal.outcome === "won" ? "Take on as a client" : "Won: take on as a client"}</button></form>
          : deal.outcome === "open" ? <form action={winDeal}><input type="hidden" name="id" value={deal.id} /><button className={recordButton}
            title={uses(workspace, "quotes") || uses(workspace, "jobs") ? `Sets them up as a ${customerLabel}${uses(workspace, "jobs") ? `, with their first ${jobLabel}` : ""}` : undefined}>Mark as {(workspace.stages.deal.find(stage => stage.outcome === "won")?.name ?? "won").toLowerCase()}</button></form>
          : null}
        {jobs.map(job => <Link key={job.id} href={`/c/${org.slug}/crm/jobs/${job.id}`} className="text-brand text-[12.5px] font-medium hover:underline">Open the {jobLabel} →</Link>)}
        {customer && !jobs.length ? <Link href={`/c/${org.slug}/customers/${customer.id}`} className="text-brand text-[12.5px] font-medium hover:underline">Open the {customerLabel} →</Link> : null}
      </div>} />
    <StageBar board="deal" id={deal.id} stages={workspace.stages.deal} current={deal.stage_id} />
    {deal.outcome === "lost" && deal.lost_reason ? <p className="text-ink-muted text-[12.5px]"><span className="text-critical font-medium">{deal.stage_name}:</span> {deal.lost_reason}</p> : null}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {deal.outcome === "open" ? <RecordSection title="Next action" hint={deal.next_action_due ? `Due ${formatDate(deal.next_action_due)}` : undefined}>
          <NextActionForm link={{ enquiry_id: deal.id }} action={deal.next_action} due={deal.next_action_due} />
        </RecordSection> : null}
        <RecordSection title="Activity" hint="Calls, emails, notes and stage changes">
          <NoteForm link={{ enquiry_id: deal.id }} />
          <ol className="divide-hairline border-hairline divide-y border-t">{activities.map(activity => {
            const Icon = ICONS[activity.kind] ?? MessageSquare;
            return <li key={activity.id} className="flex gap-3 px-4 py-2.5">
              <Icon className={cn("mt-0.5 size-4 shrink-0", activity.kind === "won" ? "text-positive" : "text-ink-faint")} />
              <span className="min-w-0"><span className="text-ink block text-[12.5px] leading-relaxed whitespace-pre-line">{activity.body}</span><span className="text-ink-faint text-[11.5px]">{activity.actor} · {formatDateTime(activity.occurred_at)}</span></span>
            </li>;
          })}</ol>
        </RecordSection>
      </div>
      <div className="space-y-4">
        <RecordSection title="Details">
          <div className="px-4 pt-3"><ContactLinks name={deal.full_name} email={deal.email} phone={deal.phone} company={deal.company} country={org.country} message={`Hello ${deal.full_name.split(" ")[0]}, `} /></div>
          <dl className="divide-hairline divide-y px-4">
            <RecordDetail label="Contact" value={<>{deal.full_name}{deal.email ? <span className="text-ink-muted block">{deal.email}</span> : null}{deal.phone ? <span className="text-ink-muted block">{deal.phone}</span> : null}</>} />
            {deal.company ? <RecordDetail label="Company" value={deal.company} /> : null}
            <RecordDetail label="Wants" value={deal.service} />
            <RecordDetail label="Value" value={deal.value ? <>{formatAmount(deal.value)}{deal.outcome === "open" && deal.probability !== null ? <span className="text-ink-muted"> · {deal.probability}% likely at this stage</span> : null}</> : null} />
            <RecordDetail label="Expected" value={deal.expected_on ? formatDate(deal.expected_on) : null} />
            {fields.map(field => <RecordDetail key={field.key} label={field.label} value={fieldValue(field, deal.extra[field.key])} />)}
            <RecordDetail label="Source" value={deal.source} />
            <RecordDetail label="Owner" value={deal.owner} />
            <RecordDetail label="Received" value={formatDate(deal.created_at)} />
          </dl>
          <RecordDisclosure title="Change the details">
            <DealForm deal={deal} fields={fields} sources={businessType(workspace.typeKey).sources} people={people} label={one_.toLowerCase()} />
          </RecordDisclosure>
        </RecordSection>
        <RecordSection title="To-dos" hint={`${tasks.filter(task => !task.done_at).length} open`}>
          <div className="p-3"><AddTodo link={{ enquiry_id: deal.id }} placeholder={`Add a to-do for this ${one_.toLowerCase()}…`} /></div>
          <ul className="divide-hairline border-hairline divide-y border-t">{tasks.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2">
            <TaskCheck id={task.id} done={Boolean(task.done_at)} />
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", task.done_at ? "text-ink-faint line-through" : "text-ink")}>{task.title}</span>
            <span className={cn("text-[12px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? formatDate(task.due_on) : ""}</span>
          </li>)}</ul>
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
