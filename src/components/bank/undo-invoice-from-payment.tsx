"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";

import { undoInvoiceFromPayment } from "@/lib/actions/bank-invoicing";
import { idleState } from "@/lib/actions/state";
import { SubmitButton } from "@/components/common/form-fields";
import { useI18n } from "@/components/common/locale";

/** Undo an invoice raised from a payment: the payment back on the bank's statement, the invoice void. Asked twice. */
export function UndoInvoiceFromPayment({ id }: { id: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState(undoInvoiceFromPayment, idleState);
  const [armed, setArmed] = useState(false);
  const question = useRef<HTMLSpanElement>(null), button = useRef<HTMLButtonElement>(null);
  // Focus follows the question when it is asked, and goes back to Undo when it isn't.
  const asked = useRef(false);
  useEffect(() => {
    if (armed) question.current?.focus();
    else if (asked.current) button.current?.focus();
    asked.current = armed;
  }, [armed]);
  if (!armed) return <button ref={button} type="button" onClick={() => setArmed(true)} className="text-ink-muted hover:text-critical inline-flex items-center gap-1.5 text-[13px]"><Undo2 className="size-3.5" />{t("Undo")}</button>;
  return <form action={action} className="flex flex-col gap-1">
    <input type="hidden" name="id" value={id} />
    <span className="flex flex-wrap items-center gap-2 text-[13px]"><span ref={question} tabIndex={-1} className="outline-none">{t("Void it, and put its payment back to match or code?")}</span>
      <SubmitButton size="sm" variant="outline" pendingLabel={t("Undoing…")}>{t("Yes, undo it")}</SubmitButton>
      <button type="button" onClick={() => setArmed(false)} className="text-ink-muted text-[12.5px]">{t("Keep it")}</button>
    </span>
    {state.error ? <span role="alert" className="text-critical text-[12px]">{t.message(state.error)}</span> : null}
  </form>;
}
