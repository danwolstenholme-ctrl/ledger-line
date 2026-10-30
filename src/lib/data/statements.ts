import "server-only";

import { one, sql } from "@/lib/db";
import { AGEING_BUCKETS, ageingBucket, type AgeingBucketKey } from "@/lib/domain/billing";
import { firmToday } from "@/lib/domain/invoices";
import type { StatementKind, StatementParty, StatementPeriod } from "@/lib/domain/statements";
import { requireOrg } from "@/lib/org";
import type { CustomerRow, SupplierRow } from "@/types/database";
import { logoFor, styleFor } from "./document-styles";

/**
 * A statement of account with a customer or a supplier. Activity: what was
 * owed when the period began, every invoice or bill, payment, credit note
 * and refund in it, in date order with the running balance, and what was
 * owed at its end. Open items: what was still unpaid on that last day, and
 * how late. Everything is as it stood on that day, not as it stands today,
 * so a statement to the end of September reads the same in November; and it
 * agrees with the receivables or payables in the ledger.
 *
 * The balance is what is owed: by the customer to the company, or by the
 * company to the supplier. A charge raises it (an invoice, a bill, money
 * refunded); a settlement lowers it (a payment, a credit note).
 */

export type StatementLine = {
  date: string; kind: StatementKind;
  /** The invoice, bill or credit note it opens: a payment opens what it paid. */
  record_id: string; reference: string;
  /** The invoice or bill a payment or credit note was against, or the credit note a refund was of. */
  against: string | null;
  charged: number; settled: number; due_on: string | null; balance: number;
};
export type OpenItem = { id: string; number: string; issued_on: string; due_on: string | null; total: number; outstanding: number; days_overdue: number };

type Row = Omit<StatementLine, "balance"> & { sort: number };

const CUSTOMER_LINES = `
  select issued_on as date, 'invoice' as kind, id as record_id, number as reference, null::text as against, total as charged, 0 as settled, due_on, 1 as sort
    from invoices where customer_id = $1 and status in ('issued', 'part_paid', 'paid') and issued_on <= $2
  union all
  select t.txn_date, 'refund', n.id, coalesce(t.reference, n.number), n.number, t.amount, 0, null, 2
    from bank_transactions t join credit_notes n on n.id = t.credit_note_id where n.customer_id = $1 and t.txn_date <= $2
  union all
  select issued_on, 'credit_note', id, number, (select number from invoices where id = credit_notes.invoice_id), 0, total, null, 3
    from credit_notes where customer_id = $1 and status = 'issued' and issued_on <= $2
  union all
  select p.received_on, 'payment', i.id, coalesce(p.reference, i.number), i.number, 0, p.amount, null, 4
    from invoice_payments p join invoices i on i.id = p.invoice_id where i.customer_id = $1 and p.received_on <= $2
  order by 1, 9, 4`;

const SUPPLIER_LINES = `
  select issued_on as date, 'bill' as kind, id as record_id, coalesce(number, reference, '') as reference, null::text as against, total as charged, 0 as settled, due_on, 1 as sort
    from bills where supplier_id = $1 and status <> 'void' and issued_on <= $2
  union all
  select t.txn_date, 'supplier_refund', c.id, coalesce(t.reference, c.number, ''), c.number, t.amount, 0, null, 2
    from bank_transactions t join supplier_credits c on c.id = t.supplier_credit_id where c.supplier_id = $1 and t.txn_date <= $2
  union all
  select issued_on, 'supplier_credit', id, coalesce(number, ''), (select number from bills where id = supplier_credits.bill_id), 0, total, null, 3
    from supplier_credits where supplier_id = $1 and status = 'recorded' and issued_on <= $2
  union all
  select p.paid_on, 'bill_payment', b.id, coalesce(p.reference, b.number, ''), b.number, 0, p.amount, null, 4
    from bill_payments p join bills b on b.id = p.bill_id where b.supplier_id = $1 and p.paid_on <= $2
  order by 1, 9, 4`;

// What each invoice or bill still had to pay on the day, after what was paid and credited by then.
const CUSTOMER_OPEN = `
  select * from (
    select i.id, i.number, i.issued_on, i.due_on, i.total,
           i.total - coalesce((select sum(p.amount) from invoice_payments p where p.invoice_id = i.id and p.received_on <= $2), 0)
                   - coalesce((select sum(a.amount) from credit_allocations a where a.invoice_id = i.id and a.allocated_on <= $2), 0) as outstanding
      from invoices i where i.customer_id = $1 and i.status in ('issued', 'part_paid', 'paid') and i.issued_on <= $2) open
   where outstanding > 0 order by issued_on, number`;
