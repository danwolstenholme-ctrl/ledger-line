import type { Metadata } from "next";
import { Check, Minus, X } from "lucide-react";

import { getPractice } from "@/lib/org";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { LedgerlineLockup } from "@/components/brand/ledgerline-mark";

export const metadata: Metadata = { title: "Ledgerline compared" };

type Mark = "yes" | "no" | "part" | "unknown";
type Row = { label: string; detail?: string; ledgerline: [Mark, string]; balabook: [Mark, string] };

const ROWS: { group: string; rows: Row[] }[] = [
  { group: "Getting documents in", rows: [
    { label: "AI capture of supplier invoices", detail: "PDF or photo, Greek or English", ledgerline: ["yes", "Several invoices to a PDF; photos"], balabook: ["yes", "AI scanning, AI draft transactions"] },
    { label: "Arithmetic and VAT checks", detail: "Lines, rates and totals checked by the software, not taken from the AI", ledgerline: ["yes", "Six checks per invoice, incl. duplicates"], balabook: ["unknown", "Not stated"] },
    { label: "Routes each document to the right client", detail: "From the bill-to name or VAT number, across the whole practice", ledgerline: ["yes", "One inbox for every client"], balabook: ["unknown", "Not stated"] },
    { label: "Matches or creates the supplier, suggests accounts, drafts the bill", ledgerline: ["yes", "In that client's own chart"], balabook: ["part", "AI draft transactions"] },
  ] },
  { group: "Keeping the books", rows: [
    { label: "Full double-entry ledger", detail: "P&L, balance sheet, trial balance, general ledger, cash flow", ledgerline: ["yes", "Every document posts itself"], balabook: ["yes", "Reports"] },
    { label: "Bank reconciliation", detail: "Statement import, sure matches in one press, bulk coding, part payments", ledgerline: ["yes", "CSV, CAMT.053, OFX"], balabook: ["yes", "Bank reconciliation"] },
    { label: "Cyprus VAT 4 return, box by box", detail: "Due date, reverse charge in boxes 1, 4, 7 and 11B; filing locks the period", ledgerline: ["yes", "Staggered quarters per client"], balabook: ["part", "VIES/OSS listed"] },
    { label: "Sales invoicing", detail: "Products, quantities and discounts; standard, exempt, reverse charge and outside-scope VAT", ledgerline: ["yes", "PDF in the company's own logo and colour"], balabook: ["yes", "Invoicing"] },
    { label: "Credit notes, repeating invoices, statements", detail: "Credit applied or refunded, the VAT return adjusted; reminders for overdue invoices", ledgerline: ["yes", "All posted to the same ledger"], balabook: ["unknown", "Not stated"] },
    { label: "Lock dates enforced by the database", ledgerline: ["yes", "Nothing in a filed period can change"], balabook: ["unknown", "Not stated"] },
  ] },
  { group: "Running a practice", rows: [
    { label: "Practice dashboard across every client", detail: "Next VAT return, bank lines, documents to review, overdue receivables, lock date", ledgerline: ["yes", "One screen"], balabook: ["part", "Multi-company, free accountant access"] },
    { label: "White label the practice owns", ledgerline: ["yes", "Your name and colour; “Powered by Ledgerline”"], balabook: ["part", "Custom practice plan"] },
    { label: "Tamper-evident audit trail", detail: "Every posting chained by SHA-256: a change made behind the app's back shows", ledgerline: ["yes", "Verified on every view"], balabook: ["unknown", "Not stated"] },
    { label: "E-invoicing ready (ViDA, July 2030)", detail: "UBL invoices and credit notes in the Peppol BIS 3.0 structure", ledgerline: ["yes", "Pass the EN 16931 rules today"], balabook: ["unknown", "Not stated"] },
    { label: "VIES statement", detail: "EU sales by customer VAT number, agreeing with box 8B", ledgerline: ["yes", "With the VAT return"], balabook: ["part", "VIES/OSS listed"] },
    { label: "Originals kept with the books", ledgerline: ["yes", "The capture stays with its bill"], balabook: ["unknown", "Not stated"] },
    { label: "CRM in every client, shaped to its business", detail: "Pipeline, customers, jobs and tasks in each company's own words, stages and fields, beside its books", ledgerline: ["yes", "Ten kinds of business; change anything"], balabook: ["unknown", "Not stated"] },
  ] },
];

const PRICES = [
  { name: "Ledgerline", lines: ["Founding practices: early-access terms, agreed with you", "Priced for the practice, not per client company"] },
  { name: "Balabook", lines: ["€19 or €39 a month per company (pricing page; the home page still shows €30 and €50)", "AI credits metered: 300 or 700 a month, top-ups from €8", "Extra user €10 a month · payroll €2 per employee a month", "Custom practice plan, priced on the client book: private deployment, white label"] },
];

