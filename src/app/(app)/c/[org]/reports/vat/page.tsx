import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { getUkVatFigures, getVatReport } from "@/lib/data/accounts";
import { ukVatDue } from "@/lib/domain/vat-uk";
import { vatBoxes, vatDueDate, type VatBox } from "@/lib/domain/accounts";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { AccountsNav } from "@/components/accounts/accounts-nav";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading, periodLabel } from "@/components/accounts/report-parts";
import { RecordFailure, RecordHeader } from "@/components/records/record-layout";
import { FileVatReturn } from "@/components/accounts/file-vat-return";

export const metadata: Metadata = { title: "VAT return" };

function BoxRows({ title, boxes }: { title: string; boxes: VatBox[] }) {
  return <section aria-label={title}>
    <h3 className="text-ink-faint border-hairline border-b px-4 pt-3 pb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">{title}</h3>
    <dl className="divide-hairline divide-y">
      {boxes.map(box => <div key={box.box} className={cn("flex items-start gap-3 px-4 py-2.5", (box.box === "5" || box.box === "3") && "bg-surface-sunken")}>
        <dt className="flex min-w-0 flex-1 items-start gap-3">
          <span aria-label={`Box ${box.box}`} className="border-hairline-strong text-ink inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-[2px] border px-1 font-mono text-[11.5px] font-semibold">{box.box}</span>
          <span className="min-w-0">
            <span className={cn("text-ink block text-[13px]", box.box === "5" && "font-semibold")}>{box.label}</span>
            {box.hint ? <span className="text-ink-faint block text-[11.5px]">{box.hint}</span> : null}
          </span>
        </dt>
        <dd className={cn("text-ink shrink-0 pt-0.5 text-right text-[13px] tabular-nums", box.box === "5" ? "font-semibold" : box.amount === 0 ? "text-ink-faint" : "font-medium")}>{formatAmount(box.amount)}</dd>
      </div>)}
    </dl>
  </section>;
}

/**
 * The VAT return as form VAT 4 numbers it, for any period: VAT charged on the
 * firm's invoices and paid on its costs, the reverse charge in both, and the
 * values the form asks for. Payments to and refunds from the Tax Department
 * are not VAT on anything, and are left out.
 */
export default async function VatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const report = await getVatReport(await searchParams);
  const { period } = report;
  if (report.uk) return <UkVatReturn report={report} uk={report.uk} />;
  const { vat, values, net } = vatBoxes(report.summary, report.breakdown);
  const due = vatDueDate(period.to);
  const query = new URLSearchParams({ range: period.range, from: period.from, to: period.to });
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="VAT return" description={report.org.vat_registered ? `Form VAT 4, box by box · ${report.org.vat_number}` : "This company is not registered for VAT: its purchase VAT is part of each cost."} back={{ href: "/accounts/reports", label: "Reports" }} />
    <AccountsNav current="/accounts/reports" />
    <PeriodPicker action="/accounts/reports/vat" range={period.range} from={period.from} to={period.to} />
    <ReportHeading period={periodLabel(period.from, period.to)} exportHref={`/accounts/reports/vat/export?${query}`} />
    {report.failed ? <RecordFailure what="the VAT figures" /> : <>
      <section aria-label="VAT for the period" className="ll-panel overflow-hidden">
        <div className="border-hairline flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4">
          <div>
            <p className="ll-eyebrow">{net >= 0 ? "VAT to pay" : "VAT to reclaim"}</p>
            <p className={cn("mt-1.5 text-[24px] leading-none font-semibold tracking-[-0.01em] tabular-nums", net > 0 ? "text-ink" : "text-positive")}>{formatAmount(Math.abs(net))}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {due ? <p className="text-ink-muted text-[12.5px]">{report.filed ? <>Filed on <span className="text-ink font-medium">{formatDate(report.filed.filed_on)}</span>; the period is locked</> : <>File and pay through Tax For All by <span className="text-ink font-medium">{formatDate(due)}</span></>}</p> : null}
            {!report.filed && due && report.org.vat_registered ? <FileVatReturn from={period.from} to={period.to} net={net} /> : null}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 lg:divide-x divide-hairline">
          <BoxRows title="VAT" boxes={vat} />
          <div className="border-hairline border-t lg:border-t-0"><BoxRows title="Values before VAT" boxes={values} /></div>
        </div>
        {report.boxSeven.length ? <details className="border-hairline border-t">
          <summary className="text-brand cursor-pointer px-4 py-2.5 text-[12.5px] font-medium touch:py-3">What makes up box 7</summary>
          <ul className="divide-hairline divide-y pb-1">{report.boxSeven.map(line => <li key={line.id}>
            <Link href={`/accounts/chart/${line.id}?range=custom&from=${period.from}&to=${period.to}`} className="hover:bg-surface-sunken flex items-baseline gap-3 px-4 py-2 text-[12.5px] touch:min-h-11 touch:items-center">
              <span className="text-ink-faint font-mono text-[11.5px]">{line.code}</span>
              <span className="text-ink min-w-0 flex-1 truncate">{line.name}</span>
              <span className="text-ink tabular-nums">{formatAmount(line.amount)}</span>
            </Link>
          </li>)}</ul>
        </details> : null}
        {report.vatAccount ? <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12px]">
          Every entry behind these figures is in <Link href={`/accounts/chart/${report.vatAccount.id}?range=custom&from=${period.from}&to=${period.to}`} className="text-brand hover:underline">{report.vatAccount.code} · {report.vatAccount.name}</Link>. A payment to or refund from the Tax Department is matched on the bank screen and coded to this account.
        </p> : null}
      </section>
    </>}
  </PageBody>;
}

