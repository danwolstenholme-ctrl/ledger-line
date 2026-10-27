"use client";

import { useActionState } from "react";
import { CheckCheck } from "lucide-react";

import { postReadyItems } from "@/lib/actions/capture";
import { idleState } from "@/lib/actions/state";
import { SubmitButton } from "@/components/common/form-fields";

/** Every invoice whose checks pass and whose client is matched on VAT number, posted in one press. */
export function PostReady({ ids }: { ids: string[] }) {
  const [state, action] = useActionState(postReadyItems, idleState);
  if (!ids.length) return state.notice ? <p role="status" className="text-positive text-[13px] font-medium">{state.notice}</p> : null;
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="item_ids" value={JSON.stringify(ids)} />
    <span className="text-ink-muted text-[12.5px]">{ids.length} pass every check and are matched on VAT number</span>
    <SubmitButton size="sm" pendingLabel="Posting…"><CheckCheck className="size-3.5" />Post {ids.length === 1 ? "it" : `all ${ids.length}`}</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[12.5px]">{state.error}</span> : state.notice ? <span role="status" className="text-positive text-[12.5px]">{state.notice}</span> : null}
  </form>;
}
