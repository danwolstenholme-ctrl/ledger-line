import type { Metadata } from "next";
import { BadgeCheck, CheckCircle2 } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { checkEveryVatNumber } from "@/lib/actions/vat-checks";
import { getVatNumbers } from "@/lib/data/vat-numbers";
import { VIES_COUNTRIES } from "@/lib/domain/eu-vat";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { SubmitButton } from "@/components/common/form-fields";
import { RecordBadge, RecordEmpty, RecordHeader, RecordSection } from "@/components/records/record-layout";
import { VatChecker } from "@/components/vat/vat-check";

export const metadata: Metadata = { title: "VAT numbers" };

const STATE: Record<string, { label: (row: { kept: { checkedAt: string; name: string | null } | null }) => string; tone: "positive" | "caution" | "critical" | "neutral" }> = {
  valid: { label: row => `Valid, ${formatDate(row.kept!.checkedAt)}`, tone: "positive" },
  stale: { label: row => `Last valid ${formatDate(row.kept!.checkedAt)}: check again`, tone: "caution" },
  differs: { label: row => row.kept!.name ? `Registered to ${row.kept!.name}` : "Name doesn’t match", tone: "caution" },
  invalid: { label: row => `Not valid, ${formatDate(row.kept!.checkedAt)}`, tone: "critical" },
  unchecked: { label: () => "Not checked", tone: "caution" },
  malformed: { label: () => "Not a valid number", tone: "critical" },
};

/** The practice's VAT number checker: any EU number against VIES, and every number the practice zero-rates against, kept confirmed. */
export default async function VatNumbersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [data, query] = await Promise.all([getVatNumbers(), searchParams]);
  const down = data.availability ? Object.entries(data.availability).filter(([, up]) => !up).map(([code]) => code) : null;
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="VAT numbers" description="Check any EU VAT number against VIES, the European Commission’s register, and keep the answer as evidence. Before a sale is zero-rated under the reverse charge, the customer’s number should be valid in VIES." />

    {query.checked ? <p role="status" className="border-positive-line bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px]"><CheckCircle2 className="size-4 shrink-0" />{query.checked} number{query.checked === "1" ? "" : "s"} checked against VIES just now. Each answer is kept, and on the audit trail.</p> : null}

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
      <RecordSection title="Check a number">
        <div className="p-4"><VatChecker companies={data.companies} defaultCompany={data.practiceId} /></div>
      </RecordSection>
      <RecordSection title="The registers" hint={down === null ? "VIES didn’t say" : down.length ? `${down.length} not answering` : "All answering"}>
        <div className="flex flex-wrap gap-1.5 p-4">{Object.keys(VIES_COUNTRIES).map(code => {
          const up = data.availability ? data.availability[code] !== false : null;
          return <span key={code} title={`${VIES_COUNTRIES[code]}: ${up === null ? "unknown" : up ? "answering" : "not answering"}`}
            className={cn("inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[11px]", up === false ? "border-critical-line bg-critical-soft text-critical" : "border-hairline bg-surface-sunken text-ink-muted")}>
            <span className={cn("size-1.5 rounded-full", up === null ? "bg-ink-faint" : up ? "bg-positive" : "bg-critical")} />{code}</span>;
        })}</div>
        <p className="border-hairline text-ink-faint border-t px-4 py-2 text-[11.5px]">{down?.length ? `${down.map(code => VIES_COUNTRIES[code]).join(", ")}: checks there will wait until the register is back.` : "Member states take their registers down for maintenance now and then; VIES says which."}</p>
      </RecordSection>
    </div>

    <RecordSection title="Every EU customer and supplier" hint={`${data.counts.total} numbers across every company${data.counts.attention ? `, ${data.counts.attention} to look at` : ", all confirmed"}`}
      action={data.counts.total ? <form action={checkEveryVatNumber}><SubmitButton size="sm" pendingLabel="Asking VIES…"><BadgeCheck className="size-3.5" />Check every number now</SubmitButton></form> : undefined}>
      {data.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-[12.5px]">
        <thead><tr className="border-hairline bg-surface-sunken border-b text-left">{["Company", "Customer or supplier", "VAT number", "VIES"].map(label => <th key={label} scope="col" className="text-ink-faint px-4 py-2 text-[11px] font-semibold tracking-[0.06em] uppercase">{label}</th>)}</tr></thead>
        <tbody className="divide-hairline divide-y">{data.rows.map(row => {
          const state = STATE[row.state];
          return <tr key={`${row.kind}-${row.id}`}>
            <td className="text-ink-muted px-4 py-2.5">{row.company.replace(/ (Ltd|Limited)$/, "")}</td>
            <td className="px-4 py-2.5"><Link href={`/c/${row.slug}/${row.kind === "customer" ? "customers" : "suppliers"}/${row.id}`} className="text-ink hover:text-brand font-medium hover:underline">{row.name}</Link><span className="text-ink-faint ml-2 text-[11.5px]">{row.kind === "customer" ? "Customer" : "Supplier"}</span></td>
            <td className="px-4 py-2.5 font-mono">{row.shape.ok ? row.shape.display : row.vat_number}</td>
            <td className="px-4 py-2.5"><RecordBadge tone={state.tone}>{state.label(row)}</RecordBadge></td>
          </tr>;
        })}</tbody>
      </table></div> : <RecordEmpty title="No EU customers or suppliers">Customers marked as EU businesses, and suppliers abroad under the reverse charge, appear here.</RecordEmpty>}
    </RecordSection>

    <RecordSection title="Checks made" hint="Kept for good, and on each company’s audit trail">
      {data.recent.length ? <ul className="divide-hairline divide-y">{data.recent.map(check => <li key={check.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-[12.5px]">
        <span className="text-ink w-36 shrink-0 font-mono">{check.country}{check.number}</span>
        <span className={cn("w-24 shrink-0 font-medium", check.error ? "text-ink-muted" : check.valid ? "text-positive" : "text-critical")}>{check.error ? "No answer" : check.valid ? "Valid" : "Not valid"}</span>
        <span className="text-ink-muted min-w-0 flex-1 truncate">{check.name ?? (check.error ? check.error.replace(/_/g, " ").toLowerCase() : "Name not disclosed")}{check.consultation ? <span className="text-ink-faint font-mono"> · {check.consultation}</span> : null}</span>
        <span className="text-ink-faint text-[11.5px]">{check.requester_name.replace(/ (Ltd|Limited)$/, "")} · {formatDateTime(check.checked_at)}{check.source === "demo" ? " · demo" : ""}</span>
      </li>)}</ul> : <RecordEmpty title="No checks yet">Check a number above.</RecordEmpty>}
    </RecordSection>
  </PageBody>;
}
