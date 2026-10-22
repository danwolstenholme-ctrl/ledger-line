"use client";

import { useActionState, useState } from "react";
import { BadgeCheck, Check, Copy, ShieldAlert, ShieldQuestion, TriangleAlert } from "lucide-react";

import { checkVat } from "@/lib/actions/vat-checks";
import { idleVatCheck, type VatCheckResult } from "@/lib/actions/state";
import { checkVatNumber, VIES_COUNTRIES } from "@/lib/domain/eu-vat";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SubmitButton } from "@/components/common/form-fields";

/** A check as a page shows it: a fresh answer, or the latest one kept. `stale` when it is older than the practice re-checks. */
export type VatAnswerView = VatCheckResult & { stale?: boolean };

function evidence(answer: VatAnswerView, ourName?: string | null) {
  return [`VIES check of ${answer.number} (${answer.countryName}): ${answer.valid ? "valid" : "not valid"}, ${formatDateTime(answer.checkedAt)}.`,
    answer.name ? `Registered name: ${answer.name}.` : `${answer.countryName} does not disclose the registered name${answer.match !== "unknown" && ourName ? `; it ${answer.match === "match" ? "confirmed" : "did not confirm"} the name ${ourName}` : ""}.`,
    answer.address ? `Address: ${answer.address}.` : null,
    answer.consultation ? `Consultation number: ${answer.consultation}.` : null,
    `Checked for ${answer.requester}.`].filter(Boolean).join(" ");
}

/**
 * What VIES said about a number, and what it means. A customer's number is
 * what lets a sale to it be zero-rated; a supplier's is what lets it bill
 * without VAT, so an invalid one is a question for the supplier.
 */
