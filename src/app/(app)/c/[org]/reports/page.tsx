import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";

export const metadata: Metadata = { title: "Financial reports" };

const REPORTS = [
  { group: "Financial statements", items: [
    { href: "/accounts/reports/vat", title: "VAT return (VAT 4)", text: "The figures for form VAT 4, box by box, the date they are due, and filing that locks the period." },
    { href: "/accounts/reports/vies", title: "VIES statement", text: "Services to businesses in other EU states, by customer VAT number, less credit notes. Agrees with box 8B." },
    { href: "/accounts/reports/profit-and-loss", title: "Profit and loss", text: "Income less expenses for a period: on its own, beside last year, or month by month." },
    { href: "/accounts/reports/balance-sheet", title: "Balance sheet", text: "What the company owns and owes on a date, and the capital that equals it, beside a year earlier." },
    { href: "/accounts/reports/cash-flow", title: "Cash flow", text: "Where the money in the bank came from and went, for a period." },
  ] },
  { group: "For the accountant", items: [
    { href: "/accounts/reports/trial-balance", title: "Trial balance", text: "Every account’s balance in debit and credit columns that agree." },
    { href: "/accounts/reports/general-ledger", title: "General ledger", text: "Every transaction, account by account, brought and carried forward. Sage calls it nominal activity." },
    { href: "/accounts/reports/journal", title: "Journal report", text: "Every entry with its lines: Sage’s day books." },
    { href: "/accounts/audit", title: "Audit trail", text: "Every posting, match, lock and filing on a hash chain that shows any change made behind the app’s back." },
  ] },
  { group: "Who owes what", items: [
    { href: "/invoices/ageing", title: "Aged receivables", text: "Unpaid invoices by customer, by how far past due. Sage calls it aged debtors." },
    { href: "/accounts/reports/aged-payables", title: "Aged payables", text: "Unpaid bills by supplier, by how far past due. Sage calls it aged creditors." },
  ] },
] as const;

/** A UK company's VAT report is HMRC's nine boxes, and it has no VIES statement: that is for EU trade, which left with Brexit. */
const forCountry = (country: string) => country !== "GB" ? REPORTS : REPORTS.map(group => ({ ...group, items: group.items
  .filter(item => item.href !== "/accounts/reports/vies")
  .map(item => item.href === "/accounts/reports/vat" ? { ...item, title: "VAT return", text: "HMRC’s nine boxes, by the company’s scheme, the date they are due, and filing that locks the period." } : item) }));

export default async function ReportsPage() {
  const org = await requireOrg();
  return <PageBody className="space-y-4">
    <RecordHeader title="Reports" description="Every figure comes from the same ledger, so the statements always agree." />
    <Link href="/accounts/reports/overview" className="ll-panel border-brand-200 bg-brand-50 hover:bg-brand-100 block px-4 py-3.5 transition-colors">
      <span className="text-brand block text-[13.5px] font-semibold">Business overview</span>
      <span className="text-ink-muted mt-0.5 block text-[12px] leading-relaxed">Cash, what is owed each way, the year against the last, twelve months of charts, the books health checks, and an AI read of all of it on request.</span>
    </Link>
    <div className="grid items-start gap-4 lg:grid-cols-3">
      {forCountry(org.country).map(group => <section key={group.group} aria-label={group.group} className="ll-panel overflow-hidden">
        <h3 className="text-ink-faint border-hairline border-b px-4 py-2 text-[11px] font-semibold tracking-[0.06em] uppercase">{group.group}</h3>
        <ul className="divide-hairline divide-y">{group.items.map(item => <li key={item.href}>
          <Link href={item.href} className="hover:bg-surface-sunken block px-4 py-3">
            <span className="text-brand block text-[13px] font-medium">{item.title}</span>
            <span className="text-ink-muted mt-0.5 block text-[12px] leading-relaxed">{item.text}</span>
          </Link>
        </li>)}</ul>
      </section>)}
    </div>
  </PageBody>;
}
