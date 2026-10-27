import "server-only";

import { one, sql } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import { lineSignature, reconciliation, type CodedExample, type OpenBill, type OpenInvoice } from "@/lib/domain/bank-statements";
import { toCents } from "@/lib/domain/invoice-math";
import { firmToday } from "@/lib/domain/invoices";
import { AGEING_BUCKETS, ageingBucket, type AgeingBucketKey } from "@/lib/domain/billing";
import type { BankLineStatus, BankStatementImportRow, BankStatementLineViewRow, LedgerAccountRow, LedgerBalanceRow, UnreconciledBankItemRow } from "@/types/database";

/** Reads for reconciling one company's bank account. */

export const LINES_PAGE = 100;
export const RECONCILE_VIEWS = ["to_match", "matched", "set_aside"] as const;
export type ReconcileView = (typeof RECONCILE_VIEWS)[number];

export async function getBankStatementState() {
  const org = await requireOrg();
  const [open, imports] = await Promise.all([
    sql<{ bank_account_id: string; count: number }>("select bank_account_id, count(*) as count from v_bank_lines_unmatched where organisation_id = $1 group by bank_account_id", [org.id]),
    sql<{ bank_account_id: string; imported_at: string }>("select bank_account_id, max(imported_at) as imported_at from bank_statement_imports where organisation_id = $1 group by bank_account_id", [org.id]),
  ]);
  return { toMatch: new Map(open.map(row => [row.bank_account_id, Number(row.count)])), lastImport: new Map(imports.map(row => [row.bank_account_id, row.imported_at])), feeds: new Map<string, { status: string; last_synced_at: string | null }>(), failed: false };
}

export type MatchedDocument = { label: string; href: string | null; amount: number };

export async function getReconcileView(bankAccountId: string, view: ReconcileView, page: number) {
  const org = await requireOrg();
  const today = firmToday();
  const statusFilter = view === "to_match" ? "status in ('unmatched', 'partial')" : view === "matched" ? "status = 'matched'" : "status = 'excluded'";
  const order = view === "to_match" ? "txn_date, created_at, id" : "txn_date desc, id";
  const [account, pageRows, counts, unreconciled, open, balance, imports, stated, range, accounts] = await Promise.all([
    one<LedgerAccountRow>("select * from ledger_accounts where id = $1 and organisation_id = $2", [bankAccountId, org.id]),
    sql<BankStatementLineViewRow & { full_count: number }>(`select *, count(*) over () as full_count from v_bank_statement_lines where bank_account_id = $1 and ${statusFilter} order by ${order} limit ${LINES_PAGE} offset ${(page - 1) * LINES_PAGE}`, [bankAccountId]),
    sql<{ status: BankLineStatus; count: number }>("select status, count(*) as count from v_bank_statement_lines where bank_account_id = $1 group by status", [bankAccountId]),
    sql<UnreconciledBankItemRow>("select * from unreconciled_bank_items($1)", [bankAccountId]),
    sql<{ amount: number; matched_amount: number }>("select amount, matched_amount from v_bank_statement_lines where bank_account_id = $1 and status in ('unmatched', 'partial')", [bankAccountId]),
    sql<LedgerBalanceRow>("select * from ledger_balances($1, $2, $3)", [org.id, today, today]),
    sql<BankStatementImportRow>("select * from bank_statement_imports where bank_account_id = $1 order by imported_at desc limit 8", [bankAccountId]),
    one<{ closing_balance: number; last_date: string }>("select closing_balance, last_date from bank_statement_imports where bank_account_id = $1 and closing_balance is not null and last_date is not null order by last_date desc, imported_at desc limit 1", [bankAccountId]),
    one<{ first: string | null; last: string | null }>("select min(txn_date) as first, max(txn_date) as last from bank_statement_lines where bank_account_id = $1", [bankAccountId]),
    sql<Pick<LedgerAccountRow, "id" | "code" | "name" | "type" | "system_role" | "is_active">>("select id, code, name, type, system_role, is_active from ledger_accounts where organisation_id = $1 and is_active order by code", [org.id]),
  ]);
  const count = (statuses: BankLineStatus[]) => counts.filter(row => statuses.includes(row.status)).reduce((sum, row) => sum + Number(row.count), 0);
  const bankRow = balance.find(row => row.account_id === bankAccountId);
  const bookBalance = bankRow ? (toCents(bankRow.opening) + toCents(bankRow.debit) - toCents(bankRow.credit)) / 100 : 0;
  const from = range?.first ?? null, to = range?.last ?? null;
  const bankBalance = stated && to && stated.last_date >= to ? Number(stated.closing_balance) : null;
  const outstanding = from ? unreconciled.filter(item => item.item_date >= from) : [];
  const summary = reconciliation({
    bookBalance, bankBalance,
    unreconciled: outstanding.map(item => Number(item.amount)),
    unmatchedLines: open.map(row => (toCents(row.amount) - toCents(row.matched_amount)) / 100),
  });
  return {
    account, lines: pageRows, total: pageRows[0]?.full_count ?? 0,
    counts: { to_match: count(["unmatched", "partial"]), matched: count(["matched"]), set_aside: count(["excluded"]) },
    unreconciled, imports, accounts, aiSuggestions: org.ai_suggestions, outstanding,
    summary: { ...summary, bookBalance, bankBalance, from, to }, failed: false,
  };
}

