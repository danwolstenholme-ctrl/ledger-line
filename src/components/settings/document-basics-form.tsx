"use client";

import { useActionState, useState } from "react";

import { saveDocumentBasics } from "@/lib/actions/document-styles";
import { idleState } from "@/lib/actions/state";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton } from "@/components/common/form-fields";
import { DOCUMENT_LANGUAGES, type DocumentLanguage } from "@/lib/documents/document-words";

/**
 * The logo at the head of every document the company sends, and the language
 * they are written in. `logoVersion` changes whenever the logo does, so the
 * browser shows the one just uploaded; null when there is none.
 */
export function DocumentBasicsForm({ slug, logoVersion, language = "en", cyprus = true }: {
  slug: string; logoVersion: string | null;
  /** A Cyprus company's documents can be in Greek, or both. */
  language?: DocumentLanguage; cyprus?: boolean;
}) {
  const [state, action] = useActionState(saveDocumentBasics, idleState);
  const [preview, setPreview] = useState<string | null>(null);
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-4" noValidate>
    <Field label="Logo" htmlFor="documents-logo" hint="PNG or JPEG, up to 1 MB" error={errors.logo}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="border-hairline bg-surface-sunken grid h-14 w-40 place-items-center overflow-hidden rounded border">
          {/* eslint-disable-next-line @next/next/no-img-element -- the company's own logo, served by the app */}
          {preview || logoVersion ? <img src={preview ?? `/c/${slug}/logo?v=${logoVersion}`} alt="Logo" className="max-h-12 max-w-36 object-contain" /> : <span className="text-ink-faint text-[11.5px]">No logo: the name is printed</span>}
        </span>
        <input id="documents-logo" name="logo" type="file" accept="image/png,image/jpeg" className="text-ink-muted text-[12.5px] file:mr-3 file:rounded-md file:border file:border-hairline-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink"
          onChange={event => { const file = event.target.files?.[0]; setPreview(file ? URL.createObjectURL(file) : null); }} />
      </div>
    </Field>
    {logoVersion ? <Checkbox name="remove_logo" label="Remove the logo" /> : null}
    {cyprus ? <Field label="Language" htmlFor="documents-language" hint="a customer can have its own">
      <NativeSelect id="documents-language" name="document_language" defaultValue={language}>
        {DOCUMENT_LANGUAGES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </NativeSelect>
    </Field> : <input type="hidden" name="document_language" value="en" />}
    <FormError message={state.error} />
    <div className="flex flex-wrap items-center gap-3">
      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      {state.ok ? <span role="status" className="text-positive text-[13px]">Saved</span> : null}
    </div>
  </form>;
}