const SCHEME_NOTES = { services: "Services bought from abroad", construction: "Construction services under the CIS domestic reverse charge", import: "Imports under postponed VAT accounting" } as const;

/**
 * A UK company's return: HMRC's nine boxes, by its scheme, from the same
 * ledger. Submitting it to HMRC through Making Tax Digital comes next; until
 * then it is filed in HMRC's own service, and recorded here.
 */
async function UkVatReturn({ report, uk }: { report: Awaited<ReturnType<typeof getVatReport>>; uk: NonNullable<Awaited<ReturnType<typeof getVatReport>>["uk"]> }) {
  const { period, org } = report;
  const flat = org.vat_flat_rate !== null;
  const annual = org.vat_period === "annual";
  const due = ukVatDue(period.to, annual);
  const scheme = [flat ? `Flat Rate Scheme at ${Number(org.vat_flat_rate)}%` : null, org.vat_cash_accounting ? (flat ? "turnover as paid" : "cash accounting") : null, annual ? "annual accounting" : null].filter(Boolean).join(" · ") || "Standard accounting";
  const query = new URLSearchParams({ range: period.range, from: period.from, to: period.to });
  const figures = await getUkVatFigures(org, period.from, period.to);
  const charges = (Object.keys(SCHEME_NOTES) as (keyof typeof SCHEME_NOTES)[]).filter(kind => figures.reverseCharge[kind].vat || figures.reverseCharge[kind].net);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="VAT return" back={{ href: "/accounts/reports", label: "Reports" }}
      description={org.vat_registered ? `HMRC’s VAT return, box by box · ${org.vat_number} · ${scheme}` : "This business is not registered for VAT: the VAT it pays is part of each cost."} />
    <PeriodPicker action="/accounts/reports/vat" range={period.range} from={period.from} to={period.to} />
    <ReportHeading period={periodLabel(period.from, period.to)} exportHref={`/accounts/reports/vat/export?${query}`} />
    <section aria-label="VAT for the period" className="ll-panel overflow-hidden">
      <div className="border-hairline flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4">
        <div>
          <p className="ll-eyebrow">{uk.net >= 0 ? "VAT to pay HMRC" : "VAT to reclaim from HMRC"}</p>
          <p className={cn("mt-1.5 text-[24px] leading-none font-semibold tracking-[-0.01em] tabular-nums", uk.net > 0 ? "text-ink" : "text-positive")}>{formatAmount(Math.abs(uk.net))}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="text-ink-muted text-[12.5px]">{report.filed ? <>Filed on <span className="text-ink font-medium">{formatDate(report.filed.filed_on)}</span>; the period is locked</>
            : <>Submit through Making Tax Digital and pay by <span className="text-ink font-medium">{formatDate(due)}</span></>}</p>
          {!report.filed && org.vat_registered ? <FileVatReturn from={period.from} to={period.to} net={uk.net} /> : null}
        </div>
      </div>
      <BoxRows title="The nine boxes" boxes={uk.boxes} />
      <div className="border-hairline text-ink-muted space-y-2 border-t px-4 py-3 text-[12px] leading-relaxed">
        {flat ? <p>On the Flat Rate Scheme the VAT due is {Number(org.vat_flat_rate)}% of the VAT-inclusive turnover, {formatAmount(uk.turnover)}: {formatAmount(uk.flatVat)}. VAT on everyday purchases isn’t reclaimed; only single capital purchases of £2,000 or more with VAT are. Filing moves the difference between the VAT charged to customers and the flat rate to account 265, Flat Rate Scheme surplus.</p> : null}
        {flat && uk.unclaimable > 0 ? <p className="text-caution">{formatAmount(uk.unclaimable)} of VAT on everyday purchases is in the books, and can’t be reclaimed on the scheme: enter those costs in full, with no VAT.</p> : null}
        {org.vat_cash_accounting && !flat ? <p>Cash accounting: VAT on sales counts when customers pay and VAT on purchases when suppliers are paid, each payment split between net and VAT as its invoice or bill was. Reverse charges count by the date of the document, as HMRC requires.</p> : null}
        {charges.length ? <p>Reverse charges in boxes 1 and 4. {charges.map(kind => `${SCHEME_NOTES[kind]}: ${formatAmount(figures.reverseCharge[kind].vat)} on ${formatAmount(figures.reverseCharge[kind].net)}`).join("; ")}. Services from abroad count in box 6 as well; all of them in box 7.</p> : null}
        <p>Boxes 2, 8 and 9 are Northern Ireland’s trade in goods with the EU, which Ledgerline doesn’t handle yet.</p>
      </div>
      {report.vatAccount ? <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12px]">
        Every entry behind these figures is in <Link href={`/accounts/chart/${report.vatAccount.id}?range=custom&from=${period.from}&to=${period.to}`} className="text-brand hover:underline">{report.vatAccount.code} · {report.vatAccount.name}</Link>. A payment to or refund from HMRC is matched on the bank screen and coded to this account.
      </p> : null}
    </section>
  </PageBody>;
}
