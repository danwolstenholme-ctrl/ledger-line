"use client";

import { useActionState, useId } from "react";

import { approvePayrollRun, deletePayrollRun, saveEmployee, setOtherPay, startPayrollRun } from "@/lib/actions/payroll";
import { idleState } from "@/lib/actions/state";
import { ActionForm } from "@/components/common/action-form";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton, TextInput } from "@/components/common/form-fields";
import { useCurrencySymbol } from "@/components/common/regime";
import { formatIban } from "@/lib/domain/iban";

/** Payroll's forms: an employee, starting a month, extra pay on a draft, and approving it. */

type Employee = {
  id: string; name: string; email: string | null; job_title: string | null; tic: string | null; social_insurance_no: string | null; id_document: string | null; date_of_birth: string | null;
  start_date: string; leave_date: string | null; monthly_salary: number; thirteenth_salary: boolean; iban: string | null; annual_deductions: number; annual_exemption: number;
  ytd_year: number | null; ytd_gross: number; ytd_insurable: number; ytd_si: number; ytd_gesy: number; ytd_tax: number;
};

const amount = (value: number | null | undefined) => value ? Number(value).toFixed(2) : "";

export function EmployeeForm({ employee, year }: { employee?: Employee; year: number }) {
  const [state, action] = useActionState(saveEmployee, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const text = (name: keyof Employee, label: string, options: { hint?: string; required?: boolean; type?: string; max?: number; className?: string; placeholder?: string; mono?: boolean } = {}) =>
    <Field label={label} htmlFor={`${uid}-${name}`} hint={options.hint} required={options.required} error={errors[name]} className={options.className}>
      <TextInput id={`${uid}-${name}`} name={name} type={options.type ?? "text"} maxLength={options.max ?? 200}
        defaultValue={employee?.[name] === null || employee?.[name] === undefined ? "" : name === "iban" ? formatIban(String(employee[name])) : String(employee[name])}
        placeholder={options.placeholder} className={options.mono ? "font-mono" : undefined} invalid={Boolean(errors[name])} />
    </Field>;
  const money = (name: keyof Employee, label: string, hint?: string) =>
    <Field label={label} htmlFor={`${uid}-${name}`} hint={hint} error={errors[name]}>
      <TextInput id={`${uid}-${name}`} name={name} inputMode="decimal" defaultValue={amount(employee?.[name] as number | undefined)} placeholder="0.00" className="text-right tabular-nums" invalid={Boolean(errors[name])} />
    </Field>;
  const brought = employee?.ytd_year ? employee.ytd_year : year;
  return <form action={action} className="space-y-5" noValidate>
    {employee ? <input type="hidden" name="id" value={employee.id} /> : null}
    <div className="grid gap-4 sm:grid-cols-2">
      {text("name", "Name", { required: true, placeholder: "As on their ID or passport" })}
      {text("job_title", "Job title", { max: 120 })}
      {text("start_date", "Started", { required: true, type: "date", max: 10 })}
      {text("leave_date", "Left", { type: "date", max: 10, hint: "when they leave" })}
      <Field label="Gross monthly salary" htmlFor={`${uid}-monthly_salary`} required error={errors.monthly_salary}>
        <TextInput id={`${uid}-monthly_salary`} name="monthly_salary" inputMode="decimal" defaultValue={amount(employee?.monthly_salary)} placeholder="0.00" className="text-right tabular-nums" invalid={Boolean(errors.monthly_salary)} />
      </Field>
      {text("iban", "IBAN", { max: 40, mono: true, hint: "their salary is paid to", placeholder: "CY17 0020 0128 0000 0012 0052 7600" })}
    </div>
    <Checkbox name="thirteenth_salary" defaultChecked={employee?.thirteenth_salary ?? true} label="Paid a 13th salary in December" />

    <fieldset className="space-y-3">
      <legend className="text-ink text-[12.5px] font-semibold">For the Tax Department and Social Insurance Services</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {text("tic", "Tax identification code (TIC)", { max: 20, mono: true })}
        {text("social_insurance_no", "Social insurance number", { max: 20, mono: true })}
        {text("id_document", "ID card or passport number", { max: 40, mono: true })}
        {text("date_of_birth", "Date of birth", { type: "date", max: 10 })}
        {text("email", "Email", { max: 320, type: "email", hint: "for their payslips" })}
      </div>
    </fieldset>

    <fieldset className="space-y-3">
      <legend className="text-ink text-[12.5px] font-semibold">Declared on form TD59 <span className="text-ink-muted font-normal">for the tax year</span></legend>
      <p className="text-ink-muted -mt-1 text-[12px] leading-relaxed">What they claim for the year: children, the interest or rent on their home, insurance. Exempt pay is any part of their pay the law exempts, such as the 50% for some who moved to Cyprus to work.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {money("annual_deductions", "Deductions")}
        {money("annual_exemption", "Exempt pay")}
      </div>
    </fieldset>

    <fieldset className="space-y-3">
      <legend className="text-ink text-[12.5px] font-semibold">The year so far, before Ledgerline <span className="text-ink-muted font-normal">from the previous payroll, so this year’s tax is right from the first run</span></legend>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tax year" htmlFor={`${uid}-ytd_year`} error={errors.ytd_year}>
          <TextInput id={`${uid}-ytd_year`} name="ytd_year" inputMode="numeric" maxLength={4} defaultValue={String(brought)} className="tabular-nums" />
        </Field>
        {money("ytd_gross", "Gross pay")}
        {money("ytd_insurable", "Insurable earnings")}
        {money("ytd_si", "Social insurance withheld")}
        {money("ytd_gesy", "GESY withheld")}
        {money("ytd_tax", "Income tax withheld")}
      </div>
    </fieldset>

    <FormError message={state.error} />
    <SubmitButton pendingLabel="Saving…">{employee ? "Save changes" : "Add the employee"}</SubmitButton>
  </form>;
}

/** The one thing to do on the payroll page: work out the next month. */
export function StartRunForm({ period, label }: { period: string; label: string }) {
  const [state, action] = useActionState(startPayrollRun, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-3">
    <input type="hidden" name="period" value={period} />
    <SubmitButton pendingLabel="Working it out…">{label}</SubmitButton>
    <FormError message={state.error} />
  </form>;
}

export function OtherPayForm({ runId, employees }: { runId: string; employees: { id: string; name: string; otherPay: number }[] }) {
  const uid = useId();
  const sign = useCurrencySymbol();
  return <ActionForm action={setOtherPay} label="Work it out again" pendingLabel="Working it out…" variant="outline">
    <input type="hidden" name="run_id" value={runId} />
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
      <Field label="Employee" htmlFor={`${uid}-employee`}>
        <NativeSelect id={`${uid}-employee`} name="employee_id" defaultValue="">
          <option value="" disabled>Choose…</option>
          {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.otherPay ? ` (${sign}${employee.otherPay.toFixed(2)} extra now)` : ""}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Extra pay this month" htmlFor={`${uid}-amount`} hint="gross">
        <TextInput id={`${uid}-amount`} name="other_pay" inputMode="decimal" placeholder="0.00" className="text-right tabular-nums" />
      </Field>
    </div>
  </ActionForm>;
}

export function ApproveRunForm({ id, label }: { id: string; label: string }) {
  return <ActionForm action={approvePayrollRun} label={label} pendingLabel="Posting…">
    <input type="hidden" name="id" value={id} />
  </ActionForm>;
}

export function DeleteRunForm({ id }: { id: string }) {
  const [state, action] = useActionState(deletePayrollRun, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-3">
    <input type="hidden" name="id" value={id} />
    <SubmitButton size="sm" variant="outline" pendingLabel="Deleting…">Delete this draft</SubmitButton>
    <FormError message={state.error} />
  </form>;
}
