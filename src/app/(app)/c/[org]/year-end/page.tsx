import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";
import { AlertTriangle, CheckCircle2, Circle, Download } from "lucide-react";

import { getYearEnd } from "@/lib/data/year-end";
import { FRAMEWORK_NOTE, INDEPENDENCE_NOTE, JOURNAL_FLAGS, OPINIONS, REVIEW_ASSET_LIMIT, SIZE_LABELS, UK_FRAMEWORK_NOTE, reviewTurnoverLimit, ukSmallLimits } from "@/lib/domain/audit";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordBadge, RecordDetail, RecordDisclosure, RecordFilterLinks, RecordHeader, RecordSection, recordButton } from "@/components/records/record-layout";
import { CompanyLawForm, YearEndDatesForm, YearEndFiguresForm } from "@/components/year-end/year-end-forms";

export const metadata: Metadata = { title: "Year end and audit" };

/**
 * One financial year's close, as Cyprus company law has it: audit or review,
 * the steps with the dates the law sets, what an auditor will check first,
 * and the audit file to send them.
 */
export default async function YearEndPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const data = await getYearEnd(period);
  const { org, checks, periodEnd } = data;
  const base = `/c/${org.slug}`;
  const review = data.assurance === "review";
  const uk = org.country === "GB", exempt = data.assurance === "exempt";
  const done = data.steps.filter(step => step.doneOn).length;
  const next = data.steps.find(step => !step.doneOn);
  const finished = periodEnd < data.today;
  const verdict = uk
    ? data.review.allowed === true ? (exempt ? "Exempt from audit: a small company" : "May be exempt from audit, as a small company") : data.review.allowed === false ? "Must be audited" : "Audit, unless it turns out small"
    : data.review.allowed === true ? (review ? "Reviewed under ISRE 2400, as the law allows" : "May be reviewed instead of audited")
    : data.review.allowed === false ? "Must be audited" : "Audit, unless both years turn out within the review limits";
  const limits = ukSmallLimits(data.yearStart);
  const figure = (value: number | null) => value === null ? "not known yet" : formatAmount(value);
  const whole = (value: number) => `${org.country === "GB" ? "£" : "€"}${value.toLocaleString("en-GB")}`;
  const range = `range=custom&from=${data.yearStart}&to=${periodEnd}`;
  const vatFiled = checks.vatQuarters - checks.missingVat.length;
  const list: { ok: boolean; text: string; href: string; action: string }[] = [
    { ok: checks.balanced, text: checks.balanced ? "The trial balance balances" : "The trial balance does not balance", href: `${base}/reports/trial-balance?${range}`, action: "Trial balance" },
    { ok: checks.locked, text: checks.locked ? `The books are locked to ${formatDate(checks.lockDate)}` : `The books are not locked to the year end${checks.lockDate ? `: locked to ${formatDate(checks.lockDate)}` : ""}`, href: `${base}/settings`, action: "Lock date" },
    { ok: checks.unmatched === 0, text: checks.unmatched ? `${checks.unmatched} bank line${checks.unmatched === 1 ? "" : "s"} in the year not matched` : "Every bank line in the year is matched", href: `${base}/bank`, action: "Bank" },
    ...(org.vat_registered ? [{ ok: checks.missingVat.length === 0, text: `${vatFiled} of ${checks.vatQuarters} VAT return${checks.vatQuarters === 1 ? "" : "s"} for the year filed`, href: `${base}/reports/vat`, action: "VAT returns" }] : []),
    { ok: checks.flagged.length === 0, text: `${checks.manualJournals} manual journal${checks.manualJournals === 1 ? "" : "s"}${checks.flagged.length ? `, ${checks.flagged.length} an auditor will ask about` : ", none out of the ordinary"}`, href: `${base}/journals`, action: "Journals" },
    { ok: checks.chain.intact, text: checks.chain.intact ? "The audit trail is intact" : "The audit trail is broken: a row was changed outside Ledgerline", href: `${base}/audit`, action: "Audit trail" },
  ];

  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="Year end and audit"
      description={<>Financial year {formatDate(data.yearStart)} to {formatDate(periodEnd)}. {exempt ? "Exempt from audit" : review ? "Review" : "Audit"}{data.size ? ` · ${SIZE_LABELS[data.size.size]} company` : ""} · {done} of {data.steps.length} steps done{next && finished ? `: next, ${next.label.toLowerCase()}` : ""}.</>}
      action={finished ? <a href={`${base}/year-end/file?period=${periodEnd}`} className={recordButton} download><Download className="size-4" />Download the audit file</a> : null} />
    {data.years.length > 1 ? <RecordFilterLinks label="Financial year" options={data.years.map(year => ({ label: `${year.label} · ${year.status}`, href: `${base}/year-end?period=${year.periodEnd}`, active: year.periodEnd === periodEnd }))} /> : null}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <RecordSection title="Steps" hint={uk ? "Dates from the Companies Act 2006 and HMRC" : "Dates from the Companies Law, Cap. 113, and the tax law"}>
          <ol className="divide-hairline divide-y">
            {data.steps.map(step => {
              const late = !step.doneOn && step.due !== null && step.due < data.today;
              return <li key={step.key} className="flex items-start gap-3 px-4 py-2.5">
                {step.doneOn ? <CheckCircle2 aria-label="Done" className="text-positive mt-0.5 size-4 shrink-0" /> : late ? <AlertTriangle aria-label="Late" className="text-critical mt-0.5 size-4 shrink-0" /> : <Circle aria-label="To do" className="text-ink-faint mt-0.5 size-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-ink text-[12.5px] font-medium">{step.label}{step.key === "report_signed_on" && data.row?.opinion ? <span className="text-ink-muted font-normal"> · {OPINIONS[data.row.opinion]}</span> : null}</p>
                  <p className="text-ink-muted text-[11.5px] leading-snug">{step.why}</p>
                </div>
                <p className={cn("shrink-0 text-right text-[12px] whitespace-nowrap tabular-nums", step.doneOn ? "text-ink-muted" : late ? "text-critical font-medium" : "text-ink")}>
                  {step.doneOn ? formatDate(step.doneOn) : step.due ? `${late ? "Was due" : "Due"} ${formatDate(step.due)}` : step.key === "books_closed" && finished ? <Link href={`${base}/settings`} className="text-brand hover:underline">Lock the books</Link> : ""}
                </p>
              </li>;
            })}
          </ol>
          {data.practice && finished ? <RecordDisclosure title="Record dates">
            <YearEndDatesForm periodEnd={periodEnd} review={review} dates={{ sent_to_auditor_on: data.row?.sent_to_auditor_on ?? null, approved_on: data.row?.approved_on ?? null, report_signed_on: data.row?.report_signed_on ?? null,
              opinion: data.row?.opinion ?? null, agm_on: data.row?.agm_on ?? null, filed_on: data.row?.filed_on ?? null, tax_return_filed_on: data.row?.tax_return_filed_on ?? null, notes: data.row?.notes ?? null }} />
          </RecordDisclosure> : null}
        </RecordSection>

        <RecordSection title={finished ? `Before it goes to the ${review ? "reviewer" : "auditor"}` : "So far this year"} hint={`What ${review ? "a reviewer" : "an auditor"} checks first`}>
          <ul className="divide-hairline divide-y">
            {list.map(item => <li key={item.action} className="flex items-center gap-3 px-4 py-2.5">
              {item.ok ? <CheckCircle2 aria-label="Fine" className="text-positive size-4 shrink-0" /> : <AlertTriangle aria-label="To look at" className="text-caution size-4 shrink-0" />}
              <p className="text-ink min-w-0 flex-1 text-[12.5px]">{item.text}</p>
              <Link href={item.href} className="text-brand shrink-0 text-[12px] hover:underline">{item.action}</Link>
            </li>)}
          </ul>
          {checks.flagged.length ? <RecordDisclosure title={`The ${checks.flagged.length} journal${checks.flagged.length === 1 ? "" : "s"} to explain`}>
            <ul className="space-y-2.5">
              {checks.flagged.map(entry => <li key={entry.id} className="text-[12.5px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link href={`${base}/journals/${entry.id}`} className="text-ink font-medium hover:underline">{formatDate(entry.entry_date)} · {entry.narration}</Link>
                  <span className="text-ink tabular-nums">{formatAmount(entry.total)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">{entry.flags.map(flag => <RecordBadge key={flag} tone="caution">{JOURNAL_FLAGS[flag]}</RecordBadge>)}</div>
              </li>)}
            </ul>
            <p className="text-ink-muted mt-3 text-[11.5px] leading-relaxed">Entries posted by hand carry the risk an auditor must test for under ISA 240: posted after the year end, at a weekend, in round amounts or with little explanation. Opening balances are agreed to the year before’s signed accounts. Each needs its support to hand.</p>
          </RecordDisclosure> : null}
        </RecordSection>
      </div>

      <div className="min-w-0 space-y-4">
        <RecordSection title={uk ? "Audit or exemption" : "Audit or review"} hint={uk ? "Companies Act 2006: small companies" : "Companies Law, s.152A"}>
          <div className="space-y-3 px-4 py-3.5">
            <p className="text-ink text-[13px] font-semibold">{verdict}</p>
            <ul className="text-ink-muted list-disc space-y-1 pl-4 text-[12px] leading-relaxed">{data.review.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            <dl className="divide-hairline border-hairline divide-y border-t">
              <RecordDetail label="This year" value={<>Turnover {figure(data.year.turnover)} · total assets {figure(data.year.assets)}</>} />
              {uk ? <RecordDetail label="Small company" value={<>Within at least two of: turnover {whole(limits.turnover)}, total assets {whole(limits.assets)}, {limits.employees} employees on average{data.yearStart < "2025-04-06" ? " (£15m and £7.5m for years beginning on or after 6 April 2025)" : ""}</>} />
                : <>
                  <RecordDetail label="The year before" value={data.prior ? <>Turnover {figure(data.prior.turnover)} · total assets {figure(data.prior.assets)}</> : null} />
                  <RecordDetail label="Review limits" value={<>Turnover {whole(reviewTurnoverLimit(data.yearStart))}{reviewTurnoverLimit(data.yearStart) === 200_000 ? " (€300,000 for years beginning on or after 6 February 2026)" : ""} and total assets {whole(REVIEW_ASSET_LIMIT)}, in both years</>} />
                </>}
            </dl>
          </div>
          {data.practice ? <RecordDisclosure title={`${data.startsBeforeBooks || (!uk && !data.priorInBooks) ? "Figures the books don’t have, and audit" : "Audit"} or ${uk ? "exemption" : "review"}${data.startsBeforeBooks || (!uk && !data.priorInBooks) ? "" : ", and employees"}`}>
            <YearEndFiguresForm periodEnd={periodEnd} assurance={data.assurance} country={org.country} reviewAllowed={data.review.allowed} startsBeforeBooks={data.startsBeforeBooks} booksFrom={data.booksFrom} priorInBooks={data.priorInBooks}
              values={{ average_employees: data.row?.average_employees === null || data.row?.average_employees === undefined ? null : Number(data.row.average_employees),
                turnover_before_books: data.row?.turnover_before_books === null || data.row?.turnover_before_books === undefined ? null : Number(data.row.turnover_before_books),
                prior_turnover: data.row?.prior_turnover === null || data.row?.prior_turnover === undefined ? null : Number(data.row.prior_turnover),
                prior_total_assets: data.row?.prior_total_assets === null || data.row?.prior_total_assets === undefined ? null : Number(data.row.prior_total_assets) }} />
          </RecordDisclosure> : null}
        </RecordSection>

        <RecordSection title="Size and framework">
          <dl className="divide-hairline divide-y px-4">
            {uk ? <RecordDetail label="Size" value={data.review.allowed === true ? "Small" : data.review.allowed === false ? "Larger than small" : "Not known until the year’s turnover is"} />
              : <RecordDetail label="Size" value={data.size ? <>{SIZE_LABELS[data.size.size]}{data.size.certain ? "" : ", subject to the average number of employees"}<span className="text-ink-muted block text-[11.5px]">Companies Law, s.141A: within at least two of the three limits (assets, turnover, employees), two years running to change size.</span></> : "Not known until the year’s turnover is"} />}
            <RecordDetail label="Framework" value={uk ? UK_FRAMEWORK_NOTE : FRAMEWORK_NOTE} />
          </dl>
        </RecordSection>

        <RecordSection title={review ? "The reviewer" : "The auditor"}>
          <dl className="divide-hairline divide-y px-4">
            <RecordDetail label={review ? "Reviewer" : "Auditor"} value={org.auditor_name ? <>{org.auditor_name}{org.auditor_is_practice ? <span className="text-ink-muted"> · the practice itself</span> : null}</> : null} />
            <RecordDetail label="Incorporated" value={org.incorporated_on ? formatDate(org.incorporated_on) : null} />
          </dl>
          {org.auditor_is_practice ? <p className="border-caution-line bg-caution-soft text-ink mx-4 mb-3 rounded-md border px-3 py-2 text-[12px] leading-relaxed">{INDEPENDENCE_NOTE}</p> : null}
          <p className="text-ink-muted border-hairline border-t px-4 py-3 text-[12px] leading-relaxed">
            The auditor can work in Ledgerline itself, reading the books but never changing them: <Link href={`${base}/settings/people`} className="text-brand hover:underline">invite them as the auditor</Link>.
          </p>
          {data.practice ? <RecordDisclosure title="The company’s details for the year end">
            <CompanyLawForm values={{ incorporated_on: org.incorporated_on, auditor_name: org.auditor_name, auditor_is_practice: org.auditor_is_practice, regulated: org.regulated, consolidated_group: org.consolidated_group }} />
          </RecordDisclosure> : null}
        </RecordSection>
      </div>
    </div>
  </PageBody>;
}
