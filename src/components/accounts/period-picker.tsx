"use client";

import { useId, useRef, useState } from "react";

import { REPORT_RANGES, type ReportRange } from "@/lib/domain/accounts";
import { cn } from "@/lib/utils";
import { NavigationForm } from "@/components/navigation/navigation-form";
import { NativeSelect, TextInput } from "@/components/common/form-fields";

const control = "touch:h-11 touch:text-[16px]";

/** A further choice beside the period, such as what to compare it with. Applies as soon as it is chosen. */
export type PeriodChoice = { name: string; label: string; value: string; options: readonly { key: string; label: string }[] };

/**
 * The report period: a named range applies as soon as it is chosen; a custom
 * one shows its two dates and applies when both are set. One row, above the
 * report it scopes.
 */
export function PeriodPicker({ action, range, from, to, extra = {}, asAt = false, choices = [] }: {
  action: string; range: ReportRange; from: string; to: string; extra?: Record<string, string>;
  /** A balance sheet or trial balance is as at one date, not over a period. */
  asAt?: boolean;
  choices?: PeriodChoice[];
}) {
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
  const [choice, setChoice] = useState<ReportRange>(range);
  const submit = () => setTimeout(() => form.current?.requestSubmit(), 0);
  return <NavigationForm ref={form} action={action} className="flex flex-wrap items-end gap-2 print:hidden">
    {Object.entries(extra).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
    <label className="text-ink-muted space-y-1 text-[11.5px]">
      <span className="block">{asAt ? "As at the end of" : "Period"}</span>
      <NativeSelect id={`${uid}-range`} name="range" aria-label={asAt ? "As at the end of" : "Report period"} value={choice} className={cn(control, "min-w-40")}
        onChange={event => { const next = event.target.value as ReportRange; setChoice(next); if (next !== "custom") submit(); }}>
        {REPORT_RANGES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        <option value="custom">{asAt ? "A date I choose" : "Dates I choose"}</option>
      </NativeSelect>
    </label>
    {choice === "custom" ? <>
      {asAt ? <input type="hidden" name="from" value="2000-01-01" /> : <label className="text-ink-muted space-y-1 text-[11.5px]">
        <span className="block">From</span>
        <TextInput type="date" name="from" defaultValue={from} aria-label="From" className={control} />
      </label>}
      <label className="text-ink-muted space-y-1 text-[11.5px]">
        <span className="block">{asAt ? "As at" : "To"}</span>
        <TextInput type="date" name="to" defaultValue={to} aria-label={asAt ? "As at" : "To"} className={control} />
      </label>
      <button className="border-hairline-strong text-ink hover:bg-muted h-8 rounded-md border px-3 text-[12.5px] font-medium touch:h-11">Show</button>
    </> : null}
    {choices.map(item => <label key={item.name} className="text-ink-muted space-y-1 text-[11.5px]">
      <span className="block">{item.label}</span>
      <NativeSelect name={item.name} aria-label={item.label} defaultValue={item.value} className={cn(control, "min-w-40")} onChange={submit}>
        {item.options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </NativeSelect>
    </label>)}
  </NavigationForm>;
}
