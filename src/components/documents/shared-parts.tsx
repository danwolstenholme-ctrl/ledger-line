"use client";

import { useActionState, useState } from "react";
import { Check, CheckCircle2, Copy } from "lucide-react";

import { acceptSharedQuote } from "@/lib/actions/document-links";
import { idleState } from "@/lib/actions/state";
import { Field, FormError, SubmitButton, TextInput } from "@/components/common/form-fields";

/** A value the customer will want in their banking app, a tap to copy. `copy` and `copied`: the words, in the page's language. */
export function CopyValue({ label, value, copy = "Copy", copied: done = "Copied" }: { label: string; value: string; copy?: string; copied?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }); }}
    aria-label={`Copy ${label}`} className="text-brand hover:bg-brand-50 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium">
    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? done : copy}
  </button>;
}

/** The customer says yes, in their own name. `text`: the form's words, in the page's language. */
export function AcceptQuoteForm({ token, language, text }: {
  token: string; language: "en" | "el"; text: { name: string; placeholder: string; button: string; pending: string; thanks: string };
}) {
  const [state, action] = useActionState(acceptSharedQuote, idleState);
  if (state.ok) return <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-start gap-2 rounded-xl border px-4 py-3 text-[14px]">
    <CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span className="font-medium">{text.thanks}</span>
  </p>;
  return <form action={action} className="space-y-3">
    <input type="hidden" name="token" value={token} />
    <input type="hidden" name="lang" value={language} />
    <Field label={text.name} htmlFor="accept-name" error={state.fieldErrors?.name}><TextInput id="accept-name" name="name" autoComplete="name" maxLength={200} placeholder={text.placeholder} /></Field>
    <FormError message={state.error} />
    <SubmitButton pendingLabel={text.pending} className="w-full sm:w-auto">{text.button}</SubmitButton>
  </form>;
}
