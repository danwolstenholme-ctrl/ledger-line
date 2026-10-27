"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";

import { savePractice } from "@/lib/actions/practice";
import { idleState } from "@/lib/actions/state";
import { cn } from "@/lib/utils";
import { Field, FormError, SubmitButton, TextInput } from "@/components/common/form-fields";
import { LedgerlineMark } from "@/components/brand/ledgerline-mark";

const PRESETS = ["#0d6e6e", "#287db9", "#1f3a8a", "#7c2d12", "#166534", "#6b21a8", "#b91c1c", "#0f172a", "#a16207"];

/** Name, initials, tagline and colour. The page takes on the colour as you choose it; Save makes it the practice's. */
export function BrandForm({ practice }: { practice: { name: string; initials: string; tagline: string | null; brand_color: string } }) {
  const [state, action] = useActionState(savePractice, idleState);
  const [name, setName] = useState(practice.name);
  const [initials, setInitials] = useState(practice.initials);
  const [tagline, setTagline] = useState(practice.tagline ?? "");
  const [color, setColor] = useState(practice.brand_color);
  const paint = (value: string) => { setColor(value); document.documentElement.style.setProperty("--brand", value); };
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <div className="space-y-4">
      <Field label="Firm name" htmlFor="brand-name" required error={errors.name}><TextInput id="brand-name" name="name" value={name} maxLength={120} onChange={event => setName(event.target.value)} /></Field>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
        <Field label="Initials" htmlFor="brand-initials" required error={errors.initials}><TextInput id="brand-initials" name="initials" value={initials} maxLength={4} onChange={event => setInitials(event.target.value.toUpperCase())} /></Field>
        <Field label="Line under the name" htmlFor="brand-tagline" hint="optional"><TextInput id="brand-tagline" name="tagline" value={tagline} maxLength={120} onChange={event => setTagline(event.target.value)} /></Field>
      </div>
      <Field label="Brand colour" error={errors.brand_color}>
        <input type="hidden" name="brand_color" value={color} />
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(preset => <button key={preset} type="button" onClick={() => paint(preset)} aria-label={`Use ${preset}`} style={{ background: preset }}
            className={cn("grid size-8 place-items-center rounded-md text-white ring-offset-2 outline-none focus-visible:ring-2", color === preset && "ring-ink ring-2")}>{color === preset ? <Check className="size-4" /> : null}</button>)}
          <label className="border-hairline-strong flex h-8 items-center gap-2 rounded-md border px-2 text-[12.5px]">
            <input type="color" value={color} onChange={event => paint(event.target.value)} className="size-5 cursor-pointer border-0 bg-transparent p-0" aria-label="Any colour" />
            <span className="text-ink-muted font-mono">{color}</span>
          </label>
        </div>
      </Field>
      <FormError message={state.error} />
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save the brand</SubmitButton>
        {state.ok ? <p role="status" className="text-positive text-[13px]">{state.notice}</p> : <p className="text-ink-faint text-[12.5px]">The colour changes as you choose it. Save to keep it.</p>}
      </div>
    </div>
    <div className="space-y-2">
      <p className="ll-eyebrow">What your clients and staff see</p>
      <div className="ll-panel overflow-hidden">
        <div className="border-hairline flex items-center gap-2.5 border-b px-4 py-3">
          <span className="bg-brand grid size-9 shrink-0 place-items-center rounded-md text-[13.5px] font-semibold text-white">{initials || "··"}</span>
          <span className="min-w-0"><span className="text-ink block truncate text-[14px] font-semibold">{name || "Your firm"}</span><span className="text-ink-faint block truncate text-[12px]">{tagline}</span></span>
        </div>
        <div className="space-y-2 px-4 py-3">
          <span className="bg-accent text-brand block rounded-md px-2.5 py-1.5 text-[13px] font-medium">Practice dashboard</span>
          <span className="bg-brand inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-white">Post bill</span>
          <span className="text-brand ml-3 text-[13px] font-medium">Show the document</span>
        </div>
        <p className="border-hairline text-ink-faint flex items-center gap-1.5 border-t px-4 py-2 text-[11px]">Powered by <LedgerlineMark className="size-3.5" title="" /><span className="text-ink-muted font-semibold">Ledgerline</span></p>
      </div>
    </div>
  </form>;
}
