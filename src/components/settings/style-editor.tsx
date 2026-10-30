"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { saveDocumentStyle } from "@/lib/actions/document-styles";
import { idleState } from "@/lib/actions/state";
import { cn } from "@/lib/utils";
import { Checkbox, Field, FormError, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";
import { recordOutlineButton } from "@/components/records/record-layout";
import {
  FONTS, LAYOUTS, LOGO_PLACES, LOGO_SIZES, PAPERS, SIZES, STYLED_DOCUMENTS, SWATCHES, TERMS_MAX, TITLE_MAX,
  encodeStyle, type DocumentStyle, type StyledDocument,
} from "@/lib/documents/style";

/** One of a few choices, side by side: the one chosen is pressed. */
function Choice<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: readonly { key: T; label: string; hint?: string }[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  return <div role="group" aria-label={label} className="space-y-1.5">
    <p className="text-ink-muted text-[12px]">{label}</p>
    <div className={cn("border-hairline-strong bg-surface-sunken inline-flex flex-wrap rounded-md border p-0.5", disabled && "opacity-50")}>
      {options.map(option => <button key={option.key} type="button" disabled={disabled} aria-pressed={value === option.key} title={option.hint} onClick={() => onChange(option.key)}
        className={cn("rounded px-3 py-1 text-[12.5px] font-medium transition-colors touch:min-h-10 touch:px-4", value === option.key ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink")}>
        {option.label}
      </button>)}
    </div>
  </div>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="border-hairline space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
    <legend className="text-ink mb-1 text-[13px] font-semibold">{title}</legend>
    {children}
  </fieldset>;
}

const DEFAULT_TITLES: Record<StyledDocument, string> = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note", statement: "Statement", remittance: "Remittance advice" };
const TERMS_LABELS: Record<StyledDocument, string> = { invoice: "Terms", quote: "Terms", credit_note: "Terms", statement: "Message", remittance: "Note" };

/**
 * A document style, changed and seen at once: every choice redraws the PDF
 * beside it, on the company's own latest invoice, quote, credit note,
 * statement or remittance (a sample when it has none yet). Nothing is kept
 * until it is saved.
 */
export function StyleEditor({ slug, id, name: savedName, saved, hasLogo }: { slug: string; id: string; name: string; saved: DocumentStyle; hasLogo: boolean }) {
  const [state, action] = useActionState(saveDocumentStyle, idleState);
  const [draft, setDraft] = useState(saved);
  const [name, setName] = useState(savedName);
  const [kind, setKind] = useState<StyledDocument>("invoice");
  const [src, setSrc] = useState(`kind=invoice&style=${encodeStyle(saved)}`);
  const [loading, setLoading] = useState(true);
  const set = <K extends keyof DocumentStyle>(key: K, value: DocumentStyle[K]) => setDraft(current => ({ ...current, [key]: value }));
  const setText = (field: "titles" | "terms", value: string) => setDraft(current => ({ ...current, [field]: { ...current[field], [kind]: value } }));
  const query = `kind=${kind}&style=${encodeStyle(draft)}`;
  // The preview is drawn again a moment after the last change, not on every keystroke.
  useEffect(() => {
    if (query === src) return;
    const timer = setTimeout(() => { setSrc(query); setLoading(true); }, 350);
    return () => clearTimeout(timer);
  }, [query, src]);
  const changed = name !== savedName || JSON.stringify(draft) !== JSON.stringify(saved);
  const preview = `/c/${slug}/settings/documents/preview?${src}`;
  const errors = state.fieldErrors ?? {};

  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
    <form action={action} className="ll-panel space-y-5 p-4 sm:p-5" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="settings" value={JSON.stringify(draft)} />
      <Field label="Name" htmlFor="style-name" error={errors.name} hint="for choosing it on a customer">
        <TextInput id="style-name" name="name" value={name} maxLength={60} onChange={event => setName(event.target.value)} />
      </Field>

      <Group title="Layout and type">
        <Choice label="Layout" value={draft.layout} options={LAYOUTS} onChange={value => set("layout", value)} />
        <p className="text-ink-faint -mt-1 text-[12px]">{LAYOUTS.find(layout => layout.key === draft.layout)?.hint}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <Choice label="Type" value={draft.font} options={FONTS} onChange={value => set("font", value)} />
          <Choice label="Size" value={draft.size} options={SIZES} onChange={value => set("size", value)} />
          <Choice label="Paper" value={draft.paper} options={PAPERS} onChange={value => set("paper", value)} />
        </div>
      </Group>

      <Group title="Colour and logo">
        <div className={cn("space-y-1.5", draft.layout === "plain" && "opacity-50")}>
          <p className="text-ink-muted text-[12px]">Colour{draft.layout === "plain" ? ": the plain layout is black on white" : ""}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Colour" type="color" value={draft.accent} disabled={draft.layout === "plain"} onChange={event => set("accent", event.target.value.toLowerCase())}
              className="border-hairline-strong h-8 w-12 cursor-pointer rounded border bg-transparent p-0.5" />
            {SWATCHES.map(swatch => <button key={swatch} type="button" disabled={draft.layout === "plain"} onClick={() => set("accent", swatch)} aria-label={`Use ${swatch}`}
              className={cn("size-6 rounded-full border-2", draft.accent === swatch ? "border-ink" : "border-transparent")} style={{ backgroundColor: swatch }} />)}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <Choice label="Logo" value={draft.logoPlace} options={LOGO_PLACES} onChange={value => set("logoPlace", value)} disabled={draft.letterhead} />
          <Choice label="Logo size" value={draft.logoSize} options={LOGO_SIZES} onChange={value => set("logoSize", value)} disabled={!hasLogo || draft.letterhead} />
        </div>
        {hasLogo ? null : <p className="text-ink-faint text-[12px]">No logo yet: the company’s name is printed in its place. Add one under Logo and language.</p>}
        <Checkbox label="We print on headed paper: leave room at the top, and leave out our own heading" checked={draft.letterhead} onChange={event => set("letterhead", event.target.checked)} />
      </Group>

      <Group title="What they show">
        <Checkbox label="HE number and TIC beside the VAT number" checked={draft.showRegistration} onChange={event => set("showRegistration", event.target.checked)} />
        <Checkbox label="Our email under the address" checked={draft.showContact} onChange={event => set("showContact", event.target.checked)} />
        <Checkbox label="Quantity and unit price on every invoice" checked={draft.itemColumns === "always"} onChange={event => set("itemColumns", event.target.checked ? "always" : "auto")} />
        <Checkbox label="Each line’s VAT rate" checked={draft.showVatRate} onChange={event => set("showVatRate", event.target.checked)} />
        <Checkbox label="How to pay, with the bank details" checked={draft.showPayment} onChange={event => set("showPayment", event.target.checked)} />
        <Checkbox label="A payment slip to cut off and send back" checked={draft.paymentSlip} onChange={event => set("paymentSlip", event.target.checked)} />
        <p className="text-ink-faint text-[12px]">A VAT-registered company’s VAT number is on every document, and the totals give the VAT at each rate, whatever is chosen here.</p>
      </Group>

      <Group title={`This document: ${DEFAULT_TITLES[kind].toLowerCase()}`}>
        <Field label="Title" htmlFor="style-title" hint="in English; a Greek document keeps its Greek title">
          <TextInput id="style-title" value={draft.titles[kind] ?? ""} maxLength={TITLE_MAX} placeholder={DEFAULT_TITLES[kind]} onChange={event => setText("titles", event.target.value)} />
        </Field>
        <Field label={TERMS_LABELS[kind]} htmlFor="style-terms" hint="printed at the foot">
          <TextArea id="style-terms" rows={4} value={draft.terms[kind] ?? ""} maxLength={TERMS_MAX} onChange={event => setText("terms", event.target.value)}
            placeholder={kind === "invoice" ? "e.g. Payment within the agreed terms. Goods remain our property until paid in full." : kind === "statement" ? "e.g. Please call us if anything here doesn’t match your records." : ""} />
        </Field>
        <p className="text-ink-faint text-[12px]">Choose another document beside the preview to set its title and {TERMS_LABELS[kind].toLowerCase() === "terms" ? "terms" : "words"}.</p>
      </Group>

      <FormError message={state.error ?? errors.settings} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save the style</SubmitButton>
        {changed ? <span className="text-caution text-[13px]">Not saved yet</span> : state.ok ? <span role="status" className="text-positive text-[13px]">Saved</span> : null}
      </div>
    </form>

    <section aria-label="Preview" className="ll-panel min-w-0 overflow-hidden lg:sticky lg:top-4">
      <div className="border-hairline flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div role="tablist" aria-label="Document to preview" className="flex flex-wrap gap-1">
          {STYLED_DOCUMENTS.map(document => <button key={document.key} type="button" role="tab" aria-selected={kind === document.key} onClick={() => setKind(document.key)}
            className={cn("rounded px-2.5 py-1 text-[12.5px] font-medium touch:min-h-10", kind === document.key ? "bg-brand-50 text-brand" : "text-ink-muted hover:text-ink")}>
            {document.label}
          </button>)}
        </div>
        <div className="flex items-center gap-3">
          {loading ? <span className="text-ink-faint text-[12px]" role="status">Drawing…</span> : null}
          <a href={preview} target="_blank" rel="noopener" className={recordOutlineButton}><ExternalLink className="size-3.5" />Open</a>
        </div>
      </div>
      <iframe src={`${preview}#toolbar=0&navpanes=0&view=FitH`} title="Preview of the document in this style" onLoad={() => setLoading(false)}
        className="bg-surface-sunken block h-[70vh] w-full lg:h-[calc(100vh-9rem)]" />
    </section>
  </div>;
}
