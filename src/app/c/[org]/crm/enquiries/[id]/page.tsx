import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/navigation/navigation-link";
import { CheckCircle2, Mail, MessageSquare, Phone, Users } from "lucide-react";

import { convertEnquiry } from "@/lib/actions/crm";
import { getEnquiry } from "@/lib/data/crm";
import { CRM_STAGES, stageOf, stageSwatch } from "@/lib/domain/crm";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordDetail, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { AddTodo, NextActionForm, NoteForm, StageForm, TaskCheck } from "@/components/crm/forms";
import { PriorityFlag, StageBadge, dueTone } from "@/components/crm/badges";

export const metadata: Metadata = { title: "Enquiry" };
const ICONS = { note: MessageSquare, call: Phone, email: Mail, meeting: Users, stage: CheckCircle2, won: CheckCircle2 } as Record<string, typeof Phone>;

/** One enquiry: where it stands, what happens next, everything said, and the step that makes it a customer. */
export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getEnquiry(id);
  if (!data) notFound();
  const { org, enquiry, activities, tasks, customer, today } = data;
  const index = CRM_STAGES.findIndex(stage => stage.key === enquiry.stage);
  return <PageBody className="space-y-4">
    <RecordHeader title={enquiry.full_name} description={`${enquiry.company ? `${enquiry.company} · ` : ""}${enquiry.reference} · ${enquiry.service ?? ""}`} back={{ href: `/c/${org.slug}/crm/enquiries`, label: "Enquiries" }}
      action={<div className="flex items-center gap-2"><PriorityFlag priority={enquiry.priority} /><StageBadge stage={enquiry.stage} />
        {enquiry.stage !== "won" && enquiry.stage !== "lost" ? <form action={convertEnquiry}><input type="hidden" name="id" value={enquiry.id} /><button className="bg-brand hover:bg-brand-dark inline-flex h-8 items-center rounded-md px-3 text-[12.5px] font-medium text-white">Won: make a customer</button></form>
          : customer ? <Link href={`/c/${org.slug}/customers/${customer.id}`} className="text-brand text-[12.5px] font-medium hover:underline">Open the customer →</Link> : null}
      </div>} />
    <ol aria-label="Pipeline" className="ll-panel grid grid-cols-7 overflow-hidden">{CRM_STAGES.map((stage, position) => <li key={stage.key} className={cn("border-hairline border-r px-2 py-2 text-center text-[11px] last:border-r-0", position === index ? "text-ink font-semibold" : position < index && enquiry.stage !== "lost" ? "text-ink-muted" : "text-ink-faint")}>
      <span className="mx-auto mb-1 block h-1 w-full rounded-full" style={{ backgroundColor: position <= index && (enquiry.stage !== "lost" || stage.key === "lost") ? stageSwatch(enquiry.stage === "lost" ? "lost" : stage.key) : "var(--hairline)" }} />{stage.short}
    </li>)}</ol>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <RecordSection title="Next action" hint={enquiry.next_action_due ? `Due ${formatDate(enquiry.next_action_due)}` : undefined}>
          <NextActionForm link={{ enquiry_id: enquiry.id }} action={enquiry.next_action} due={enquiry.next_action_due} />
        </RecordSection>
        <RecordSection title="Activity" hint="Calls, emails, notes and stage changes">
          <NoteForm link={{ enquiry_id: enquiry.id }} />
          <ol className="divide-hairline border-hairline divide-y border-t">{activities.map(activity => {
            const Icon = ICONS[activity.kind] ?? MessageSquare;
            return <li key={activity.id} className="flex gap-3 px-4 py-2.5">
              <Icon className={cn("mt-0.5 size-4 shrink-0", activity.kind === "won" ? "text-positive" : "text-ink-faint")} />
              <span className="min-w-0"><span className="text-ink block text-[12.5px] leading-relaxed">{activity.body}</span><span className="text-ink-faint text-[11.5px]">{activity.actor} · {formatDateTime(activity.occurred_at)}</span></span>
            </li>;
          })}</ol>
        </RecordSection>
      </div>
      <div className="space-y-4">
        <RecordSection title="Stage" hint={stageOf(enquiry.stage).meaning}><div className="p-4"><StageForm id={enquiry.id} stage={enquiry.stage} /></div></RecordSection>
        <RecordSection title="Details">
          <dl className="divide-hairline divide-y px-4">
            <RecordDetail label="Contact" value={<>{enquiry.full_name}{enquiry.email ? <span className="text-ink-muted block">{enquiry.email}</span> : null}{enquiry.phone ? <span className="text-ink-muted block">{enquiry.phone}</span> : null}</>} />
            <RecordDetail label="Company" value={enquiry.company} />
            <RecordDetail label="Wants" value={enquiry.service} />
            <RecordDetail label="Value" value={enquiry.value ? formatAmount(enquiry.value) : null} />
            <RecordDetail label="Source" value={enquiry.source} />
            <RecordDetail label="Owner" value={enquiry.owner} />
            <RecordDetail label="Received" value={formatDate(enquiry.created_at)} />
            {enquiry.lost_reason ? <RecordDetail label="Lost because" value={enquiry.lost_reason} /> : null}
          </dl>
        </RecordSection>
        <RecordSection title="To-dos" hint={`${tasks.filter(task => !task.done_at).length} open`}>
          <div className="p-3"><AddTodo link={{ enquiry_id: enquiry.id }} placeholder="Add a to-do for this enquiry…" /></div>
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
