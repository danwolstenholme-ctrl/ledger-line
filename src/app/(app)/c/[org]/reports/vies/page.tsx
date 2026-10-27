import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getViesReport } from "@/lib/data/accounts";
import { countryName } from "@/lib/domain/countries";
import { formatAmount, formatDate } from "@/lib/format";
import { STALE_AFTER_DAYS, latestChecks } from "@/lib/vies";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { PeriodPicker } from "@/components/accounts/period-picker";
import { ReportHeading, periodLabel } from "@/components/accounts/report-parts";
import { RecordEmpty, RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "VIES statement" };

/**
 * The recapitulative (VIES) statement: services to businesses in other EU
 * states under the reverse charge, customer by customer, as the Tax
 * Department's form asks for them. It agrees with box 8B of the VAT return.
 */
export default async function ViesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const report = await getViesReport(await searchParams);
  const { period, lines, total, boxEightB } = report;
  const query = new URLSearchParams({ range: period.range, from: period.from, to: period.to });
  const agrees = Math.round(total * 100) === Math.round(boxEightB * 100);
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap";
  // Each number on the statement, as VIES last confirmed it: the statement is what an inspector cross-checks.
  const checks = await latestChecks(lines.filter(line => !line.missingNumber).map(line => `${line.vies_country}${line.vies_number}`));
  const unconfirmed = lines.filter(line => { const check = checks.get(`${line.vies_country}${line.vies_number}`); return !line.missingNumber && (!check || !check.valid); }).length;
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="VIES statement" back={{ href: "/accounts/reports", label: "Reports" }}
      description="Services to businesses in other EU states under the reverse charge, by customer VAT number, less credit notes." />
    <PeriodPicker action="/accounts/reports/vies" range={period.range} from={period.from} to={period.to} />
    <ReportHeading period={periodLabel(period.from, period.to)} exportHref={`/accounts/reports/vies/export?${query}`} />
    <Panel className="overflow-hidden">
      {lines.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Member state</th><th scope="col" className={head}>VAT number</th><th scope="col" className={head}>Customer</th>
          <th scope="col" className={head}>Confirmed in VIES</th>
          <th scope="col" className={cn(head, "text-right")}>Invoices</th><th scope="col" className={cn(head, "text-right")}>Credit notes</th><th scope="col" className={cn(head, "text-right")}>Value of services</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{lines.map(line => <tr key={line.customer_id}>
          <td className="px-3 py-2.5 text-[13px]"><span className="font-mono font-medium">{line.vies_country}</span><span className="text-ink-faint ml-2">{countryName(line.country)}</span></td>
          <td className="px-3 py-2.5 font-mono text-[13px]">{line.missingNumber ? <span className="text-critical inline-flex items-center gap-1 font-sans"><AlertTriangle className="size-3.5" />No VAT number</span> : line.vies_number}</td>
          <td className="px-3 py-2.5 text-[13px]"><Link href={`/accounts/customers/${line.customer_id}`} className="text-ink hover:text-brand">{line.name}</Link></td>
          <td className="px-3 py-2.5 text-[13px]">{(() => {
            const check = line.missingNumber ? null : checks.get(`${line.vies_country}${line.vies_number}`);
            if (!check) return <Link href={`/accounts/customers/${line.customer_id}`} className="text-caution hover:underline">Not checked</Link>;
            if (!check.valid) return <span className="text-critical font-medium">Not valid, {formatDate(check.checked_at)}</span>;
            const stale = Date.parse(check.checked_at) < Date.parse(`${period.to}T00:00:00Z`) - STALE_AFTER_DAYS * 86_400_000;
            return <span className={stale ? "text-caution" : "text-positive"}>{stale ? "Last valid " : "Valid, "}{formatDate(check.checked_at)}</span>;
          })()}</td>
          <td className="text-ink-muted px-3 py-2.5 text-right text-[13px] tabular-nums">{line.invoices}</td>
          <td className="text-ink-muted px-3 py-2.5 text-right text-[13px] tabular-nums">{line.credit_notes || "—"}</td>
          <td className="px-3 py-2.5 text-right text-[13px] font-medium tabular-nums">{formatAmount(line.value)}</td>
        </tr>)}</tbody>
        <tfoot className="border-hairline-strong border-t"><tr>
          <td colSpan={6} className="text-ink px-3 py-2.5 text-[13px] font-semibold">Total</td>
          <td className="px-3 py-2.5 text-right text-[13.5px] font-semibold tabular-nums">{formatAmount(total)}</td>
        </tr></tfoot>
      </table></div> : <RecordEmpty title="Nothing to report for this period">No services were invoiced to businesses in other EU states under the reverse charge.</RecordEmpty>}
    </Panel>
    {unconfirmed ? <p className="text-caution flex items-center gap-2 text-[13px]"><AlertTriangle className="size-4" />{unconfirmed} customer{unconfirmed === 1 ? "’s" : "s’"} VAT number{unconfirmed === 1 ? " has" : "s have"} not been confirmed in VIES. <Link href="/vat-numbers" className="text-brand font-medium hover:underline">Check every number</Link></p> : null}
    {lines.length ? <p className={cn("flex items-center gap-2 text-[13px]", agrees ? "text-positive" : "text-caution")}>
      {agrees ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
      {agrees ? `Agrees with box 8B of the VAT return for the same period (${formatAmount(boxEightB)}).` : `Box 8B of the VAT return for the period is ${formatAmount(boxEightB)}: check invoices to EU customers without a VAT number.`}
      <Link href={`/accounts/reports/vat?${query}`} className="text-brand font-medium hover:underline">Open the VAT return</Link>
    </p> : null}
  </PageBody>;
}
