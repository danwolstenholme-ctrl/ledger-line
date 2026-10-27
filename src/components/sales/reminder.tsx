"use client";

import { useState, useTransition } from "react";
import { Copy, FileDown, Mail } from "lucide-react";

import { logReminder } from "@/lib/actions/sales";
import { formatAmount } from "@/lib/format";
import type { DocumentLanguage } from "@/lib/documents/document-words";
import { reminderEmail } from "@/lib/documents/messages";
import { Field, TextArea, TextInput } from "@/components/common/form-fields";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { useCurrency } from "@/components/common/regime";
import { useI18n } from "@/components/common/locale";

export type ReminderData = {
  customerId: string; customerName: string; to: string; greeting: string | null; company: string; sender: string;
  overdue: { number: string; issued_on: string; due_on: string; balance: number; days_overdue: number }[];
  bank: { name: string; bank_details: string | null } | null; statementHref: string; lastSent: string | null;
  /** The customer's language for what they are sent (lib/documents/messages). */
  language: DocumentLanguage;
};

const draft = (data: ReminderData, currency: string) => reminderEmail(data.language, { company: data.company, sender: data.sender, greeting: data.greeting ?? data.customerName, currency, bank: data.bank, overdue: data.overdue });

/**
 * A payment reminder for a customer with overdue invoices: written out with
 * the invoices, the total and how to pay, opened in the person's own email
 * app to send, and logged on the customer's timeline.
 */
export function ReminderPanel({ data }: { data: ReminderData }) {
  const { t, formatAgo } = useI18n();
  const currency = useCurrency();
  const start = draft(data, currency);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(data.to), [subject, setSubject] = useState(start.subject), [body, setBody] = useState(start.body);
  const [copied, setCopied] = useState(false);
  const [logged, setLogged] = useState(false);
  const [, startTransition] = useTransition();
  if (!data.overdue.length) return null;
  const summary = `${data.overdue.map(invoice => invoice.number).join(", ")} (${formatAmount(data.overdue.reduce((sum, invoice) => sum + Number(invoice.balance), 0), currency)} overdue)`;
  const record = () => { setLogged(true); startTransition(() => logReminder(data.customerId, summary)); };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={recordOutlineButton}><Mail className="size-3.5" />{t("Send a reminder")}</button>;
  return <section aria-label={t("Payment reminder")} className="ll-panel basis-full space-y-3 px-4 py-3.5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-ink text-[13.5px] font-semibold">{t("Payment reminder")}</h3>
      {data.lastSent ? <p className="text-ink-faint text-[12px]">{t("Last reminder sent {ago}", { ago: formatAgo(data.lastSent) })}</p> : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("To")} htmlFor="reminder-to"><TextInput id="reminder-to" type="email" value={to} onChange={event => setTo(event.target.value)} placeholder="accounts@customer.example" /></Field>
      <Field label={t("Subject")} htmlFor="reminder-subject"><TextInput id="reminder-subject" value={subject} onChange={event => setSubject(event.target.value)} /></Field>
    </div>
    <Field label={t("Message")} htmlFor="reminder-body"><TextArea id="reminder-body" rows={12} value={body} onChange={event => setBody(event.target.value)} className="font-mono text-[12.5px]" /></Field>
    <div className="flex flex-wrap items-center gap-2">
      <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} onClick={record} className={recordButton}><Mail className="size-3.5" />{t("Open in email")}</a>
      <a href={`${data.statementHref}?download=1`} className={recordOutlineButton}><FileDown className="size-3.5" />{t("Download the statement")}</a>
      <button type="button" className={recordOutlineButton} onClick={() => { void navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(() => setCopied(true)); record(); }}><Copy className="size-3.5" />{copied ? t("Copied") : t("Copy the message")}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-ink-muted hover:text-ink px-2 text-[13px]">{t("Close")}</button>
    </div>
    <p className="text-ink-faint text-[12px]">{logged ? t("Logged on the customer's timeline.") : t("Opens your email app with this message: attach the statement before you send it. The reminder is logged on the customer's timeline.")}</p>
  </section>;
}
