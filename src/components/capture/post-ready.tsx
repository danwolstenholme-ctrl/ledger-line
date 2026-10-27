"use client";

import { useActionState } from "react";
import { CheckCheck } from "lucide-react";

import { postReadyItems } from "@/lib/actions/capture";
import { idleState } from "@/lib/actions/state";
import { SubmitButton } from "@/components/common/form-fields";
import { useI18n } from "@/components/common/locale";

/** Every invoice whose checks pass and whose client is matched on VAT number, posted in one press. */
export function PostReady({ ids }: { ids: string[] }) {
  const { t } = useI18n();
  const [state, action] = useActionState(postReadyItems, idleState);
  if (!ids.length) return state.notice ? <p role="status" className="text-positive text-[13px] font-medium">{t.message(state.notice)}</p> : null;
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="item_ids" value={JSON.stringify(ids)} />
    <span className="text-ink-muted text-[12.5px]">{t.n(ids.length, "{count} passes every check and is matched on VAT number", "{count} pass every check and are matched on VAT number")}</span>
    <SubmitButton size="sm" pendingLabel={t("Posting…")}><CheckCheck className="size-3.5" />{t.n(ids.length, "Post it", "Post all {count}")}</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[12.5px]">{t.message(state.error)}</span> : state.notice ? <span role="status" className="text-positive text-[12.5px]">{t.message(state.notice)}</span> : null}
  </form>;
}