export function VatAnswer({ answer, ourName, role = "customer", className }: { answer: VatAnswerView; ourName?: string | null; role?: "customer" | "supplier"; className?: string }) {
  const [copied, setCopied] = useState(false);
  const tone = answer.error ? "neutral" : !answer.valid ? "critical" : answer.stale || answer.match === "differs" ? "caution" : "positive";
  const Icon = answer.error ? ShieldQuestion : !answer.valid ? ShieldAlert : answer.stale || answer.match === "differs" ? TriangleAlert : BadgeCheck;
  const headline = answer.error ? "VIES couldn’t answer"
    : !answer.valid ? role === "customer" ? `Not valid in VIES: don’t zero-rate sales to ${answer.number}` : "Not valid in VIES: ask the supplier why it bills without VAT"
    : answer.stale ? `Valid when last checked, ${formatDateTime(answer.checkedAt).replace(/, \d\d:\d\d$/, "")}: check again${role === "customer" ? " before the next zero-rated sale" : ""}`
    : `Valid in VIES`;
  const copy = async () => { try { await navigator.clipboard.writeText(evidence(answer, ourName)); setCopied(true); } catch { setCopied(false); } };
  return <div role="status" className={cn("rounded-md border px-3 py-2.5 text-[12.5px]",
    tone === "positive" ? "border-positive-line bg-positive-soft" : tone === "critical" ? "border-critical-line bg-critical-soft" : tone === "caution" ? "border-caution-line bg-caution-soft" : "border-hairline bg-surface-sunken", className)}>
    <p className={cn("flex items-start gap-2 font-medium", tone === "positive" ? "text-positive" : tone === "critical" ? "text-critical" : tone === "caution" ? "text-caution" : "text-ink")}>
      <Icon className="mt-0.5 size-4 shrink-0" /><span>{headline}</span>
    </p>
    {answer.error ? <p className="text-ink-muted mt-1 pl-6">{answer.error}</p> : <dl className="text-ink-muted mt-1.5 grid gap-x-3 gap-y-0.5 pl-6 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <dt>Number</dt><dd className="text-ink font-mono">{answer.number} <span className="text-ink-muted font-sans">· {answer.countryName}</span></dd>
      <dt>Registered to</dt><dd className="text-ink">{answer.name ?? <span className="text-ink-muted">{answer.countryName} doesn’t disclose it{answer.match === "match" && ourName ? `, but confirms it is ${ourName}` : ""}</span>}</dd>
      {answer.address ? <><dt>Address</dt><dd className="text-ink">{answer.address}</dd></> : null}
      <dt>Checked</dt><dd className="text-ink">{formatDateTime(answer.checkedAt)} · for {answer.requester}</dd>
      {answer.consultation ? <><dt>Consultation no.</dt><dd className="text-ink font-mono">{answer.consultation}</dd></> : null}
    </dl>}
    {answer.match === "differs" && ourName ? <p className="text-caution mt-1.5 pl-6">{answer.name ? <>VIES has this number registered to <b>{answer.name}</b>, not {ourName}.</> : <>{answer.countryName} says this number isn’t registered to {ourName}.</>} Make sure it is the same business before {role === "customer" ? "invoicing it" : "relying on its bills"}.</p> : null}
    {answer.note ? <p className="text-ink-muted mt-1.5 pl-6 text-[11.5px]">{answer.note}</p> : null}
    {answer.source === "demo" ? <p className="text-ink-faint mt-1.5 pl-6 text-[11.5px]">Demo answer: this company is invented, so the real register isn’t asked about it.</p> : null}
    {!answer.error ? <button type="button" onClick={copy} className="text-ink-muted hover:text-ink mt-2 ml-6 inline-flex items-center gap-1 text-[11.5px]">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy as evidence"}</button> : null}
  </div>;
}

/** "Check in VIES" for a number already on a record: the result replaces the one kept until the page reloads. */
export function VatCheckButton({ vat, country, organisationId, expectName, kept, role = "customer" }: { vat: string; country?: string | null; organisationId: string; expectName?: string | null; kept: VatAnswerView | null; role?: "customer" | "supplier" }) {
  const [state, action] = useActionState(checkVat, idleVatCheck);
  const shape = checkVatNumber(vat, country);
  const shown = state.result ?? kept;
  return <div className="space-y-2">
    {!shape.ok ? <p role="alert" className="text-critical text-[12.5px]">{shape.problem}</p> : null}
    {shown ? <VatAnswer answer={state.result ? state.result : { ...shown }} ourName={expectName} role={role} />
      : shape.ok ? <p className="text-ink-muted text-[12.5px]">Not checked in VIES yet. {role === "customer" ? "Check it before a sale to it is zero-rated under the reverse charge." : "Check it to know its bills without VAT are right."}</p> : null}
    {state.error ? <p role="alert" className="text-critical text-[12px]">{state.error}</p> : null}
    {shape.ok ? <form action={action}>
      <input type="hidden" name="vat" value={vat} /><input type="hidden" name="country" value={country ?? ""} />
      <input type="hidden" name="organisation_id" value={organisationId} /><input type="hidden" name="expect_name" value={expectName ?? ""} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Asking VIES…"><BadgeCheck className="size-3.5" />{shown ? "Check again" : "Check in VIES"}</SubmitButton>
    </form> : null}
  </div>;
}

/** Any EU VAT number, checked for any of the practice's companies. */
export function VatChecker({ companies, defaultCompany }: { companies: { id: string; name: string }[]; defaultCompany: string }) {
  const [state, action] = useActionState(checkVat, idleVatCheck);
  const [typed, setTyped] = useState("");
  const shape = typed.trim().length > 3 ? checkVatNumber(typed) : null;
  return <form action={action} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label className="block space-y-1 text-[12px]" htmlFor="vat-number"><span className="text-ink-muted">VAT number</span>
        <input id="vat-number" name="vat" value={typed} onChange={event => setTyped(event.target.value)} placeholder="DE298765435" autoComplete="off" spellCheck={false}
          className="border-hairline-strong bg-surface text-ink focus:border-brand h-9 w-full rounded-md border px-3 font-mono text-[13px] uppercase outline-none" /></label>
      <label className="block space-y-1 text-[12px]" htmlFor="vat-requester"><span className="text-ink-muted">Checking for</span>
        <select id="vat-requester" name="organisation_id" defaultValue={defaultCompany} className="border-hairline-strong bg-surface text-ink h-9 w-full rounded-md border px-2 text-[12.5px]">
          {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select></label>
      <SubmitButton pendingLabel="Asking VIES…"><BadgeCheck className="size-4" />Check</SubmitButton>
    </div>
    <p className={cn("text-[12px]", shape && !shape.ok ? "text-critical" : "text-ink-faint")}>
      {shape ? shape.ok ? `${shape.countryName}: the shape${shape.checked ? " and check digit are" : " is"} right. VIES will say whether it is registered.` : shape.problem
        : `Any of the ${Object.keys(VIES_COUNTRIES).length} VIES registers. The company checking gives its own VAT number, so VIES issues a consultation number.`}
    </p>
    {state.error ? <p role="alert" className="text-critical text-[12.5px]">{state.error}</p> : null}
    {state.result ? <VatAnswer answer={state.result} /> : null}
  </form>;
}
