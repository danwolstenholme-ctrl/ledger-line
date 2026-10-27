"use client";

import { useActionState, useState } from "react";
import { FileText } from "lucide-react";

import { saveInvoiceDesign } from "@/lib/actions/sales";
import { idleState } from "@/lib/actions/state";
import { cn } from "@/lib/utils";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton, TextArea } from "@/components/common/form-fields";
import { DOCUMENT_LANGUAGES, type DocumentLanguage } from "@/lib/documents/document-words";
import { recordOutlineButton } from "@/components/records/record-layout";

const SWATCHES = ["#1d2433", "#0d6e6e", "#1f3a8a", "#6b21a8", "#7c4a2d", "#9a3412", "#166534", "#b91c1c"];

/** The logo, colour and footer terms on the company's invoices, quotes, credit notes and statements. */
/** `logoVersion` changes whenever the logo does, so the browser shows the one just uploaded; null when there is none. */
export function InvoiceDesignForm({ slug, accent, footer, logoVersion, previewHref, language = "en", cyprus = true }: {
  slug: string; accent: string; footer: string | null; logoVersion: string | null; previewHref: string | null;
  /** The language the documents are written in; a Cyprus company's can be Greek, or both. */
  language?: DocumentLanguage; cyprus?: boolean;
}) {
  const [state, action] = useActionState(saveInvoiceDesign, idleState);
  const [colour, setColour] = useState(accent);
  const [preview, setPreview] = useState<string | null>(null);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-4" noValidate>
    <Field label="Logo" htmlFor="design-logo" hint="PNG or JPEG, up to 1 MB" error={errors.logo}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="border-hairline bg-surface-sunken grid h-14 w-40 place-items-center overflow-hidden rounded border">
          {/* eslint-disable-next-line @next/next/no-img-element -- the company's own logo, served by the app */}
          {preview || logoVersion ? <img src={preview ?? `/c/${slug}/logo?v=${logoVersion}`} alt="Logo" className="max-h-12 max-w-36 object-contain" /> : <span className="text-ink-faint text-[11.5px]">No logo: the name is printed</span>}
        </span>
        <input id="design-logo" name="logo" type="file" accept="image/png,image/jpeg" className="text-ink-muted text-[12.5px] file:mr-3 file:rounded-md file:border file:border-hairline-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink"
          onChange={event => { const file = event.target.files?.[0]; setPreview(file ? URL.createObjectURL(file) : null); }} />
      </div>
    </Field>
    {logoVersion ? <Checkbox name="remove_logo" label="Remove the logo" /> : null}
    <Field label="Colour" htmlFor="design-accent" hint="for headings and the total" error={errors.invoice_accent}>
      <div className="flex flex-wrap items-center gap-2">
        <input id="design-accent" name="invoice_accent" type="color" value={colour} onChange={event => setColour(event.target.value)} className="border-hairline-strong h-8 w-12 cursor-pointer rounded border bg-transparent p-0.5" />
        {SWATCHES.map(swatch => <button key={swatch} type="button" onClick={() => setColour(swatch)} aria-label={`Use ${swatch}`}
          className={cn("size-6 rounded-full border-2", colour.toLowerCase() === swatch ? "border-ink" : "border-transparent")} style={{ backgroundColor: swatch }} />)}
      </div>
    </Field>
    {cyprus ? <Field label="Language" htmlFor="design-language" hint="a customer can have its own">
      <NativeSelect id="design-language" name="document_language" defaultValue={language}>
        {DOCUMENT_LANGUAGES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </NativeSelect>
    </Field> : <input type="hidden" name="document_language" value="en" />}
    <Field label="Terms at the foot" htmlFor="design-footer" hint="printed on every invoice, quote and statement">
      <TextArea id="design-footer" name="invoice_footer" rows={3} defaultValue={footer ?? ""} maxLength={600} placeholder="e.g. Payment within the agreed terms. Goods remain our property until paid in full." />
    </Field>
    <FormError message={state.error} />
    <div className="flex flex-wrap items-center gap-3">
      <SubmitButton pendingLabel="Saving…">Save the design</SubmitButton>
      {previewHref ? <a href={previewHref} target="_blank" rel="noopener" className={recordOutlineButton}><FileText className="size-3.5" />See it on an invoice</a> : null}
      {state.ok ? <span role="status" className="text-positive text-[13px]">Saved</span> : null}
    </div>
  </form>;
}
