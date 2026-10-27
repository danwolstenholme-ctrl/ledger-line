"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye, Link2, Mail, MessageCircle, MessageSquareText, Phone } from "lucide-react";

import { markLinkSent, shareDocument, stopSharing } from "@/lib/actions/document-links";
import type { DocumentLink, LinkKind } from "@/lib/data/document-links";
import { formatAgo, formatDate } from "@/lib/format";
import { internationalNumber } from "@/components/crm/contact-links";
import { InlineSubmit } from "@/components/common/form-fields";
import { recordButton, recordOutlineButton } from "@/components/records/record-layout";

/**
 * Send the document as a link: by WhatsApp, Viber, a text message or email,
 * from the person's own phone or computer. The customer opens it without
 * signing in, sees what is owed and how to pay, and downloads the PDF; this
 * says when they opened it. No attachment to remember.
 */
export function ShareLinkPanel({ kind, documentId, number, message, subject, customer, link, origin }: {
  kind: LinkKind; documentId: string; number: string;
  /** The words sent with the link, before it. */
  message: string; subject: string;
  customer: { name: string; email: string | null; phone: string | null; country: string };
  link: DocumentLink | null; origin: string;
}) {
  const [token, setToken] = useState(link?.token ?? null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const url = token ? `${origin}/d/${token}` : null;
  const text = url ? `${message} ${url}` : "";
  const phone = customer.phone ? internationalNumber(customer.phone, customer.country) : null;
  const sentBy = (by: "WhatsApp" | "Viber" | "a text message") => { if (kind === "invoice") start(() => markLinkSent(documentId, by)); };

  if (!url) return <div className="space-y-2">
    <button type="button" disabled={pending} onClick={() => start(async () => { const made = await shareDocument(kind, documentId); if (made.token) setToken(made.token); else setError(made.error); })} className={recordButton}>
      <Link2 className="size-3.5" />{pending ? "Making the link…" : "Share as a link"}
    </button>
    <p className="text-ink-faint text-[12.5px]">For WhatsApp, Viber, a text or an email: {customer.name} opens it on their phone, sees {kind === "invoice" ? "what is owed and how to pay" : "the quote and can accept it"}, and downloads the PDF.</p>
    {error ? <p role="alert" className="text-critical text-[12.5px]">{error}</p> : null}
  </div>;

  return <div className="space-y-3">
    <div className="border-hairline-strong bg-surface-sunken flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
      <Link2 className="text-ink-faint size-3.5 shrink-0" />
      <input readOnly value={url} aria-label={`Link to ${number}`} onFocus={event => event.target.select()} className="text-ink min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none" />
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }); }} className="text-brand hover:bg-brand-50 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy"}
      </button>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <a href={`https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => sentBy("WhatsApp")} className={recordOutlineButton}><MessageCircle className="size-3.5" />WhatsApp</a>
      <a href={`viber://forward?text=${encodeURIComponent(text)}`} onClick={() => sentBy("Viber")} className={recordOutlineButton}><Phone className="size-3.5" />Viber</a>
      <a href={`sms:${phone ? `+${phone}` : ""}?&body=${encodeURIComponent(text)}`} onClick={() => sentBy("a text message")} className={recordOutlineButton}><MessageSquareText className="size-3.5" />Text</a>
      <a href={`mailto:${encodeURIComponent(customer.email ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${message}\n\n${url}`)}`} className={recordOutlineButton}><Mail className="size-3.5" />Email</a>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="text-ink-muted flex items-center gap-1.5 text-[12.5px]">
        <Eye className="size-3.5" />{link?.views ? `Opened ${link.views === 1 ? "once" : `${link.views} times`}, last ${formatAgo(link.last_viewed_at!)}` : "Not opened yet"}
        {link?.accepted_at ? <span className="text-positive font-medium"> · accepted by {link.accepted_name}, {formatDate(link.accepted_at.slice(0, 10))}</span> : null}
      </p>
      <span className="flex items-center gap-3">
        <a href={`${url}?preview=1`} target="_blank" rel="noreferrer" className="text-brand text-[12.5px] font-medium hover:underline">See what they see</a>
        {link ? <form action={stopSharing}><input type="hidden" name="id" value={link.id} /><InlineSubmit destructive title="Stop this link: it no longer opens">Stop the link</InlineSubmit></form> : null}
      </span>
    </div>
  </div>;
}
