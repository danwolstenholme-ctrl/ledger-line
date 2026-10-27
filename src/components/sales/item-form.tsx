"use client";

import { useActionState, useId } from "react";

import { saveItem } from "@/lib/actions/sales";
import { idleState } from "@/lib/actions/state";
import type { PickerAccount } from "@/lib/domain/accounts";
import { priceInput } from "@/lib/domain/line-math";
import { Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import type { ItemRow } from "@/types/database";
import { useRegime } from "@/components/common/regime";

const UNITS = ["", "each", "hour", "day", "kg", "litre", "bottle", "case", "box", "month", "visit", "session", "person"];

/** A product or service, priced once: typing its name on an invoice line fills in the rest. */
export function ItemForm({ item, accounts, defaultAccount }: { item?: ItemRow; accounts: PickerAccount[]; defaultAccount: string }) {
  const { vatRates } = useRegime();
  const [state, action] = useActionState(saveItem, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const units = item?.unit && !UNITS.includes(item.unit) ? [...UNITS, item.unit] : UNITS;
  return <form action={action} className="space-y-4" noValidate>
    {item ? <input type="hidden" name="id" value={item.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-4">
      <Field label="Name" htmlFor={`${uid}-name`} required error={errors.name} hint="as it is printed on the invoice" className="sm:col-span-3">
        <TextInput id={`${uid}-name`} name="name" defaultValue={item?.name ?? ""} maxLength={200} autoComplete="off" placeholder="e.g. House espresso blend, 1 kg" />
      </Field>
      <Field label="Code" htmlFor={`${uid}-code`} error={errors.code} hint="optional">
        <TextInput id={`${uid}-code`} name="code" defaultValue={item?.code ?? ""} maxLength={40} className="font-mono uppercase" placeholder="ESP-1KG" />
      </Field>
      <Field label="Price before VAT" htmlFor={`${uid}-price`} required error={errors.unit_price}>
        <TextInput id={`${uid}-price`} name="unit_price" inputMode="decimal" defaultValue={item ? priceInput(item.unit_price) : ""} className="text-right tabular-nums" placeholder="0.00" />
      </Field>
      <Field label="Per" htmlFor={`${uid}-unit`}>
        <NativeSelect id={`${uid}-unit`} name="unit" defaultValue={item?.unit ?? ""}>{units.map(unit => <option key={unit} value={unit}>{unit || "—"}</option>)}</NativeSelect>
      </Field>
      <Field label="VAT rate" htmlFor={`${uid}-vat`} required error={errors.vat_rate}>
        <NativeSelect id={`${uid}-vat`} name="vat_rate" defaultValue={String(item?.vat_rate ?? vatRates[0])}>{vatRates.map(rate => <option key={rate} value={rate}>{rate}%</option>)}</NativeSelect>
      </Field>
      <Field label="Income account" htmlFor={`${uid}-account`} required error={errors.account_id}>
        <NativeSelect id={`${uid}-account`} name="account_id" defaultValue={item?.account_id ?? defaultAccount}>{accounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</NativeSelect>
      </Field>
      <Field label="Note" htmlFor={`${uid}-description`} hint="for you, not printed" className="sm:col-span-4">
        <TextInput id={`${uid}-description`} name="description" defaultValue={item?.description ?? ""} maxLength={500} />
      </Field>
    </div>
    <FormError message={state.error} />
    <div className="flex items-center gap-3">
      <SubmitButton pendingLabel="Saving…">{item ? "Save changes" : "Add the product"}</SubmitButton>
      {state.ok ? <span role="status" className="text-positive text-[12.5px]">Saved</span> : null}
    </div>
  </form>;
}
