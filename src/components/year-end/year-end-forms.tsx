"use client";

import { useId } from "react";

import { saveCompanyLaw, saveYearEndDates, saveYearEndFigures } from "@/lib/actions/year-end";
import { ActionForm } from "@/components/common/action-form";
import { Checkbox, Field, NativeSelect, TextArea, TextInput } from "@/components/common/form-fields";

/** The year end's forms: each opens from its section, so the page itself stays a list of what is done and what is next. */

type Dates = { sent_to_auditor_on: string | null; approved_on: string | null; report_signed_on: string | null; opinion: string | null; agm_on: string | null; filed_on: string | null; tax_return_filed_on: string | null; notes: string | null };

export function YearEndDatesForm({ periodEnd, review, dates }: { periodEnd: string; review: boolean; dates: Dates }) {
  const uid = useId();
  const date = (name: keyof Dates, label: string, hint?: string) => <Field label={label} htmlFor={`${uid}-${name}`} hint={hint}>
    <TextInput id={`${uid}-${name}`} name={name} type="date" defaultValue={dates[name] ?? ""} />
  </Field>;
  return <ActionForm action={saveYearEndDates} label="Save dates">
    <input type="hidden" name="period_end" value={periodEnd} />
    <div className="grid gap-4 sm:grid-cols-2">
      {date("sent_to_auditor_on", review ? "Sent to the reviewer" : "Sent to the auditor")}
      {date("approved_on", "Approved by the board")}
      {date("report_signed_on", "Report signed", "on or after the approval")}
      <Field label={review ? "Conclusion" : "Opinion"} htmlFor={`${uid}-opinion`}>
        <NativeSelect id={`${uid}-opinion`} name="opinion" defaultValue={dates.opinion ?? ""}>
          <option value="">Not signed yet</option>
          <option value="unmodified">Unmodified</option>
          <option value="qualified">Qualified</option>
          <option value="adverse">Adverse</option>
          <option value="disclaimer">{review ? "No conclusion (disclaimer)" : "Disclaimer of opinion"}</option>
        </NativeSelect>
      </Field>
      {date("agm_on", "Annual general meeting")}
      {date("filed_on", "Filed with the Registrar")}
      {date("tax_return_filed_on", "Company tax return filed")}
      <Field label="Notes" htmlFor={`${uid}-notes`} hint="optional" className="sm:col-span-2">
        <TextArea id={`${uid}-notes`} name="notes" rows={2} maxLength={2000} defaultValue={dates.notes ?? ""} placeholder="What was agreed with the auditor, adjustments, anything for next year" />
      </Field>
    </div>
  </ActionForm>;
}

export function YearEndFiguresForm({ periodEnd, assurance, country = "CY", reviewAllowed, startsBeforeBooks, booksFrom, priorInBooks, values }: {
  periodEnd: string; assurance: "audit" | "review" | "exempt"; country?: string; reviewAllowed: boolean | null; startsBeforeBooks: boolean; booksFrom: string; priorInBooks: boolean;
  values: { average_employees: number | null; turnover_before_books: number | null; prior_turnover: number | null; prior_total_assets: number | null };
}) {
  const uid = useId();
  const amount = (value: number | null) => value === null ? "" : String(value);
  const month = new Date(`${booksFrom}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return <ActionForm action={saveYearEndFigures} label="Save">
    <input type="hidden" name="period_end" value={periodEnd} />
    <fieldset className="space-y-2">
      <legend className="text-ink mb-1 text-[12px] font-medium">The financial statements are</legend>
      <label className="text-ink flex items-start gap-2 text-[12.5px]"><input type="radio" name="assurance" value="audit" defaultChecked={assurance === "audit"} className="accent-brand mt-0.5" />Audited by a statutory auditor</label>
      <label className={`flex items-start gap-2 text-[12.5px] ${reviewAllowed === false ? "text-ink-faint" : "text-ink"}`}>
        <input type="radio" name="assurance" value={country === "GB" ? "exempt" : "review"} defaultChecked={assurance === (country === "GB" ? "exempt" : "review")} disabled={reviewAllowed === false} className="accent-brand mt-0.5" />
        <span>{country === "GB" ? "Exempt from audit, as a small company" : "Reviewed under ISRE 2400 instead"}{reviewAllowed === false ? <span className="block text-[11.5px]">Not allowed for this year</span> : reviewAllowed === null ? <span className="text-ink-muted block text-[11.5px]">{country === "GB" ? "Allowed once the figures show it small" : "Allowed only once both years’ figures show it"}</span> : null}</span>
      </label>
    </fieldset>
    <div className="grid gap-4 sm:grid-cols-2">
      {startsBeforeBooks ? <Field label="Turnover before the books" htmlFor={`${uid}-before`} hint={`to ${month}`}>
        <TextInput id={`${uid}-before`} name="turnover_before_books" inputMode="decimal" defaultValue={amount(values.turnover_before_books)} placeholder="0.00" />
      </Field> : null}
      {priorInBooks ? null : <>
        <Field label="The year before: turnover" htmlFor={`${uid}-prior-turnover`}>
          <TextInput id={`${uid}-prior-turnover`} name="prior_turnover" inputMode="decimal" defaultValue={amount(values.prior_turnover)} placeholder="From last year’s accounts" />
        </Field>
        <Field label="The year before: total assets" htmlFor={`${uid}-prior-assets`} hint="before liabilities">
          <TextInput id={`${uid}-prior-assets`} name="prior_total_assets" inputMode="decimal" defaultValue={amount(values.prior_total_assets)} placeholder="From last year’s accounts" />
        </Field>
      </>}
      <Field label="Average number of employees" htmlFor={`${uid}-employees`} hint="for the company’s size">
        <TextInput id={`${uid}-employees`} name="average_employees" inputMode="numeric" defaultValue={values.average_employees === null ? "" : String(values.average_employees)} />
      </Field>
    </div>
  </ActionForm>;
}

export function CompanyLawForm({ values }: { values: { incorporated_on: string | null; auditor_name: string | null; auditor_is_practice: boolean; regulated: boolean; consolidated_group: boolean } }) {
  const uid = useId();
  return <ActionForm action={saveCompanyLaw} label="Save">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Incorporated on" htmlFor={`${uid}-incorporated`} hint="sets the annual return’s date">
        <TextInput id={`${uid}-incorporated`} name="incorporated_on" type="date" defaultValue={values.incorporated_on ?? ""} />
      </Field>
      <Field label="Auditor" htmlFor={`${uid}-auditor`} hint="the firm">
        <TextInput id={`${uid}-auditor`} name="auditor_name" maxLength={160} defaultValue={values.auditor_name ?? ""} placeholder="Statutory audit firm" />
      </Field>
    </div>
    <div className="space-y-1.5">
      <Checkbox name="auditor_is_practice" defaultChecked={values.auditor_is_practice} label="The practice is the auditor as well as keeping the books" />
      <Checkbox name="regulated" defaultChecked={values.regulated} label="Regulated by the Central Bank, CySEC or the Superintendent of Insurance, or holds a qualifying stake in such a company" />
      <Checkbox name="consolidated_group" defaultChecked={values.consolidated_group} label="Part of a group that prepares consolidated financial statements" />
    </div>
  </ActionForm>;
}
