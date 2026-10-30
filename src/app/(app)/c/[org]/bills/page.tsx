import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { requireOrg } from "@/lib/org";
import { BILL_PAGE_SIZE, getAccountingSettings, getBankAccounts, getBills, getPayablesSummary } from "@/lib/data/accounts";
import { getPaymentRuns } from "@/lib/data/purchases";
import { BILL_STATUS_LABELS, BILL_VIEWS, parseBillView } from "@/lib/domain/accounts";
import { formatAmount } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { PurchasesNav } from "@/components/accounts/accounts-nav";
import { CreateRecordLink, RecordEmpty, RecordFailure, RecordFilterLinks, RecordHeader, RecordPagination, recordOutlineButton } from "@/components/records/record-layout";
import { StatTile } from "@/components/reports/report-charts";
import { BillsTable } from "@/components/purchases/bills-table";

export const metadata: Metadata = { title: "Purchases" };


/** What the company has been invoiced by its suppliers, and what it still owes. */
export default async function BillsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOrg();
  const params = await searchParams;
  const view = parseBillView(params.view);
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(params.page) || 1)));
  const q = typeof params.q === "string" ? params.q : "";
  const [bills, summary, banks, settings, runs] = await Promise.all([getBills({ view, q, page }), getPayablesSummary(), getBankAccounts(), getAccountingSettings(), getPaymentRuns()]);
  const href = (next: { view?: string; page?: number }) => {
    const search = new URLSearchParams();
    const nextView = next.view ?? view;
    if (nextView !== "to_pay") search.set("view", nextView);
    if (q) search.set("q", q);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    return `/accounts/bills${search.size ? `?${search}` : ""}`;
  };

  return <PageBody className="space-y-4">
    <RecordHeader title="Bills" description="Tick bills to pay several at once."
      action={<><Link href="/accounts/supplier-credits" className={recordOutlineButton}>Supplier credits</Link>{runs.length ? <Link href="/accounts/bills/runs" className={recordOutlineButton}>Payment runs</Link> : null}<CreateRecordLink href="/accounts/bills/new">Record a bill</CreateRecordLink></>} />
    <PurchasesNav current="/accounts/bills" />
    {!summary.failed ? <section aria-label="Payables" className="ll-panel divide-hairline grid grid-cols-3 divide-x overflow-hidden">
      <StatTile label="To pay" value={formatAmount(summary.owed)} context={`${summary.count} unpaid bill${summary.count === 1 ? "" : "s"}`} />
      <StatTile label="Overdue" value={formatAmount(summary.overdue)} tone={summary.overdue > 0 ? "critical" : undefined} context={`${summary.overdueCount} bill${summary.overdueCount === 1 ? "" : "s"}`} href="/accounts/bills?view=overdue" />
      <StatTile label="Due in the next week" value={formatAmount(summary.dueThisWeek)} />
    </section> : null}

    <Panel className="overflow-hidden">
      <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <RecordFilterLinks label="Bill views" options={BILL_VIEWS.map(item => ({ label: item.label, href: href({ view: item.key }), active: view === item.key }))} />
        <form action="/accounts/bills" className="flex items-center gap-2">
          {view !== "to_pay" ? <input type="hidden" name="view" value={view} /> : null}
          <input name="q" defaultValue={q} aria-label="Search bills" placeholder="Search supplier, number or reference"
            className="border-hairline-strong bg-surface h-8 w-64 max-w-full rounded-md border px-3 text-[13px] touch:h-11 touch:text-[16px]" />
        </form>
      </div>
      {bills.failed ? <RecordFailure what="the bills" /> : !bills.rows.length ? <RecordEmpty title={q ? "No bills match" : view === "to_pay" ? "Nothing to pay" : "No bills here"}>
        {q ? "Try another search." : "Record a supplier’s invoice when it arrives."}
      </RecordEmpty> : <BillsTable selectable={view === "to_pay" || view === "overdue"} banks={banks.rows.filter(bank => bank.isActive)} defaultBank={settings.settings.default_bank_account_id} today={settings.today}
        rows={bills.rows.map(bill => ({ id: bill.id, supplier_name: bill.supplier_name, number: bill.number, issued_on: bill.issued_on, due_on: bill.due_on, days_overdue: bill.days_overdue,
          total: Number(bill.total), balance: Number(bill.balance), status: bill.status, has_iban: Boolean(bill.supplier_iban),
          // Brought down by a supplier's credit note rather than paid: say so.
          status_label: Number(bill.amount_credited) > 0 && Number(bill.amount_paid) === 0 ? bill.status === "paid" ? "Credited" : "Part credited" : BILL_STATUS_LABELS[bill.status] }))} />}
      {!bills.failed && bills.total > BILL_PAGE_SIZE ? <RecordPagination page={bills.page} total={bills.total} pageSize={BILL_PAGE_SIZE} href={href({})} /> : null}
    </Panel>
  </PageBody>;
}