const SUPPLIER_OPEN = `
  select * from (
    select b.id, coalesce(b.number, b.reference, '') as number, b.issued_on, b.due_on, b.total,
           b.total - coalesce((select sum(p.amount) from bill_payments p where p.bill_id = b.id and p.paid_on <= $2), 0)
                   - coalesce((select sum(a.amount) from supplier_credit_allocations a where a.bill_id = b.id and a.allocated_on <= $2), 0) as outstanding
      from bills b where b.supplier_id = $1 and b.status <> 'void' and b.issued_on <= $2) open
   where outstanding > 0 order by issued_on, number`;
// Credit not yet set against an invoice or bill, nor refunded, on the day.
const CUSTOMER_UNUSED = `
  select coalesce(sum(n.total - coalesce((select sum(a.amount) from credit_allocations a where a.credit_note_id = n.id and a.allocated_on <= $2), 0)
                              - coalesce((select sum(t.amount) from bank_transactions t where t.credit_note_id = n.id and t.txn_date <= $2), 0)), 0) as unused
    from credit_notes n where n.customer_id = $1 and n.status = 'issued' and n.issued_on <= $2`;
const SUPPLIER_UNUSED = `
  select coalesce(sum(c.total - coalesce((select sum(a.amount) from supplier_credit_allocations a where a.supplier_credit_id = c.id and a.allocated_on <= $2), 0)
                              - coalesce((select sum(t.amount) from bank_transactions t where t.supplier_credit_id = c.id and t.txn_date <= $2), 0)), 0) as unused
    from supplier_credits c where c.supplier_id = $1 and c.status = 'recorded' and c.issued_on <= $2`;

const cents = (value: number | string) => Math.round(Number(value) * 100);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The statement with one customer or supplier, or null when there is no such one in this company. */
export async function getStatement(party: StatementParty, id: string, period: Pick<StatementPeriod, "from" | "to" | "view">) {
  const org = await requireOrg();
  const account = party === "customer"
    ? await one<CustomerRow>("select * from customers where id = $1 and organisation_id = $2", [id, org.id])
    : await one<SupplierRow>("select * from suppliers where id = $1 and organisation_id = $2", [id, org.id]);
  if (!account) return null;
  const { to } = period;
  const [rows, open, unused, logo, style, bank] = await Promise.all([
    sql<Row>(party === "customer" ? CUSTOMER_LINES : SUPPLIER_LINES, [id, to]),
    sql<Omit<OpenItem, "days_overdue">>(party === "customer" ? CUSTOMER_OPEN : SUPPLIER_OPEN, [id, to]),
    one<{ unused: number }>(party === "customer" ? CUSTOMER_UNUSED : SUPPLIER_UNUSED, [id, to]),
    logoFor(org.id),
    styleFor(org.id, party === "customer" ? id : null),
    // How to pay is for a customer: a supplier statement is the company's own record of what it owes.
    party === "customer" ? one<{ name: string; bank_details: string | null }>("select name, bank_details from ledger_accounts where id = $1", [org.default_bank_account_id]) : null,
  ]);
  const from = period.from ?? rows[0]?.date ?? to;
  const opening = rows.filter(row => row.date < from).reduce((sum, row) => sum + cents(row.charged) - cents(row.settled), 0);
  let running = opening, charged = 0, settled = 0;
  const lines: StatementLine[] = rows.filter(row => row.date >= from).map(row => {
    running += cents(row.charged) - cents(row.settled);
    charged += cents(row.charged); settled += cents(row.settled);
    return { date: row.date, kind: row.kind, record_id: row.record_id, reference: row.reference, against: row.against,
      charged: Number(row.charged), settled: Number(row.settled), due_on: row.due_on, balance: running / 100 };
  });
  const ageing = Object.fromEntries(AGEING_BUCKETS.map(bucket => [bucket.key, 0])) as Record<AgeingBucketKey, number>;
  const items: OpenItem[] = open.map(item => {
    const late = item.due_on ? Math.max(0, daysBetween(item.due_on, to)) : 0;
    ageing[ageingBucket(late)] += cents(item.outstanding);
    return { ...item, total: Number(item.total), outstanding: Number(item.outstanding), days_overdue: late };
  });
  for (const bucket of AGEING_BUCKETS) ageing[bucket.key] /= 100;
  const language = party === "customer" ? (account as CustomerRow).document_language ?? org.document_language : org.document_language;
  return {
    org, party, view: period.view, account, from, to, everything: period.from === null,
    opening: opening / 100, lines, closing: running / 100, charged: charged / 100, settled: settled / 100,
    open: items, ageing, overdue: AGEING_BUCKETS.slice(1).reduce((sum, bucket) => sum + ageing[bucket.key], 0),
    unusedCredit: Number(unused?.unused ?? 0), bank, logo, style, language, today: firmToday(),
  };
}
export type StatementData = NonNullable<Awaited<ReturnType<typeof getStatement>>>;