export async function getMatchCandidates() {
  const org = await requireOrg();
  const [invoices, bills, examples] = await Promise.all([
    sql<{ id: string; number: string; client_name: string; balance: number; due_on: string | null }>("select id, number, client_name, balance, due_on from v_invoice_directory where organisation_id = $1 and status in ('issued', 'part_paid') and currency = $2", [org.id, org.currency]),
    sql<{ id: string; number: string | null; supplier_name: string; balance: number; due_on: string | null }>("select id, number, supplier_name, balance, due_on from v_bill_directory where organisation_id = $1 and status in ('awaiting_payment', 'part_paid')", [org.id]),
    // How lines were coded when they were money spent or received: the account of each one's first line.
    sql<{ description: string; counterparty: string | null; kind: "spend" | "receive"; account_id: string; code: string; name: string; vat_rate: number }>(`
      select l.description, l.counterparty, t.kind::text as kind, tl.account_id, a.code, a.name, tl.vat_rate
        from bank_line_matches m
        join bank_statement_lines l on l.id = m.line_id
        join bank_transactions t on t.id = m.bank_transaction_id and t.kind in ('spend', 'receive')
        join bank_transaction_lines tl on tl.transaction_id = t.id and tl.position = 1
        join ledger_accounts a on a.id = tl.account_id
       where m.organisation_id = $1
       order by m.matched_at desc limit 600`, [org.id]),
  ]);
  return {
    invoices: invoices.map((row): OpenInvoice => ({ id: row.id, number: row.number, client: row.client_name ?? "Customer", balance: Number(row.balance), due_on: row.due_on })),
    bills: bills.map((row): OpenBill => ({ id: row.id, number: row.number, supplier: row.supplier_name, balance: Number(row.balance), due_on: row.due_on })),
    examples: examples.map((row): CodedExample => ({ signature: lineSignature(row), kind: row.kind, account_id: row.account_id, account_label: `${row.code} · ${row.name}`, vat_rate: Number(row.vat_rate) })),
    failed: false,
  };
}

export async function getMatchedDocuments(lineIds: string[]) {
  const out = new Map<string, MatchedDocument[]>();
  if (!lineIds.length) return { documents: out, failed: false };
  const rows = await sql<{ line_id: string; bank_account_id: string; kind: string; doc_id: string; label: string; amount: number }>(`
    select m.line_id, m.bank_account_id, 'invoice' as kind, p.invoice_id as doc_id, 'Invoice ' || i.number || ' · ' || c.name as label, p.amount
      from bank_line_matches m join invoice_payments p on p.id = m.invoice_payment_id join invoices i on i.id = p.invoice_id join customers c on c.id = i.customer_id
     where m.line_id = any($1::uuid[])
    union all
    select m.line_id, m.bank_account_id, 'bill', p.bill_id, 'Bill' || coalesce(' ' || b.number, '') || ' · ' || s.name, -p.amount
      from bank_line_matches m join bill_payments p on p.id = m.bill_payment_id join bills b on b.id = p.bill_id join suppliers s on s.id = b.supplier_id
     where m.line_id = any($1::uuid[])
    union all
    select m.line_id, m.bank_account_id, 'bank', t.id,
           case when t.kind = 'transfer' then 'Transfer' when t.kind = 'spend' then 'Spent' else 'Received' end || coalesce(' · ' || t.contact, '') || coalesce(' · ' || a.code || ' ' || a.name, ''),
           case when t.kind = 'spend' or (t.kind = 'transfer' and t.bank_account_id = m.bank_account_id) then -t.amount else t.amount end
      from bank_line_matches m join bank_transactions t on t.id = m.bank_transaction_id
      left join bank_transaction_lines tl on tl.transaction_id = t.id and tl.position = 1
      left join ledger_accounts a on a.id = tl.account_id
     where m.line_id = any($1::uuid[])`, [lineIds]);
  for (const row of rows) {
    const list = out.get(row.line_id) ?? [];
    const href = row.kind === "invoice" ? `/invoices/${row.doc_id}` : row.kind === "bill" ? `/accounts/bills/${row.doc_id}` : `/accounts/bank/transactions/${row.doc_id}`;
    list.push({ label: row.label, href, amount: Number(row.amount) });
    out.set(row.line_id, list);
  }
  return { documents: out, failed: false };
}

export async function getFeedConnection(bankAccountId: string) {
  void bankAccountId;
  return { feed: null, failed: false };
}

/** Open invoices by how late they are, per customer: aged receivables. */
export async function getAgeingReport() {
  const org = await requireOrg();
  const open = await sql<{ customer_id: string; client_name: string; balance: number; days_overdue: number }>(
    "select customer_id, client_name, balance, days_overdue from v_invoice_directory where organisation_id = $1 and status in ('issued', 'part_paid')", [org.id]);
  const empty = () => Object.fromEntries(AGEING_BUCKETS.map(bucket => [bucket.key, 0])) as Record<AgeingBucketKey, number>;
  const totals = empty();
  const clients = new Map<string, { id: string; name: string; buckets: Record<AgeingBucketKey, number>; total: number; count: number; oldest: number }>();
  for (const invoice of open) {
    const late = Math.max(0, Number(invoice.days_overdue) || 0), bucket = ageingBucket(late), amount = toCents(invoice.balance);
    const client = clients.get(invoice.customer_id) ?? { id: invoice.customer_id, name: invoice.client_name, buckets: empty(), total: 0, count: 0, oldest: 0 };
    client.buckets[bucket] += amount; client.total += amount; client.count += 1; client.oldest = Math.max(client.oldest, late);
    clients.set(invoice.customer_id, client);
    totals[bucket] += amount;
  }
  const euros = (record: Record<AgeingBucketKey, number>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value / 100])) as Record<AgeingBucketKey, number>;
  return {
    clients: [...clients.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total).map(client => ({ ...client, buckets: euros(client.buckets), total: client.total / 100 })),
    totals: euros(totals), total: Object.values(totals).reduce((sum, value) => sum + value, 0) / 100, count: open.length, failed: false, today: firmToday(),
  };
}
