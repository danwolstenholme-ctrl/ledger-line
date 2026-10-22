"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { idleState, type ActionState } from "@/lib/actions/state";
import { FormError, SubmitButton } from "@/components/common/form-fields";
import { DuplicateNotice } from "@/components/common/duplicate-notice";

export type FormAction = (previous: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A server-action form that keeps what the person typed when validation fails,
 * says "Saved" only until they type again, and resets only when asked to.
 */
export function ActionForm({ action, children, label = "Save changes", pendingLabel = "Saving…", reset = false, variant = "primary", noun = "record" }: { action: FormAction; children: ReactNode; label?: string; pendingLabel?: string; reset?: boolean; variant?: "primary" | "outline"; noun?: string }) {
  const [state, formAction] = useActionState(action, idleState);
  const ref = useRef<HTMLFormElement>(null);
  const allowReset = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [seen, setSeen] = useState(state);
  if (state !== seen) { setSeen(state); setDirty(false); }
  useEffect(() => {
    if (!state.ok || !reset) return;
    allowReset.current = true;
    try { ref.current?.reset(); } finally { allowReset.current = false; }
  }, [state, reset]);
  // A returned validation error still resolves a React form action. Preserve
  // drafts; only explicitly reset successful note/create forms above.
  return <form ref={ref} action={formAction} onReset={event => { if (!allowReset.current) event.preventDefault(); }} onChange={() => setDirty(true)} onSubmit={() => setDirty(true)} className="space-y-4">
    {children}
    <FormError message={state.error} />
    <DuplicateNotice duplicates={state.duplicates} noun={noun} />
    {state.fieldErrors ? <ul className="text-critical space-y-1 text-[12px]" role="alert">{Object.entries(state.fieldErrors).map(([key, value]) => <li key={key}>{key.replaceAll("_", " ")}: {value}</li>)}</ul> : null}
    <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingLabel={pendingLabel} variant={variant}>{label}</SubmitButton>{state.ok && !dirty ? <p role="status" className="text-positive inline-flex items-center gap-1.5 text-[12.5px]"><Check className="size-3.5" />Saved</p> : null}</div>
  </form>;
}

export function Hidden({ name, value }: { name: string; value: string | null | undefined }) { return value ? <input type="hidden" name={name} value={value} /> : null; }
