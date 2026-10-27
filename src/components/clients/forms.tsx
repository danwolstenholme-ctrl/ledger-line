"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { BadgeCheck, BookOpenCheck, Mail, Plus, ScanSearch, Send, ShieldCheck, Upload, X } from "lucide-react";

import {
  approveAssessment, declineClient, openBooks, requestDocument, resolveScreening, saveAssessment, saveClientDetails, savePerson, screenFile, sendLetter, startClientFile, uploadDocument,
} from "@/lib/actions/clients";
import { idleState } from "@/lib/actions/state";
import { PERSON_COUNTRIES } from "@/lib/domain/countries";
import {
  areaScore, PEP, RISK_AREA_KEYS, RISK_AREAS, RISK_LEVELS, ROLES, scoredLevel, SERVICE_KEYS, SERVICES, type Person, type RiskFactor, type RiskLevel, type Service,
} from "@/lib/domain/onboarding";
import { cn } from "@/lib/utils";
import { Checkbox, Field, FormError, NativeSelect, SubmitButton, TextArea, TextInput } from "@/components/common/form-fields";
import { CopyBlock } from "@/components/crm/forms";
import { recordButton } from "@/components/records/record-layout";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const Saved = ({ text = "Saved" }: { text?: string }) => <span role="status" className="text-positive text-[12px]">{text}</span>;

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

