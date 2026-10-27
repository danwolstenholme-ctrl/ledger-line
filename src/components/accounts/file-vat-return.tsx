"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";

import { fileVatReturn } from "@/lib/actions/accounts";
import { idleState } from "@/lib/actions/state";
import { FormError, SubmitButton, TextInput } from "@/components/common/form-fields";

/** Record the return as filed and lock the books to the end of its period, in one press, with the tax authority's reference for it if noted. */
export function FileVatReturn({ from, to, net, authority = "Tax For All" }: { from: string; to: string; net: number; authority?: string }) {
  const [state, action] = useActionState(fileVatReturn, idleState);
  if (state.ok) return <p role="status" className="text-positive text-[13px] font-medium">{state.notice}</p>;
  return <form action={action} className="flex flex-col items-end gap-1 print:hidden">
    <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><input type="hidden" name="net" value={net} />
    <div className="flex flex-wrap items-center justify-end gap-2">
      <TextInput name="reference" maxLength={60} placeholder="Reference, if noted" aria-label={`${authority}’s reference for the return (if noted)`} className="w-48" autoComplete="off" />
      <SubmitButton size="sm" pendingLabel="Filing…"><Lock className="size-3.5" />Mark as filed and lock the period</SubmitButton>
    </div>
    <FormError message={state.error} />
  </form>;
}
