"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";

import { fileVatReturn } from "@/lib/actions/accounts";
import { idleState } from "@/lib/actions/state";
import { FormError, SubmitButton } from "@/components/common/form-fields";

/** Record the return as filed and lock the books to the end of its period, in one press. */
export function FileVatReturn({ from, to, net }: { from: string; to: string; net: number }) {
  const [state, action] = useActionState(fileVatReturn, idleState);
  if (state.ok) return <p role="status" className="text-positive text-[12.5px] font-medium">{state.notice}</p>;
  return <form action={action} className="flex flex-col items-end gap-1 print:hidden">
    <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><input type="hidden" name="net" value={net} />
    <SubmitButton size="sm" pendingLabel="Filing…"><Lock className="size-3.5" />Mark as filed and lock the period</SubmitButton>
    <FormError message={state.error} />
  </form>;
}