export function StartClientForm() {
  const [state, action] = useActionState(startClientFile, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="space-y-3" noValidate>
    <Field label="Company name" htmlFor={`${uid}-name`} required error={errors.company_name}><TextInput id={`${uid}-name`} name="company_name" maxLength={200} autoComplete="off" placeholder="Kypros Ferry Lines Ltd" /></Field>
    <Field label="What the company does" htmlFor={`${uid}-business`} hint="for the risk assessment"><TextInput id={`${uid}-business`} name="business" maxLength={300} placeholder="Passenger and vehicle ferry services" /></Field>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Contact" htmlFor={`${uid}-contact`}><TextInput id={`${uid}-contact`} name="contact_name" maxLength={200} autoComplete="off" /></Field>
      <Field label="Email" htmlFor={`${uid}-email`} error={errors.contact_email}><TextInput id={`${uid}-email`} name="contact_email" type="email" autoComplete="off" /></Field>
      <Field label="Phone" htmlFor={`${uid}-phone`}><TextInput id={`${uid}-phone`} name="contact_phone" maxLength={40} autoComplete="off" /></Field>
    </div>
    <FormError message={state.error} />
    <SubmitButton pendingLabel="Starting…"><Plus className="size-3.5" />Start the client file</SubmitButton>
  </form>;
}

// ---------------------------------------------------------------------------
// Details and terms
// ---------------------------------------------------------------------------

type DetailsFile = {
  id: string; company_name: string; he_number: string | null; incorporated_on: string | null; registered_address: string | null; business: string; contact_name: string | null;
  contact_email: string | null; contact_phone: string | null; services: Service[]; monthly_fee: number; hourly_rate: number; app_fee: number; vat_registered: boolean; vat_number: string | null;
  vat_quarter_end_month: number; year_end_month: number; books_from: string | null; manager: string | null; face_to_face: boolean; introduced_by: string | null; signed_at: string | null; country?: string;
};

export function ClientDetailsForm({ file, staff, locked }: { file: DetailsFile; staff: string[]; locked: boolean }) {
  const [state, action] = useActionState(saveClientDetails, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const [registered, setRegistered] = useState(file.vat_registered);
  return <form action={action} className="space-y-4" noValidate>
    <input type="hidden" name="id" value={file.id} />
    <fieldset className="space-y-3">
      <legend className="text-ink-faint mb-1 text-[11px] font-semibold tracking-[0.06em] uppercase">The company</legend>
      <Field label="Company name" htmlFor={`${uid}-name`} required error={errors.company_name}><TextInput id={`${uid}-name`} name="company_name" defaultValue={file.company_name} maxLength={200} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country" htmlFor={`${uid}-country`} hint="its tax and company law" error={errors.country}><NativeSelect id={`${uid}-country`} name="country" defaultValue={file.country ?? "CY"}><option value="CY">Cyprus</option><option value="GB">United Kingdom</option></NativeSelect></Field>
        <Field label="Registration number" htmlFor={`${uid}-he`} hint="HE, or Companies House" error={errors.he_number}><TextInput id={`${uid}-he`} name="he_number" defaultValue={file.he_number ?? ""} placeholder="HE 431776" className="font-mono" /></Field>
        <Field label="Incorporated" htmlFor={`${uid}-inc`} error={errors.incorporated_on}><TextInput id={`${uid}-inc`} name="incorporated_on" type="date" defaultValue={file.incorporated_on ?? ""} /></Field>
      </div>
      <Field label="Registered office" htmlFor={`${uid}-address`}><TextInput id={`${uid}-address`} name="registered_address" defaultValue={file.registered_address ?? ""} maxLength={500} /></Field>
      <Field label="What the company does" htmlFor={`${uid}-business`} hint="for the risk assessment"><TextInput id={`${uid}-business`} name="business" defaultValue={file.business} maxLength={300} /></Field>
      <Field label="Contact" htmlFor={`${uid}-contact`} hint="who signs for the company"><TextInput id={`${uid}-contact`} name="contact_name" defaultValue={file.contact_name ?? ""} maxLength={200} /></Field>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <Field label="Email" htmlFor={`${uid}-email`} error={errors.contact_email}><TextInput id={`${uid}-email`} name="contact_email" type="email" defaultValue={file.contact_email ?? ""} /></Field>
        <Field label="Phone" htmlFor={`${uid}-phone`}><TextInput id={`${uid}-phone`} name="contact_phone" defaultValue={file.contact_phone ?? ""} maxLength={40} /></Field>
      </div>
      <Field label="Introduced by" htmlFor={`${uid}-intro`} hint="if someone referred them"><TextInput id={`${uid}-intro`} name="introduced_by" defaultValue={file.introduced_by ?? ""} maxLength={200} /></Field>
      <Checkbox name="face_to_face" defaultChecked={file.face_to_face} label="Met in person to check who they are" />
    </fieldset>

    <fieldset className="space-y-3" disabled={locked}>
      <legend className="text-ink-faint mb-1 text-[11px] font-semibold tracking-[0.06em] uppercase">The engagement{locked ? ": agreed in the signed letter" : ""}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">{SERVICE_KEYS.map(key => <label key={key} className="text-ink inline-flex items-center gap-1.5 text-[12.5px]">
        <input type="checkbox" name="services" value={key} defaultChecked={file.services.includes(key)} className="accent-brand size-3.5" />{SERVICES[key].label}</label>)}</div>
      {errors.services ? <p role="alert" className="text-critical text-[11.5px]">{errors.services}</p> : null}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Monthly fee €" htmlFor={`${uid}-fee`} error={errors.monthly_fee}><TextInput id={`${uid}-fee`} name="monthly_fee" defaultValue={file.monthly_fee ? file.monthly_fee.toFixed(2) : ""} inputMode="decimal" className="text-right tabular-nums" /></Field>
        <Field label="Extra work €/h" htmlFor={`${uid}-rate`}><TextInput id={`${uid}-rate`} name="hourly_rate" defaultValue={file.hourly_rate ? file.hourly_rate.toFixed(2) : ""} inputMode="decimal" className="text-right tabular-nums" /></Field>
        <Field label="App €/month" htmlFor={`${uid}-app`}><TextInput id={`${uid}-app`} name="app_fee" defaultValue={file.app_fee ? file.app_fee.toFixed(2) : ""} inputMode="decimal" className="text-right tabular-nums" /></Field>
      </div>
    </fieldset>

    <fieldset className="space-y-3">
      <legend className="text-ink-faint mb-1 text-[11px] font-semibold tracking-[0.06em] uppercase">The books</legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Books start" htmlFor={`${uid}-from`} error={errors.books_from}><TextInput id={`${uid}-from`} name="books_from" type="month" defaultValue={file.books_from?.slice(0, 7) ?? ""} /></Field>
        <Field label="Year end" htmlFor={`${uid}-ye`}><NativeSelect id={`${uid}-ye`} name="year_end_month" defaultValue={String(file.year_end_month)}>{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</NativeSelect></Field>
      </div>
      <Checkbox name="vat_registered" checked={registered} onChange={event => setRegistered(event.target.checked)} label="Registered for VAT" />
      {registered ? <div className="grid grid-cols-2 gap-3">
        <Field label="VAT number" htmlFor={`${uid}-vat`} error={errors.vat_number}><TextInput id={`${uid}-vat`} name="vat_number" defaultValue={file.vat_number ?? ""} placeholder="CY10431776Q" className="font-mono" /></Field>
        <Field label="VAT quarters end" htmlFor={`${uid}-q`}><NativeSelect id={`${uid}-q`} name="vat_quarter_end_month" defaultValue={String(file.vat_quarter_end_month)}>
          <option value="1">Jan, Apr, Jul, Oct</option><option value="2">Feb, May, Aug, Nov</option><option value="3">Mar, Jun, Sep, Dec</option></NativeSelect></Field>
      </div> : <input type="hidden" name="vat_quarter_end_month" value={file.vat_quarter_end_month} />}
      <Field label="Looked after by" htmlFor={`${uid}-manager`}><NativeSelect id={`${uid}-manager`} name="manager" defaultValue={file.manager ?? staff[0]}>{staff.map(name => <option key={name}>{name}</option>)}</NativeSelect></Field>
    </fieldset>
    <FormError message={state.error} />
    <div className="flex items-center gap-3"><SubmitButton pendingLabel="Saving…">Save the details</SubmitButton>{state.ok ? <Saved /> : null}</div>
  </form>;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function PersonForm({ fileId, person }: { fileId: string; person?: Person }) {
  const [state, action] = useActionState(savePerson, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const [pep, setPep] = useState(person?.pep ?? "no");
  return <form action={action} className="space-y-3" noValidate>
    <input type="hidden" name="file_id" value={fileId} />
    {person ? <input type="hidden" name="id" value={person.id} /> : null}
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
      <Field label="Full name, as on the passport" htmlFor={`${uid}-name`} required error={errors.name}><TextInput id={`${uid}-name`} name="name" defaultValue={person?.name ?? ""} maxLength={200} autoComplete="off" /></Field>
      <Field label="Shares %" htmlFor={`${uid}-own`} error={errors.ownership}><TextInput id={`${uid}-own`} name="ownership" defaultValue={person?.ownership ?? ""} inputMode="decimal" className="text-right tabular-nums" /></Field>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-label="What they are to the company">{(Object.keys(ROLES) as (keyof typeof ROLES)[]).map(role => <label key={role} className="text-ink inline-flex items-center gap-1.5 text-[12.5px]">
      <input type="checkbox" name="roles" value={role} defaultChecked={person?.roles.includes(role) ?? role === "director"} className="accent-brand size-3.5" />{ROLES[role]}</label>)}</div>
    {errors.roles ? <p role="alert" className="text-critical text-[11.5px]">{errors.roles}</p> : null}
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Date of birth" htmlFor={`${uid}-dob`} error={errors.date_of_birth}><TextInput id={`${uid}-dob`} name="date_of_birth" type="date" defaultValue={person?.date_of_birth ?? ""} /></Field>
      <Field label="Nationality" htmlFor={`${uid}-nat`} error={errors.nationality}><NativeSelect id={`${uid}-nat`} name="nationality" defaultValue={person?.nationality ?? ""}><option value="">Choose…</option>{PERSON_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</NativeSelect></Field>
      <Field label="Lives in" htmlFor={`${uid}-res`} error={errors.residence}><NativeSelect id={`${uid}-res`} name="residence" defaultValue={person?.residence ?? ""}><option value="">Choose…</option>{PERSON_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</NativeSelect></Field>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Identity document" htmlFor={`${uid}-kind`}><NativeSelect id={`${uid}-kind`} name="id_kind" defaultValue={person?.id_kind ?? ""}><option value="">Choose…</option><option value="passport">Passport</option><option value="id_card">Identity card</option></NativeSelect></Field>
      <Field label="Its number" htmlFor={`${uid}-idn`}><TextInput id={`${uid}-idn`} name="id_number" defaultValue={person?.id_number ?? ""} maxLength={40} className="font-mono" /></Field>
      <Field label="Expires" htmlFor={`${uid}-exp`} error={errors.id_expires}><TextInput id={`${uid}-exp`} name="id_expires" type="date" defaultValue={person?.id_expires ?? ""} /></Field>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Politically exposed?" htmlFor={`${uid}-pep`}><NativeSelect id={`${uid}-pep`} name="pep" value={pep} onChange={event => setPep(event.target.value as Person["pep"])}>{(Object.keys(PEP) as Person["pep"][]).map(key => <option key={key} value={key}>{PEP[key]}</option>)}</NativeSelect></Field>
      {pep !== "no" ? <Field label="The public function" htmlFor={`${uid}-pepd`} error={errors.pep_detail}><TextInput id={`${uid}-pepd`} name="pep_detail" defaultValue={person?.pep_detail ?? ""} maxLength={300} placeholder="Member of the House of Representatives, 2016–2021" /></Field> : null}
    </div>
    <FormError message={state.error} />
    <div className="flex items-center gap-3"><SubmitButton size="sm" pendingLabel="Saving…">{person ? "Save" : "Add the person"}</SubmitButton>{state.ok ? <Saved text={state.notice ?? "Saved"} /> : null}</div>
  </form>;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function DocumentUpload({ fileId, documentId, label }: { fileId: string; documentId: string; label: string }) {
  const [state, action] = useActionState(uploadDocument, idleState);
  return <form action={action} className="flex flex-wrap items-center justify-end gap-2">
    <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="document_id" value={documentId} />
    <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" aria-label={`Upload: ${label}`} className="text-ink-muted max-w-48 text-[11.5px] file:mr-2 file:rounded file:border file:border-hairline-strong file:bg-surface file:px-2 file:py-0.5 file:text-[11.5px]" />
    <SubmitButton size="sm" variant="outline" pendingLabel="Uploading…"><Upload className="size-3" />Upload</SubmitButton>
    {state.error ? <span role="alert" className="text-critical w-full text-right text-[11.5px]">{state.error}</span> : null}
  </form>;
}

export function RequestDocumentForm({ fileId }: { fileId: string }) {
  const [state, action] = useActionState(requestDocument, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="file_id" value={fileId} />
    <label htmlFor="request-label" className="sr-only">Ask for something else</label>
    <TextInput id="request-label" name="label" maxLength={200} placeholder="Ask for something else, e.g. the lease of the office" className="min-w-0 flex-1" />
    <SubmitButton size="sm" variant="outline" pendingLabel="Adding…"><Plus className="size-3" />Ask for it</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[11.5px]">{state.error}</span> : null}
  </form>;
}

// ---------------------------------------------------------------------------
// The letter
// ---------------------------------------------------------------------------

export function SendLetter({ fileId, sent, changed }: { fileId: string; sent: boolean; changed: boolean }) {
  const [state, action] = useActionState(sendLetter, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="id" value={fileId} />
    <SubmitButton variant={sent && !changed ? "outline" : "primary"} size={sent && !changed ? "sm" : "default"} pendingLabel="Sending…"><Send className="size-3.5" />{sent ? "Send the letter again" : "Send the engagement letter"}</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}

export function ClientLink({ link, email, subject, body, label = "Open in email" }: { link: string; email: string | null; subject: string; body: string; label?: string }) {
  return <div className="space-y-2">
    <CopyBlock label="The client’s link: the letter to sign and the documents to send" text={link} />
    {email ? <a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className={recordButton}><Mail className="size-3.5" />{label}</a> : null}
  </div>;
}

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

export function ScreenFileButton({ fileId, again }: { fileId: string; again: boolean }) {
  const [state, action] = useActionState(screenFile, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="id" value={fileId} />
    <SubmitButton size={again ? "sm" : "default"} variant={again ? "outline" : "primary"} pendingLabel="Screening…"><ScanSearch className="size-3.5" />{again ? "Screen again" : "Screen everyone"}</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : state.ok ? <Saved text={state.notice ?? "Screened"} /> : null}
  </form>;
}

export function ResolveMatch({ screeningId }: { screeningId: string }) {
  const [state, action] = useActionState(resolveScreening, idleState);
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  return <form action={action} className="border-hairline bg-surface space-y-2 rounded-md border p-3">
    <input type="hidden" name="id" value={screeningId} />
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" role="radiogroup" aria-label="Your decision">
      <label className="inline-flex items-center gap-1.5"><input type="radio" name="resolution" value="not_the_same" defaultChecked className="accent-brand" />Not the same person</label>
      <label className="inline-flex items-center gap-1.5"><input type="radio" name="resolution" value="confirmed" className="accent-critical" />It is them: a confirmed match</label>
    </div>
    <Field label="The reason for your decision" htmlFor={`${uid}-note`} error={errors.note}><TextArea id={`${uid}-note`} name="note" rows={2} maxLength={1000} placeholder="What tells them apart: the date of birth and nationality on the passport you saw, against the listing." /></Field>
    <FormError message={state.error} />
    <SubmitButton size="sm" pendingLabel="Saving…">Record the decision</SubmitButton>
  </form>;
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

const TONE: Record<RiskLevel, string> = { low: "text-positive", normal: "text-ink", high: "text-critical" };

/** The client risk assessment, factor by factor, with the score and level worked out as it is scored. */
export function RiskForm({ fileId, factors: initial, forced }: { fileId: string; factors: RiskFactor[]; forced: string | null }) {
  const [state, action] = useActionState(saveAssessment, idleState);
  const [factors, setFactors] = useState(initial.map(factor => ({ ...factor })));
  const [override, setOverride] = useState<RiskLevel | "">("");
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const scores = useMemo(() => Object.fromEntries(RISK_AREA_KEYS.map(area => [area, areaScore(factors, area)])) as Record<string, number>, [factors]);
  const total = RISK_AREA_KEYS.reduce((sum, area) => sum + scores[area], 0);
  const scored = scoredLevel(total);
  const level: RiskLevel = forced ? "high" : override || scored;
  const update = (index: number, patch: Partial<RiskFactor>) => setFactors(current => current.map((factor, at) => at === index ? { ...factor, ...patch } : factor));
  return <form action={action} className="space-y-4">
    <input type="hidden" name="file_id" value={fileId} />
    {RISK_AREA_KEYS.map(area => <fieldset key={area} className="border-hairline rounded-md border">
      <legend className="sr-only">{RISK_AREAS[area].label}</legend>
      <div className="border-hairline bg-surface-sunken flex items-baseline justify-between gap-3 border-b px-3 py-1.5">
        <p className="text-[12.5px]"><b className="text-ink font-semibold">{RISK_AREAS[area].label}</b><span className="text-ink-faint ml-2 text-[11.5px]">{RISK_AREAS[area].hint}</span></p>
        <p className="text-ink text-[12px] tabular-nums" aria-live="polite">Score <b>{scores[area]}</b></p>
      </div>
      <ul className="divide-hairline divide-y">{factors.map((factor, index) => factor.area !== area ? null : <li key={index} className="flex items-start gap-2 px-3 py-2">
        <input type="hidden" name="factor_area" value={factor.area} />
        <div className="min-w-0 flex-1">
          <label htmlFor={`${uid}-l${index}`} className="sr-only">Factor</label>
          <input id={`${uid}-l${index}`} name="factor_label" value={factor.label} onChange={event => update(index, { label: event.target.value })} maxLength={300}
            className="text-ink focus:border-hairline-strong w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] outline-none hover:border-hairline" />
          {factor.why ? <p className="text-ink-faint px-1 text-[11.5px]">{factor.why}</p> : null}
        </div>
        <label htmlFor={`${uid}-s${index}`} className="sr-only">Score for {factor.label}</label>
        <select id={`${uid}-s${index}`} name="factor_score" value={factor.score} onChange={event => update(index, { score: Number(event.target.value) })}
          className={cn("border-hairline-strong bg-surface h-7 w-14 rounded border px-1.5 text-center text-[12.5px] tabular-nums", factor.score >= 4 ? "text-critical font-semibold" : "text-ink")}>
          {[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}</option>)}
        </select>
        <button type="button" onClick={() => setFactors(current => current.filter((_, at) => at !== index))} disabled={factors.filter(item => item.area === area).length < 2}
          className="text-ink-faint hover:text-critical mt-1 disabled:invisible" aria-label={`Remove: ${factor.label}`}><X className="size-3.5" /></button>
      </li>)}</ul>
      <button type="button" onClick={() => setFactors(current => [...current, { area, label: "", score: 2 }])} className="text-brand hover:bg-brand-50 flex w-full items-center gap-1 px-3 py-1.5 text-left text-[12px]"><Plus className="size-3" />Add a factor</button>
    </fieldset>)}

    <div className="border-hairline-strong rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-ink text-[13px]">Total <b className="tabular-nums">{total}</b> of 20: <span className={cn("font-semibold", TONE[scored])}>{RISK_LEVELS[scored].label.toLowerCase()} risk</span>
          <span className="text-ink-faint text-[11.5px]"> · 4–8 low, 9–16 normal, 17–20 high</span></p>
        <p className={cn("text-[13px] font-semibold", TONE[level])}>{RISK_LEVELS[level].label} risk · {RISK_LEVELS[level].diligence}</p>
      </div>
      {forced ? <p className="text-critical mt-1 text-[12px]">High whatever the score: {forced}.</p> : <div className="mt-2 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="Rate it differently" htmlFor={`${uid}-ov`} error={errors.override_level}><NativeSelect id={`${uid}-ov`} name="override_level" value={override} onChange={event => setOverride(event.target.value as RiskLevel | "")}>
          <option value="">As scored</option>{(["low", "normal", "high"] as RiskLevel[]).filter(key => key !== scored).map(key => <option key={key} value={key}>{RISK_LEVELS[key].label}</option>)}</NativeSelect></Field>
        {override ? <Field label="Why it is rated differently" htmlFor={`${uid}-ovr`} error={errors.override_reason}><TextInput id={`${uid}-ovr`} name="override_reason" maxLength={1000} placeholder="The reason is kept with the assessment" /></Field> : null}
      </div>}
      <p className="text-ink-muted mt-2 text-[11.5px]">Approved by {RISK_LEVELS[level].approverLabel}; reviewed every {RISK_LEVELS[level].reviewYears === 1 ? "year" : `${RISK_LEVELS[level].reviewYears} years`}.</p>
    </div>
    <Field label="Notes" htmlFor={`${uid}-notes`}><TextArea id={`${uid}-notes`} name="notes" rows={2} maxLength={2000} /></Field>
    <FormError message={state.error} />
    <div className="flex items-center gap-3"><SubmitButton pendingLabel="Saving…"><ShieldCheck className="size-3.5" />Record the assessment</SubmitButton>{state.ok ? <Saved text="Assessed" /> : null}</div>
  </form>;
}

export function ApproveAssessment({ assessmentId, label }: { assessmentId: string; label: string }) {
  const [state, action] = useActionState(approveAssessment, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="id" value={assessmentId} />
    <SubmitButton pendingLabel="Approving…"><BadgeCheck className="size-3.5" />{label}</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}

// ---------------------------------------------------------------------------
// Opening the books, or declining
// ---------------------------------------------------------------------------

export function OpenBooksButton({ fileId, ready }: { fileId: string; ready: boolean }) {
  const [state, action] = useActionState(openBooks, idleState);
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="id" value={fileId} />
    <SubmitButton pendingLabel="Opening the books…" disabled={!ready}><BookOpenCheck className="size-3.5" />Take them on: open the books</SubmitButton>
    {state.error ? <span role="alert" className="text-critical text-[12px]">{state.error}</span> : null}
  </form>;
}

export function DeclineForm({ fileId }: { fileId: string }) {
  const [state, action] = useActionState(declineClient, idleState);
  return <form action={action} className="space-y-2">
    <input type="hidden" name="id" value={fileId} />
    <Field label="Why the practice is not taking them on" htmlFor="decline-reason" error={state.fieldErrors?.reason}><TextArea id="decline-reason" name="reason" rows={2} maxLength={1000} /></Field>
    <FormError message={state.error} />
    <SubmitButton size="sm" variant="outline" pendingLabel="Closing…">Decline the client</SubmitButton>
  </form>;
}
