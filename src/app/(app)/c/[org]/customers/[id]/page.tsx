import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getClient } from "@/lib/data/crm";
import { getReminder } from "@/lib/data/sales";
import { countryName } from "@/lib/domain/countries";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordDisclosure, RecordHeader, RecordSection, recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { AddTodo, CustomerExtraForm, NoteForm, TaskCheck } from "@/components/crm/forms";
import { StageBadge, dueTone } from "@/components/crm/badges";
import { ContactLinks } from "@/components/crm/contact-links";
import { fieldValue } from "@/components/crm/field-value";
import { fieldsFor, uses } from "@/lib/domain/business-types";
import { CustomerForm } from "@/components/sales/sale-actions";
import { CreditNoteStatusBadge, InvoiceStatusBadge, QuoteStatusBadge } from "@/components/sales/sales-parts";
import { ReminderPanel } from "@/components/sales/reminder";
import { answerView, latestChecks, vatKey } from "@/lib/vies";
import { VatCheckButton } from "@/components/vat/vat-check";

export const metadata: Metadata = { title: "Customer" };

/** One customer: what they owe and what to do next, their invoices and quotes, and the CRM's people, work and notes. */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getClient(id);
  if (!data) notFound();
  const { org, workspace, client, contacts, jobs, tasks, invoices, quotes, creditNotes, unusedCredit, activities, owed, overdue, billedThisYear, today } = data;
  const fields = fieldsFor(workspace, "customer");
  const [jobOne, jobMany] = workspace.labels.job;
  const [reminder, checks] = await Promise.all([overdue > 0 ? getReminder(client.id) : null, latestChecks([client.vat_number ?? ""])]);
  const vat = vatKey(client.vat_number, client.country);
  const statement = `/c/${org.slug}/customers/${client.id}/statement`;
  const where = [client.vat_number ? `VAT ${client.vat_number}` : null, countryName(client.country), client.eu_business ? "EU business: invoices are reverse charge" : null].filter(Boolean).join(" · ");
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title={client.name} description={where} back={{ href: "/accounts/customers", label: workspace.labels.customer[1] }}
      action={<><a href={statement} target="_blank" rel="noopener" className={recordOutlineButton}><FileText className="size-3.5" />Statement</a><Link href={`/accounts/quotes/new?customer=${client.id}`} className={recordOutlineButton}>New quote</Link><Link href={`/invoices/new?customer=${client.id}`} className={recordButton}><Plus className="size-4" />New invoice</Link></>} />

    <section className="ll-panel flex flex-wrap gap-x-10 gap-y-3 px-4 py-3">
      <div><p className="ll-eyebrow">Owes you</p><p className={cn("text-[20px] leading-tight font-semibold tabular-nums", overdue ? "text-critical" : "text-ink")}>{formatAmount(owed)}</p><p className="text-ink-muted text-[11.5px]">{overdue ? `${formatAmount(overdue)} overdue` : "Nothing overdue"}</p></div>
      <div><p className="ll-eyebrow">Billed this year</p><p className="text-ink text-[20px] leading-tight font-semibold tabular-nums">{formatAmount(billedThisYear)}</p></div>
      {unusedCredit > 0 ? <div><p className="ll-eyebrow">Credit to use</p><p className="text-ink text-[20px] leading-tight font-semibold tabular-nums">{formatAmount(unusedCredit)}</p><p className="text-ink-muted text-[11.5px]">Against an invoice, or to refund</p></div> : null}
      {reminder ? <div className="ml-auto self-center"><ReminderPanel data={{ customerId: client.id, customerName: client.name, to: reminder.to, greeting: reminder.greeting, company: org.name, sender: reminder.sender,
        overdue: reminder.overdue.map(item => ({ ...item, balance: Number(item.balance) })), bank: reminder.bank, statementHref: statement, lastSent: reminder.lastSent }} /></div> : null}
    </section>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <RecordSection title="Invoices" action={invoices.length ? <Link href={`/invoices?view=all&customer=${client.id}`} className="text-brand text-[12px] font-medium">All invoices</Link> : undefined}>
          {invoices.length ? <table className="w-full border-collapse text-[12.5px]"><tbody className="divide-hairline divide-y">{invoices.map(invoice => <tr key={invoice.id} className="hover:bg-surface-sunken">
            <td className="px-4 py-2"><Link href={`/invoices/${invoice.id}`} className="text-brand font-mono hover:underline">{invoice.number}</Link></td>
            <td className="text-ink-muted px-2 py-2 whitespace-nowrap">{formatDate(invoice.issued_on)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatAmount(invoice.total)}</td>
            <td className="px-4 py-2 text-right"><InvoiceStatusBadge status={invoice.status as never} daysOverdue={invoice.days_overdue} credited={Number(invoice.amount_credited ?? 0)} total={Number(invoice.total)} /></td>
          </tr>)}</tbody></table> : <p className="text-ink-muted px-4 py-3 text-[12.5px]">No invoices yet. <Link href={`/invoices/new?customer=${client.id}`} className="text-brand font-medium">Raise the first</Link>.</p>}
        </RecordSection>
        {quotes.length ? <RecordSection title="Open quotes">
          <table className="w-full border-collapse text-[12.5px]"><tbody className="divide-hairline divide-y">{quotes.map(quote => <tr key={quote.id} className="hover:bg-surface-sunken">
            <td className="px-4 py-2"><Link href={`/accounts/quotes/${quote.id}`} className="text-brand font-mono hover:underline">{quote.number}</Link></td>
            <td className="text-ink-muted px-2 py-2 whitespace-nowrap">{formatDate(quote.issued_on)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatAmount(quote.total)}</td>
            <td className="px-4 py-2 text-right"><QuoteStatusBadge status={quote.status} expired={quote.expired} /></td>
          </tr>)}</tbody></table>
        </RecordSection> : null}
        {creditNotes.length ? <RecordSection title="Credit notes" action={<Link href="/accounts/credit-notes" className="text-brand text-[12px] font-medium">All credit notes</Link>}>
          <table className="w-full border-collapse text-[12.5px]"><tbody className="divide-hairline divide-y">{creditNotes.map(note => <tr key={note.id} className="hover:bg-surface-sunken">
            <td className="px-4 py-2"><Link href={`/accounts/credit-notes/${note.id}`} className="text-brand font-mono hover:underline">{note.number}</Link>{note.invoice_number ? <span className="text-ink-faint ml-2 font-mono text-[11.5px]">{note.invoice_number}</span> : null}</td>
            <td className="text-ink-muted px-2 py-2 whitespace-nowrap">{formatDate(note.issued_on)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatAmount(note.total)}</td>
            <td className="px-4 py-2 text-right"><CreditNoteStatusBadge status={note.status} remaining={Number(note.remaining)} /></td>
          </tr>)}</tbody></table>
        </RecordSection> : null}
        {uses(workspace, "jobs") ? <RecordSection title={jobMany} hint="The work for them" action={<Link href={`/c/${org.slug}/crm/jobs/new?customer=${client.id}`} className="text-brand text-[12.5px] hover:underline">New {jobOne.toLowerCase()}</Link>}>
          {jobs.length ? <ul className="divide-hairline divide-y">{jobs.map(matter => <li key={matter.id}>
            <Link href={`/c/${data.org.slug}/crm/jobs/${matter.id}`} className="hover:bg-surface-sunken flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1"><span className="text-ink block truncate text-[13px] font-medium">{matter.title}</span><span className={cn("block truncate text-[12px]", dueTone(matter.next_action_due, today))}>{matter.next_action ?? "No next action"}{matter.next_action_due ? ` · ${formatDate(matter.next_action_due)}` : ""}</span></span>
              <StageBadge name={matter.stage_name} outcome={matter.outcome} position={matter.stage_position} openCount={workspace.stages.job.filter(stage => stage.outcome === "open").length} />
            </Link>
          </li>)}</ul> : <p className="text-ink-muted px-4 py-3 text-[12.5px]">None yet.</p>}
        </RecordSection> : null}
        <RecordSection title="Notes and activity">
          <NoteForm link={{ customer_id: client.id }} />
          {activities.length ? <ol className="divide-hairline border-hairline divide-y border-t">{activities.map(activity => <li key={activity.id} className="px-4 py-2.5">
            <span className="text-ink block text-[12.5px]">{activity.body}</span><span className="text-ink-faint text-[11.5px]">{activity.actor} · {formatDateTime(activity.occurred_at)}</span>
          </li>)}</ol> : null}
        </RecordSection>
      </div>
      <div className="min-w-0 space-y-4">
        {client.vat_number ? <RecordSection title="VAT number" hint={client.eu_business ? "Sales to it are zero-rated under the reverse charge" : undefined}>
          <div className="p-4"><VatCheckButton vat={client.vat_number} country={client.country} organisationId={org.id} expectName={client.name} kept={answerView(vat ? checks.get(vat) : null, client.name)} /></div>
        </RecordSection> : null}
        <RecordSection title="Contact">
          <div className="px-4 pt-3"><ContactLinks name={client.name} email={client.email} phone={client.phone} country={org.country} message={`Hello, this is ${org.name}. `} /></div>
          <dl className="space-y-1.5 px-4 py-3 text-[12.5px]">
            {client.email ? <div><dt className="sr-only">Email</dt><dd><a href={`mailto:${client.email}`} className="text-brand hover:underline">{client.email}</a></dd></div> : null}
            {client.phone ? <div><dt className="sr-only">Phone</dt><dd className="text-ink">{client.phone}</dd></div> : null}
            {client.address ? <div><dt className="sr-only">Address</dt><dd className="text-ink-muted whitespace-pre-line">{client.address}</dd></div> : null}
            {!client.email && !client.phone && !client.address ? <dd className="text-ink-faint">No contact details yet.</dd> : null}
          </dl>
          <p className="border-hairline text-ink-muted border-t px-4 py-2 text-[12px]">Pays within {client.payment_terms_days ?? org.payment_terms_days} days{client.payment_terms_days === null ? " (the company's terms)" : ""}</p>
          <RecordDisclosure title="Edit details"><CustomerForm customer={client} companyTerms={org.payment_terms_days} /></RecordDisclosure>
        </RecordSection>
        {fields.length ? <RecordSection title="Details" hint={`What ${org.name.replace(/ (Ltd|Limited|LLP)$/, "")} keeps on each`}>
          <dl className="divide-hairline divide-y px-4">{fields.map(field => <div key={field.key} className="grid gap-0.5 py-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-ink-muted text-[12px]">{field.label}</dt><dd className="text-ink text-[12.5px]">{fieldValue(field, client.extra[field.key]) ?? <span className="text-ink-faint">Not recorded</span>}</dd>
          </div>)}</dl>
          <RecordDisclosure title="Change them"><CustomerExtraForm customerId={client.id} fields={fields} values={client.extra} /></RecordDisclosure>
        </RecordSection> : null}
        <RecordSection title="People">
          {contacts.length ? <ul className="divide-hairline divide-y">{contacts.map(contact => <li key={contact.id} className="px-4 py-2.5">
            <span className="text-ink block text-[13px] font-medium">{contact.name}{contact.role ? <span className="text-ink-faint font-normal"> · {contact.role}</span> : null}</span>
            <span className="text-ink-muted block text-[12px]">{contact.email}{contact.phone ? ` · ${contact.phone}` : ""}</span>
            <ContactLinks name={contact.name} email={contact.email} phone={contact.phone} company={client.name} role={contact.role} country={org.country} message={`Hello ${contact.name.split(" ")[0]}, `} className="mt-1.5" />
          </li>)}</ul> : <p className="text-ink-muted px-4 py-3 text-[12.5px]">No one recorded.</p>}
        </RecordSection>
        <RecordSection title="To-dos">
          <div className="p-3"><AddTodo link={{ customer_id: client.id }} placeholder={`Add a to-do for this ${workspace.labels.customer[0].toLowerCase()}…`} /></div>
          {tasks.length ? <ul className="divide-hairline border-hairline divide-y border-t">{tasks.map(task => <li key={task.id} className="flex items-center gap-3 px-4 py-2">
            <TaskCheck id={task.id} done={Boolean(task.done_at)} />
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", task.done_at ? "text-ink-faint line-through" : "text-ink")}>{task.title}</span>
            <span className={cn("text-[12px] tabular-nums", dueTone(task.due_on, today))}>{task.due_on ? formatDate(task.due_on) : ""}</span>
          </li>)}</ul> : null}
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