function Cell({ mark, text, strong = false }: { mark: Mark; text: string; strong?: boolean }) {
  const Icon = mark === "yes" ? Check : mark === "no" ? X : Minus;
  return <td className={cn("px-3 py-2.5 align-top text-[12px]", strong && "bg-brand-50")}>
    <span className="flex items-start gap-1.5">
      <Icon aria-label={mark === "yes" ? "Yes" : mark === "no" ? "No" : mark === "part" ? "In part" : "Not stated"} className={cn("mt-0.5 size-3.5 shrink-0", mark === "yes" ? "text-positive" : mark === "no" ? "text-critical" : "text-ink-faint")} />
      <span className={cn(mark === "unknown" ? "text-ink-faint" : "text-ink-muted", strong && mark === "yes" && "text-ink")}>{text}</span>
    </span>
  </td>;
}

/** Ledgerline against Balabook. Public information only. */
export default async function ComparePage() {
  const practice = await getPractice();
  const head = "px-3 py-2.5 text-left text-[12.5px] font-semibold";
  return <PageBody width="6xl" className="space-y-4">
    <header className="space-y-1">
      <LedgerlineLockup size="lg" className="mb-2" />
      <h1 className="text-ink text-[22px] leading-tight font-semibold tracking-[-0.015em]">Balabook keeps a book per company. Ledgerline runs the practice.</h1>
      <p className="text-ink-muted max-w-[90ch] text-[13px] leading-relaxed">Full double-entry books, AI capture that routes every document to the right client, a dashboard across the whole client book, Cyprus VAT 4, and a white label {practice.name === "Saltlake Accounting" ? "the practice" : practice.name} owns. Balabook from its public website, checked 20 October 2026.</p>
    </header>
    <section className="ll-panel overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="border-hairline border-b"><tr>
          <th scope="col" className={cn(head, "text-ink-faint w-[40%] text-[11px] tracking-[0.06em] uppercase")}>What a practice needs</th>
          <th scope="col" className={cn(head, "bg-brand-50 text-brand w-[30%]")}>Ledgerline</th>
          <th scope="col" className={cn(head, "text-ink w-[30%]")}>Balabook</th>
        </tr></thead>
        {ROWS.map(group => <tbody key={group.group} className="divide-hairline border-hairline divide-y border-b">
          <tr><th colSpan={3} scope="colgroup" className="text-ink-faint bg-surface-sunken px-3 pt-3 pb-1.5 text-left text-[10.5px] font-semibold tracking-[0.08em] uppercase">{group.group}</th></tr>
          {group.rows.map(row => <tr key={row.label}>
            <th scope="row" className="px-3 py-2.5 text-left align-top"><span className="text-ink block text-[12.5px] font-medium">{row.label}</span>{row.detail ? <span className="text-ink-faint block text-[11.5px] font-normal">{row.detail}</span> : null}</th>
            <Cell mark={row.ledgerline[0]} text={row.ledgerline[1]} strong />
            <Cell mark={row.balabook[0]} text={row.balabook[1]} />
          </tr>)}
        </tbody>)}
      </table>
    </section>
    <div className="grid gap-4 lg:grid-cols-2">
      {PRICES.map(price => <section key={price.name} className={cn("ll-panel px-4 py-3", price.name === "Ledgerline" && "border-brand-200 bg-brand-50")}>
        <h3 className={cn("text-[13px] font-semibold", price.name === "Ledgerline" ? "text-brand" : "text-ink")}>{price.name}</h3>
        <ul className="text-ink-muted mt-1.5 space-y-1 text-[12px] leading-relaxed">{price.lines.map(line => <li key={line}>{line}</li>)}</ul>
      </section>)}
    </div>
    <section className="ll-panel text-ink-muted space-y-1.5 px-4 py-3 text-[12px] leading-relaxed">
      <p><span className="text-ink font-medium">Balabook also lists</span> 30+ currencies, Cyprus payroll, mobile apps, an API and MCP, and AI chat. Built by Factory 39 for Anyscript Ltd, launched October 2024.</p>
      <p><span className="text-ink font-medium">Others in Cyprus:</span> Cybooks, about €29–67 a month on a third-party listing, with Bank of Cyprus, Hellenic and Revolut connections and payroll &ldquo;upcoming&rdquo;; Sumly.cy from €39 a month.</p>
      <p className="text-ink-faint">“Not stated” means the competitor&apos;s public pages did not say, not that the product lacks it.</p>
    </section>
  </PageBody>;
}
