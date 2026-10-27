"use client";

import { useState, useTransition } from "react";
import { Copy, FileDown, Mail, Send } from "lucide-react";

import { markInvoiceSent } from "@/lib/actions/sales";
import type { DocumentLanguage } from "@/lib/documents/document-words";
import { invoiceEmail } from "@/lib/documents/messages";
import { Field, TextArea, TextInput } from "@/components/common/form-fields";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";
import { useCurrency } from "@/components/common/regime";
import { useI18n } from "@/components/common/locale";

export type SendInvoiceData = {
  invoiceId: string; number: string; total: number; balance: number; dueOn: string | null; customerName: string; to: string; greeting: string | null;
  company: string; sender: string; bank: { name: string; bank_details: string | null } | null; pdfHref: string; sentAt: string | null; sentTo: string | null;
  /** The invoice's link for the customer, once shared: the message carries it, and there is nothing to attach. */
  link?: string | null;
  /** The customer's language for what they are sent, whatever the screen's (lib/documents/messages). */
  language: DocumentLanguage;
};

const draft = (data: SendInvoiceData, currency: string) => invoiceEmail(data.language, { number: data.number, company: data.company, sender: data.sender, greeting: data.greeting ?? data.customerName,
  balance: data.balance, currency, dueOn: data.dueOn, bank: data.bank, link: data.link });

/** Send the invoice from the person's own email: the message written, the PDF to attach, and a record that it went. */
export function SendInvoicePanel({ data, startOpen = false, primary = false }: { data: SendInvoiceData; startOpen?: boolean; primary?: boolean }) {
  const { t, formatAgo } = useI18n();
  const currency = useCurrency();
  const start = draft(data, currency);
  const [open, setOpen] = useState(startOpen);
  const [to, setTo] = useState(data.sentTo ?? data.to), [subject, setSubject] = useState(start.subject), [body, setBody] = useState(start.body);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [, startTransition] = useTransition();
  const record = () => { setSent(true); startTransition(() => markInvoiceSent(data.invoiceId, to)); };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={primary ? recordButton : recordOutlineButton}><Send className="size-3.5" />{data.sentAt ? t("Send again") : t("Send")}</button>;
  return <section aria-label={t("Send the invoice")} className="ll-panel basis-full space-y-3 px-4 py-3.5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-ink text-[13.5px] font-semibold">{t("Send {number}", { number: data.number })}</h3>
      {data.sentAt ? <p className="text-ink-faint text-[12px]">{data.sentTo ? t("Last sent {ago} to {to}", { ago: formatAgo(data.sentAt), to: data.sentTo }) : t("Last sent {ago}", { ago: formatAgo(data.sentAt) })}</p> : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("To")} htmlFor="send-to"><TextInput id="send-to" type="email" value={to} onChange={event => setTo(event.target.value)} placeholder="accounts@customer.example" /></Field>
      <Field label={t("Subject")} htmlFor="send-subject"><TextInput id="send-subject" value={subject} onChange={event => setSubject(event.target.value)} /></Field>
    </div>
    <Field label={t("Message")} htmlFor="send-body"><TextArea id="send-body" rows={10} value={body} onChange={event => setBody(event.target.value)} className="font-mono text-[12.5px]" /></Field>
    <div className="flex flex-wrap items-center gap-2">
      <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} onClick={record} className={recordButton}><Mail className="size-3.5" />{t("Open in email")}</a>
      <a href={`${data.pdfHref}?download=1`} className={recordOutlineButton}><FileDown className="size-3.5" />{t("Download the PDF")}</a>
      <button type="button" className={recordOutlineButton} onClick={() => { void navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(() => setCopied(true)); record(); }}><Copy className="size-3.5" />{copied ? t("Copied") : t("Copy the message")}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-ink-muted hover:text-ink px-2 text-[13px]">{t("Close")}</button>
    </div>
    <p className="text-ink-faint text-[12px]">{sent ? t("Marked as sent, and logged on the customer's timeline.") : data.link ? t("Opens your email app with this message: the link is in it, so there is nothing to attach.") : t("Opens your email app with this message: attach the PDF before you send it.")}</p>
  </section>;
}
