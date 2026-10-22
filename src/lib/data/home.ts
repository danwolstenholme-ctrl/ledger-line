import "server-only";

import { one, sql } from "@/lib/db";
import { getBankAccounts, getPayablesSummary } from "@/lib/data/accounts";
import { getMyWork } from "@/lib/data/crm";
import { getRepeatingDueCount } from "@/lib/data/sales";
import { addDays } from "@/lib/domain/invoice-math";
import { firmToday } from "@/lib/domain/invoices";
import { nextVatReturn } from "@/lib/domain/vat";
import { requireOrg, getBooksStart } from "@/lib/org";
import { answerView, latestChecks, vatKey } from "@/lib/vies";

/**
 * A company's home: the three figures an owner asks about first, the few
 * things that need doing, and their to-dos. Everything else is a page away.
 */
export async function getCompanyHome() {
  const org = await requireOrg();
  const today = firmToday();
  const [banks, payables, receivables, lateInvoices, billsDue, bankLines, toReview, quotes, drafts, work, filed, repeating, waiting, euCustomers] = await Promise.all([
    getBankAccounts(),
    getPayablesSummary(),
    one<{ owed: number; overdue: number; overdue_count: number }>(`select coalesce(sum(balance), 0) as owed, coalesce(sum(balance) filter (where days_overdue > 0), 0) as overdue,
      count(*) filter (where days_overdue > 0) as overdue_count from v_invoice_directory where organisation_id = $1 and status in ('issued', 'part_paid')`, [org.id]),
    sql<{ id: string; number: string; client_name: string; balance: number; days_overdue: number }>(`select id, number, client_name, balance, days_overdue from v_invoice_directory
      where organisation_id = $1 and status in ('issued', 'part_paid') and days_overdue > 0 order by days_overdue desc limit 3`, [org.id]),
    sql<{ id: string; supplier_name: string; number: string | null; balance: number; days_overdue: number; due_on: string }>(`select id, supplier_name, number, balance, days_overdue, due_on from v_bill_directory
      where organisation_id = $1 and status in ('awaiting_payment', 'part_paid') and due_on is not null and due_on <= $2 order by due_on limit 3`, [org.id, addDays(today, 7)]),
    one<{ count: number; bank_account_id: string | null }>("select count(*) as count, min(bank_account_id::text) as bank_account_id from v_bank_statement_lines where organisation_id = $1 and status in ('unmatched', 'partial')", [org.id]),
    one<{ count: number }>("select count(*) as count from capture_items where organisation_id = $1 and status = 'review'", [org.id]),
    one<{ count: number; total: number }>("select count(*) as count, coalesce(sum(total), 0) as total from quotes where organisation_id = $1 and status = 'sent'", [org.id]),
    one<{ count: number; unsent: number }>("select count(*) filter (where status = 'draft') as count, count(*) filter (where status in ('issued', 'part_paid') and sent_at is null) as unsent from invoices where organisation_id = $1", [org.id]),
    getMyWork(),
    sql<{ period_to: string }>("select period_to from vat_returns where organisation_id = $1 order by period_to", [org.id]),
    getRepeatingDueCount(),
    // Enquiries nobody has answered a day after they arrived.
    one<{ count: number; oldest: string | null }>(`select count(*) as count, min(created_at) as oldest from crm_enquiries e where organisation_id = $1 and stage = 'new'
      and created_at < now() - interval '1 day' and not exists (select 1 from crm_activities a where a.enquiry_id = e.id and a.occurred_at > e.created_at + interval '1 minute')`, [org.id]),
    // EU business customers invoiced in the last six months: each zero-rated sale rests on their VAT number being valid.
    sql<{ id: string; name: string; vat_number: string; country: string }>(`select c.id, c.name, c.vat_number, c.country from customers c
      where c.organisation_id = $1 and c.is_active and c.eu_business and c.vat_number is not null
        and exists (select 1 from invoices i where i.customer_id = c.id and i.issued_on > $2::date - 183) order by c.name`, [org.id, today]),
  ]);
  const checks = await latestChecks(euCustomers.map(customer => vatKey(customer.vat_number, customer.country) ?? ""));
  const unconfirmed = euCustomers.filter(customer => {
    const kept = answerView(checks.get(vatKey(customer.vat_number, customer.country) ?? ""), customer.name);
    return !kept || !kept.valid || kept.stale;
  });
  const active = banks.rows.filter(bank => bank.isActive);
  return {
    org, today,
    cash: { total: active.reduce((sum, bank) => sum + bank.balance, 0), accounts: active.length },
    receivables: { owed: Number(receivables?.owed ?? 0), overdue: Number(receivables?.overdue ?? 0), overdueCount: Number(receivables?.overdue_count ?? 0), late: lateInvoices },
    payables: { ...payables, due: billsDue },
    bankLines: { count: Number(bankLines?.count ?? 0), bankAccountId: bankLines?.bank_account_id ?? org.default_bank_account_id },
    toReview: Number(toReview?.count ?? 0),
    quotes: { count: Number(quotes?.count ?? 0), total: Number(quotes?.total ?? 0) },
    drafts: Number(drafts?.count ?? 0),
    unsent: Number(drafts?.unsent ?? 0),
    repeatingDue: repeating.due,
    waitingEnquiries: { count: Number(waiting?.count ?? 0), oldest: waiting?.oldest ?? null },
    vatUnconfirmed: unconfirmed.map(customer => ({ id: customer.id, name: customer.name })),
    vat: nextVatReturn({ quarterEndMonth: org.vat_quarter_end_month, registered: org.vat_registered, booksFrom: await getBooksStart(org.id), filed: filed.map(row => row.period_to), today }),
    tasks: work.tasks,
  };
}
