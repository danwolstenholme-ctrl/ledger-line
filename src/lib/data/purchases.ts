import "server-only";

import { one, sql } from "@/lib/db";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import type { BillDirectoryRow, LedgerAccountRow, SupplierCreditDirectoryRow, SupplierRow } from "@/types/database";

/**
 * Reads for buying beyond the bill itself: suppliers' credit notes, what is
 * left of them, and bills paid together in a run. Always inside the company
 * the URL names.
 */

export type SupplierCreditLine = { id: string; position: number; description: string; account_id: string; code: string; account_name: string; net: number; vat_rate: number; vat_amount: number };

const banks = (orgId: string) => sql<{ id: string; code: string; name: string }>("select id, code, name from ledger_accounts where organisation_id = $1 and type = 'bank' and is_active order by code", [orgId]);

export async function getSupplierCredits(view: "all" | "unused") {
  const org = await requireOrg();
  const rows = await sql<SupplierCreditDirectoryRow>(`select * from v_supplier_credit_directory where organisation_id = $1 ${view === "unused" ? "and status = 'recorded' and remaining > 0" : ""}
    order by issued_on desc, created_at desc`, [org.id]);
  return { org, rows, unused: rows.filter(row => row.status === "recorded").reduce((sum, row) => sum + Number(row.remaining), 0) };
}

export async function getSupplierCredit(id: string) {
  const org = await requireOrg();
  const credit = await one<SupplierCreditDirectoryRow>("select * from v_supplier_credit_directory where id = $1 and organisation_id = $2", [id, org.id]);
  if (!credit) return null;
  const [lines, allocations, refunds, openBills, bankRows] = await Promise.all([
    sql<SupplierCreditLine>("select l.*, a.code, a.name as account_name from supplier_credit_lines l join ledger_accounts a on a.id = l.account_id where l.supplier_credit_id = $1 order by l.position", [id]),
    sql<{ id: string; bill_id: string; number: string | null; amount: number; allocated_on: string }>(
      "select a.id, a.bill_id, b.number, a.amount, a.allocated_on from supplier_credit_allocations a join bills b on b.id = a.bill_id where a.supplier_credit_id = $1 order by a.allocated_on", [id]),
    sql<{ id: string; txn_date: string; amount: number; bank_name: string; matched: boolean }>(`
      select t.id, t.txn_date, t.amount, a.name as bank_name, exists (select 1 from bank_line_matches m where m.bank_transaction_id = t.id) as matched
        from bank_transactions t join ledger_accounts a on a.id = t.bank_account_id where t.supplier_credit_id = $1 order by t.txn_date`, [id]),
    sql<{ id: string; number: string | null; balance: number; due_on: string | null }>("select id, number, balance, due_on from v_bill_directory where supplier_id = $1 and status in ('awaiting_payment', 'part_paid') order by issued_on", [credit.supplier_id]),
    banks(org.id),
  ]);
  return { org, credit, lines, allocations, refunds, openBills, banks: bankRows, today: firmToday() };
}

/** What a supplier's credit note starts from: the bill it corrects, with its lines and what is left to credit on it. */
export async function getSupplierCreditFormData(billId: string | null) {
  const org = await requireOrg();
  const [suppliers, accounts] = await Promise.all([
    sql<Pick<SupplierRow, "id" | "name" | "default_account_id" | "reverse_charge">>("select id, name, default_account_id, reverse_charge from suppliers where organisation_id = $1 and is_active order by name", [org.id]),
    sql<LedgerAccountRow>("select * from ledger_accounts where organisation_id = $1 and is_active order by code", [org.id]),
  ]);
  const base = { org, suppliers, accounts, today: firmToday() };
  if (!billId || !UUID_PATTERN.test(billId)) return { ...base, bill: null };
  const bill = await one<BillDirectoryRow & { credited_before: number }>(`
    select b.*, coalesce((select sum(total) from supplier_credits c where c.bill_id = b.id and c.status = 'recorded'), 0) as credited_before
      from v_bill_directory b where b.id = $1 and b.organisation_id = $2 and b.status <> 'void'`, [billId, org.id]);
  if (!bill) return { ...base, bill: null };
  const lines = await sql<{ description: string; account_id: string; net: number; vat_rate: number; vat_amount: number }>(
    "select description, account_id, net, vat_rate, vat_amount from bill_lines where bill_id = $1 order by position", [billId]);
  return { ...base, bill: { ...bill, lines } };
}

/** The credit notes against one bill, and credit from elsewhere set against it. */
export async function getBillCredits(billId: string) {
  return sql<{ id: string | null; credit_id: string; number: string | null; amount: number | null; status: string; dated: string }>(`
    select a.id, c.id as credit_id, c.number, a.amount, c.status::text as status, a.allocated_on as dated
      from supplier_credit_allocations a join supplier_credits c on c.id = a.supplier_credit_id where a.bill_id = $1
    union all
    select null, c.id, c.number, null, c.status::text, c.issued_on from supplier_credits c
     where c.bill_id = $1 and not exists (select 1 from supplier_credit_allocations a where a.supplier_credit_id = c.id and a.bill_id = $1)
    order by 6`, [billId]);
}

export async function getSupplierCreditsFor(supplierId: string) {
  const rows = await sql<SupplierCreditDirectoryRow>("select * from v_supplier_credit_directory where supplier_id = $1 order by issued_on desc limit 12", [supplierId]);
  return { rows, unused: rows.filter(row => row.status === "recorded").reduce((sum, row) => sum + Number(row.remaining), 0) };
}

// ---------------------------------------------------------------------------
// Bills paid together
// ---------------------------------------------------------------------------

export async function getPaymentRun(id: string) {
  const org = await requireOrg();
  const run = await one<{ id: string; bank_account_id: string; paid_on: string; reference: string | null; created_at: string; bank_name: string; bank_details: string | null }>(`
    select r.*, a.name as bank_name, a.bank_details from bill_payment_runs r join ledger_accounts a on a.id = r.bank_account_id where r.id = $1 and r.organisation_id = $2`, [id, org.id]);
  if (!run) return null;
  const payments = await sql<{ id: string; bill_id: string; amount: number; reference: string | null; number: string | null; supplier_id: string; supplier_name: string; iban: string | null; bic: string | null; matched: boolean }>(`
    select p.id, p.bill_id, p.amount, p.reference, b.number, s.id as supplier_id, s.name as supplier_name, s.iban, s.bic,
           exists (select 1 from bank_line_matches m where m.bill_payment_id = p.id) as matched
      from bill_payments p join bills b on b.id = p.bill_id join suppliers s on s.id = b.supplier_id
     where p.run_id = $1 order by s.name, b.number`, [id]);
  return { org, run, payments, total: payments.reduce((sum, payment) => sum + Math.round(Number(payment.amount) * 100), 0) / 100 };
}

export async function getPaymentRuns() {
  const org = await requireOrg();
  return sql<{ id: string; paid_on: string; reference: string | null; bank_name: string; count: number; total: number }>(`
    select r.id, r.paid_on, r.reference, a.name as bank_name, count(p.id) as count, coalesce(sum(p.amount), 0) as total
      from bill_payment_runs r join ledger_accounts a on a.id = r.bank_account_id left join bill_payments p on p.run_id = r.id
     where r.organisation_id = $1 group by r.id, a.name order by r.paid_on desc, r.created_at desc limit 20`, [org.id]);
}
