"use client";

import { useState, useTransition } from "react";
import { Copy, FileDown, Mail, Send } from "lucide-react";

import { markInvoiceSent } from "@/lib/actions/sales";
import { formatAmount, formatDate, formatAgo } from "@/lib/format";
import { Field, TextArea, TextInput } from "@/components/common/form-fields";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";

export type SendInvoiceData = {
  invoiceId: string; number: string; total: number; balance: number; dueOn: string | null; customerName: string; to: string; greeting: string | null;
  company: string; sender: string; bank: { name: string; bank_details: string | null } | null; pdfHref: string; sentAt: string | null; sentTo: string | null;
};

function draft(data: SendInvoiceData) {
  const bank = data.bank ? `\n\nYou can pay by bank transfer to ${data.bank.name}:\n${data.bank.bank_details ?? ""}\nPlease quote ${data.number} as the reference.` : "";
  return {
    subject: `Invoice ${data.number} from ${data.company}`,
    body: `Dear ${data.greeting ?? data.customerName},\n\nPlease find attached invoice ${data.number} for ${formatAmount(data.balance)}${data.dueOn ? `, due by ${formatDate(data.dueOn)}` : ""}.${bank}\n\nThank you for your business.\n\nKind regards,\n${data.sender}\n${data.company}`,
  };
}

/** Send the invoice from the person's own email: the message written, the PDF to attach, and a record that it went. */
export function SendInvoicePanel({ data, startOpen = false, primary = false }: { data: SendInvoiceData; startOpen?: boolean; primary?: boolean }) {
  const start = draft(data);
  const [open, setOpen] = useState(startOpen);
  const [to, setTo] = useState(data.sentTo ?? data.to), [subject, setSubject] = useState(start.subject), [body, setBody] = useState(start.body);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [, startTransition] = useTransition();
  const record = () => { setSent(true); startTransition(() => markInvoiceSent(data.invoiceId, to)); };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={primary ? recordButton : recordOutlineButton}><Send className="size-3.5" />{data.sentAt ? "Send again" : "Send"}</button>;
  return <section aria-label="Send the invoice" className="ll-panel basis-full space-y-3 px-4 py-3.5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-ink text-[13px] font-semibold">Send {data.number}</h3>
      {data.sentAt ? <p className="text-ink-faint text-[11.5px]">Last sent {formatAgo(data.sentAt)}{data.sentTo ? ` to ${data.sentTo}` : ""}</p> : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="To" htmlFor="send-to"><TextInput id="send-to" type="email" value={to} onChange={event => setTo(event.target.value)} placeholder="accounts@customer.example" /></Field>
      <Field label="Subject" htmlFor="send-subject"><TextInput id="send-subject" value={subject} onChange={event => setSubject(event.target.value)} /></Field>
    </div>
    <Field label="Message" htmlFor="send-body"><TextArea id="send-body" rows={10} value={body} onChange={event => setBody(event.target.value)} className="font-mono text-[12px]" /></Field>
    <div className="flex flex-wrap items-center gap-2">
      <a href={`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} onClick={record} className={recordButton}><Mail className="size-3.5" />Open in email</a>
      <a href={`${data.pdfHref}?download=1`} className={recordOutlineButton}><FileDown className="size-3.5" />Download the PDF</a>
      <button type="button" className={recordOutlineButton} onClick={() => { void navigator.clipboard?.writeText(`${subject}\n\n${body}`).then(() => setCopied(true)); record(); }}><Copy className="size-3.5" />{copied ? "Copied" : "Copy the message"}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-ink-muted hover:text-ink px-2 text-[12.5px]">Close</button>
    </div>
    <p className="text-ink-faint text-[11.5px]">{sent ? "Marked as sent, and logged on the customer's timeline." : "Opens your email app with this message: attach the PDF before you send it."}</p>
  </section>;
}
