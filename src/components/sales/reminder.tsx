"use client";

import { useState, useTransition } from "react";
import { Copy, FileDown, Mail } from "lucide-react";

import { logReminder } from "@/lib/actions/sales";
import { formatAmount, formatDate, formatAgo } from "@/lib/format";
import { Field, TextArea, TextInput } from "@/components/common/form-fields";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";

export type ReminderData = {
  customerId: string; customerName: string; to: string; greeting: string | null; company: string; sender: string;
  overdue: { number: string; issued_on: string; due_on: string; balance: number; days_overdue: number }[];
  bank: { name: string; bank_details: string | null } | null; statementHref: string; lastSent: string | null;
};

function draft(data: ReminderData) {
  const total = data.overdue.reduce((sum, invoice) => sum + Number(invoice.balance), 0);
  const list = data.overdue.map(invoice => `• ${invoice.number}, dated ${formatDate(invoice.issued_on)}: ${formatAmount(invoice.balance)}, due ${formatDate(invoice.due_on)} (${invoice.days_overdue} days ago)`).join("\n");
  const bank = data.bank ? `\n\nYou can pay by bank transfer to ${data.bank.name}:\n${data.bank.bank_details ?? ""}\nPlease quote the invoice numbers as the reference.` : "";
  return {
    subject: `${data.overdue.length === 1 ? `Invoice ${data.overdue[0].number}` : `${data.overdue.length} invoices`} overdue · ${data.company}`,
    body: `Dear ${data.greeting ?? data.customerName},\n\nOur records show ${data.overdue.length === 1 ? "this invoice is" : "these invoices are"} now overdue:\n\n${list}\n\nTotal overdue: ${formatAmount(total)}. Your statement is attached.${bank}\n\nIf you have already paid, thank you, and please ignore this reminder.\n\nKind regards,\n${data.sender}\n${data.company}`,
  };
}

/**
 * A payment reminder for a customer with overdue invoices: written out with
 * the invoices, the total and how to pay, opened in the person's own email
 * app to send, and logged on the customer's timeline.
 */
export function ReminderPanel({ data }: { data: ReminderData }) {
  const start = draft(data);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(data.to), [subject, setSubject] = useState(start.subject), [body, setBody] = useState(start.body);
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);
  const [, startTransition] = useTransition();
  if (!data.overdue.length) return null;
  const summary = `${data.overdue.map(invoice => invoice.number).join(", ")} (${formatAmount(data.overdue.reduce((sum, invoice) => sum + Number(invoice.balance), 0))} overdue)`;
  const record = () => { setLogged(true); startTransition(() => logReminder(data.customerId, summary)); };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={recordOutlineButton}><Mail className="size-3.5" />Send a reminder</button>;
  return <section aria-label="Payment reminder" className="ll-panel basis-full space-y-3 px-4 py-3.5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-ink text-[13px] font-semibold">Payment reminder</h3>
      {data.lastSent ? <p className="text-ink-faint text-[11.5px]">Last reminder sent {formatAgo(data.lastSent)}</p> : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="To" htmlFor="reminder-to"><TextInput id="reminder-to" type="email" value={to} onChange={event => setTo(event.target.value)} placeholder="accounts@customer.example" /></Field>
      <Field label="Subject" htmlFor="reminder-subject"><TextInput id="reminder-subject" value={subject} onChange={event => setSubject(event.target.value)} /></Field>
    </div>
    <Field label="Message" htmlFor="reminder-body"><TextArea id="reminder-body" rows={12} value={body} onChange={event => setBody(event.target.value)} className="font-mono text-[12px]" /></Field>
    <div className="flex flex-wrap items-center gap-2">
      <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} onClick={record} className={recordButton}><Mail className="size-3.5" />Open in email</a>
      <a href={`${data.statementHref}?download=1`} className={recordOutlineButton}><FileDown className="size-3.5" />Download the statement</a>
      <button type="button" className={recordOutlineButton} onClick={() => { void navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(() => setCopied(true)); record(); }}><Copy className="size-3.5" />{copied ? "Copied" : "Copy the message"}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-ink-muted hover:text-ink px-2 text-[12.5px]">Close</button>
    </div>
    <p className="text-ink-faint text-[11.5px]">{logged ? "Logged on the customer's timeline." : "Opens your email app with this message: attach the statement before you send it. The reminder is logged on the customer's timeline."}</p>
  </section>;
}
