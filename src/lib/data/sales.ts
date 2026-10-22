import "server-only";

import { one, sql } from "@/lib/db";
import { codableAccounts, type PickerAccount } from "@/lib/domain/accounts";
import { addDays } from "@/lib/domain/invoice-math";
import { lineCents } from "@/lib/domain/line-math";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import type { CreditNoteDirectoryRow, CustomerRow, InvoiceDirectoryRow, ItemRow, ItemisedLine, OrganisationRow, RepeatingInvoiceRow, VatTreatment } from "@/types/database";

/**
 * Reads for selling: invoices, quotes, credit notes, products, customers'
 * statements, and what a new document starts from. Always inside the company
 * the URL names.
 */

export type SalesLine = { id: string; position: number; description: string; account_id: string; code: string; account_name: string; net: number; vat_rate: number; vat_amount: number } & ItemisedLine;
export type QuoteDirectoryRow = {
  id: string; organisation_id: string; customer_id: string; number: string; issued_on: string; valid_until: string | null; vat_treatment: InvoiceDirectoryRow["vat_treatment"];
  net: number; vat_amount: number; total: number; status: "draft" | "sent" | "accepted" | "declined"; notes: string | null; invoice_id: string | null; accepted_on: string | null;
  created_at: string; client_name: string; client_vat_number: string | null; client_country: string; invoice_number: string | null; expired: boolean;
};
type SalesKind = "invoice" | "quote" | "credit_note";
const LINES: Record<SalesKind, { table: string; key: string }> = {
  invoice: { table: "invoice_lines", key: "invoice_id" }, quote: { table: "quote_lines", key: "quote_id" }, credit_note: { table: "credit_note_lines", key: "credit_note_id" },
};
const linesOf = (kind: SalesKind, id: string) =>
  sql<SalesLine>(`select l.*, a.code, a.name as account_name from ${LINES[kind].table} l join ledger_accounts a on a.id = l.account_id where l.${LINES[kind].key} = $1 order by position`, [id]);

export const INVOICE_VIEWS = [
  { key: "draft", label: "Drafts" }, { key: "unsent", label: "Not sent" }, { key: "open", label: "To collect" }, { key: "overdue", label: "Overdue" }, { key: "paid", label: "Paid" }, { key: "all", label: "All" },
] as const;
export type InvoiceView = (typeof INVOICE_VIEWS)[number]["key"];

export async function getInvoices(input: { view: InvoiceView; q?: string; customerId?: string | null }) {
  const org = await requireOrg();
  const where = ["organisation_id = $1"], args: unknown[] = [org.id];
  if (input.view === "draft") where.push("status = 'draft'");
  if (input.view === "unsent") where.push("status in ('issued', 'part_paid') and sent_at is null");
  if (input.view === "open") where.push("status in ('issued', 'part_paid')");
  if (input.view === "overdue") where.push("status in ('issued', 'part_paid') and days_overdue > 0");
  if (input.view === "paid") where.push("status = 'paid'");
  if (input.customerId) { args.push(input.customerId); where.push(`customer_id = $${args.length}`); }
  if (input.q?.trim()) { args.push(`%${input.q.trim()}%`); where.push(`(number ilike $${args.length} or client_name ilike $${args.length} or reference ilike $${args.length})`); }
  const [rows, counts, owed, credits] = await Promise.all([
    sql<InvoiceDirectoryRow>(`select * from v_invoice_directory where ${where.join(" and ")} order by issued_on desc, number desc limit 300`, args),
    one<Record<InvoiceView, number>>(`select count(*) filter (where status = 'draft') as draft, count(*) filter (where status in ('issued', 'part_paid') and sent_at is null) as unsent, count(*) filter (where status in ('issued', 'part_paid')) as open,
      count(*) filter (where status in ('issued', 'part_paid') and days_overdue > 0) as overdue, count(*) filter (where status = 'paid') as paid, count(*) as all
      from v_invoice_directory where organisation_id = $1`, [org.id]),
    one<{ owed: number; overdue: number }>("select coalesce(sum(balance), 0) as owed, coalesce(sum(balance) filter (where days_overdue > 0), 0) as overdue from v_invoice_directory where organisation_id = $1 and status in ('issued', 'part_paid')", [org.id]),
    one<{ count: number; repeating: number }>("select (select count(*) from credit_notes where organisation_id = $1) as count, (select count(*) from repeating_invoices where organisation_id = $1) as repeating", [org.id]),
  ]);
  return { org, rows, counts: counts!, owed: Number(owed?.owed ?? 0), overdue: Number(owed?.overdue ?? 0), creditNotes: Number(credits?.count ?? 0), repeating: Number(credits?.repeating ?? 0), today: firmToday() };
}

export async function getInvoice(id: string) {
  const org = await requireOrg();
  const invoice = await one<InvoiceDirectoryRow>("select * from v_invoice_directory where id = $1 and organisation_id = $2", [id, org.id]);
  if (!invoice) return null;
  const [lines, payments, customer, quote, banks, credits] = await Promise.all([
    linesOf("invoice", id),
    sql<{ id: string; received_on: string; amount: number; method: string; reference: string | null; bank_name: string; matched: boolean }>(`
      select p.id, p.received_on, p.amount, p.method, p.reference, a.name as bank_name, exists (select 1 from bank_line_matches m where m.invoice_payment_id = p.id) as matched
        from invoice_payments p join ledger_accounts a on a.id = p.bank_account_id where p.invoice_id = $1 order by p.received_on`, [id]),
    one<CustomerRow>("select * from customers where id = $1", [invoice.customer_id]),
    one<{ id: string; number: string }>("select id, number from quotes where invoice_id = $1", [id]),
    bankOptions(org.id),
    // Credit notes raised against it, and credit from elsewhere set against it.
    sql<{ id: string; credit_note_id: string; number: string; amount: number | null; status: string; issued_on: string; raised_here: boolean }>(`
      select a.id, n.id as credit_note_id, n.number, a.amount, n.status::text as status, a.allocated_on as issued_on, n.invoice_id = $1 as raised_here
        from credit_allocations a join credit_notes n on n.id = a.credit_note_id where a.invoice_id = $1
      union all
      select null, n.id, n.number, null, n.status::text, n.issued_on, true from credit_notes n
       where n.invoice_id = $1 and not exists (select 1 from credit_allocations a where a.credit_note_id = n.id and a.invoice_id = $1)
      order by 6`, [id]),
  ]);
  return { org, invoice, lines, payments, customer, quote, banks, credits, today: firmToday() };
}

export async function getQuotes(view: "open" | "accepted" | "declined" | "all") {
  const org = await requireOrg();
  const filter = view === "open" ? "and status in ('draft', 'sent')" : view === "accepted" ? "and status = 'accepted'" : view === "declined" ? "and status = 'declined'" : "";
  const rows = await sql<QuoteDirectoryRow>(`select * from v_quote_directory where organisation_id = $1 ${filter} order by issued_on desc, number desc`, [org.id]);
  return { org, rows, today: firmToday() };
}

export async function getQuote(id: string) {
  const org = await requireOrg();
  const quote = await one<QuoteDirectoryRow>("select * from v_quote_directory where id = $1 and organisation_id = $2", [id, org.id]);
  if (!quote) return null;
  const [lines, customer] = await Promise.all([linesOf("quote", id), one<CustomerRow>("select * from customers where id = $1", [quote.customer_id])]);
  return { org, quote, lines, customer, today: firmToday() };
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

export async function getCreditNotes(view: "all" | "unused") {
  const org = await requireOrg();
  const rows = await sql<CreditNoteDirectoryRow>(`select * from v_credit_note_directory where organisation_id = $1 ${view === "unused" ? "and status = 'issued' and remaining > 0" : ""}
    order by issued_on desc, number desc`, [org.id]);
  return { org, rows, unused: rows.filter(row => row.status === "issued").reduce((sum, row) => sum + Number(row.remaining), 0) };
}

export async function getCreditNote(id: string) {
  const org = await requireOrg();
  const credit = await one<CreditNoteDirectoryRow>("select * from v_credit_note_directory where id = $1 and organisation_id = $2", [id, org.id]);
  if (!credit) return null;
  const [lines, customer, allocations, refunds, openInvoices, banks] = await Promise.all([
    linesOf("credit_note", id),
    one<CustomerRow>("select * from customers where id = $1", [credit.customer_id]),
    sql<{ id: string; invoice_id: string; number: string; amount: number; allocated_on: string }>(
      "select a.id, a.invoice_id, i.number, a.amount, a.allocated_on from credit_allocations a join invoices i on i.id = a.invoice_id where a.credit_note_id = $1 order by a.allocated_on, i.number", [id]),
    sql<{ id: string; txn_date: string; amount: number; bank_name: string; reference: string | null; matched: boolean }>(`
      select t.id, t.txn_date, t.amount, a.name as bank_name, t.reference, exists (select 1 from bank_line_matches m where m.bank_transaction_id = t.id) as matched
        from bank_transactions t join ledger_accounts a on a.id = t.bank_account_id where t.credit_note_id = $1 order by t.txn_date`, [id]),
    sql<{ id: string; number: string; balance: number; due_on: string | null }>("select id, number, balance, due_on from v_invoice_directory where customer_id = $1 and status in ('issued', 'part_paid') order by issued_on", [credit.customer_id]),
    bankOptions(org.id),
  ]);
  return { org, credit, lines, customer, allocations, refunds, openInvoices, banks, today: firmToday() };
}

/** What a new credit note starts from: the invoice it corrects, with what is left to credit on it. */
export async function getCreditNoteFormData(invoiceId: string | null) {
  const form = await getSalesFormData("credit_note");
  if (!invoiceId || !UUID_PATTERN.test(invoiceId)) return { ...form, invoice: null };
  const invoice = await one<InvoiceDirectoryRow & { credited_before: number }>(`
    select i.*, coalesce((select sum(total) from credit_notes n where n.invoice_id = i.id and n.status = 'issued'), 0) as credited_before
      from v_invoice_directory i where i.id = $1 and i.organisation_id = $2 and i.status in ('issued', 'part_paid', 'paid')`, [invoiceId, form.org.id]);
  if (!invoice) return { ...form, invoice: null };
  return { ...form, invoice: { ...invoice, lines: await linesOf("invoice", invoiceId) } };
}

// ---------------------------------------------------------------------------
// Products and services
// ---------------------------------------------------------------------------

export async function getItems(options: { activeOnly?: boolean } = {}) {
  const org = await requireOrg();
  const rows = await sql<ItemRow & { account_code: string; account_name: string; used: number }>(`
    select i.*, a.code as account_code, a.name as account_name,
           (select count(*) from invoice_lines l where l.item_id = i.id) + (select count(*) from quote_lines l where l.item_id = i.id) as used
      from items i join ledger_accounts a on a.id = i.account_id
     where i.organisation_id = $1 ${options.activeOnly ? "and i.is_active" : ""} order by i.is_active desc, i.name`, [org.id]);
  return { org, rows };
}

export async function getItem(id: string) {
  const org = await requireOrg();
  const item = await one<ItemRow>("select * from items where id = $1 and organisation_id = $2", [id, org.id]);
  if (!item) return null;
  const [sold, accounts] = await Promise.all([
    one<{ lines: number; quantity: number; net: number; last: string | null }>(`
      select count(*) as lines, coalesce(sum(l.quantity), 0) as quantity, coalesce(sum(l.net), 0) as net, max(i.issued_on) as last
        from invoice_lines l join invoices i on i.id = l.invoice_id where l.item_id = $1 and i.status in ('issued', 'part_paid', 'paid')`, [id]),
    incomeAccounts(org.id),
  ]);
  return { org, item, sold: sold!, accounts };
}

async function incomeAccounts(orgId: string) {
  const accounts = await sql<PickerAccount>("select id, code, name, type, system_role from ledger_accounts where organisation_id = $1 and is_active order by code", [orgId]);
  const income = codableAccounts(accounts).filter(account => account.type === "revenue" || account.type === "other_income");
  return income.length ? income : codableAccounts(accounts);
}

async function bankOptions(orgId: string) {
  return sql<{ id: string; code: string; name: string }>("select id, code, name from ledger_accounts where organisation_id = $1 and type = 'bank' and is_active order by code", [orgId]);
}

/** The next number in the company's sequence: the highest this year plus one, never assigned silently. */
export async function suggestNumber(org: OrganisationRow, kind: SalesKind) {
  const year = firmToday().slice(0, 4);
  const prefix = kind === "invoice" ? `${org.invoice_prefix}${year}-` : kind === "quote" ? `${org.invoice_prefix}Q-` : `${org.invoice_prefix}CN-${year}-`;
  const table = kind === "invoice" ? "invoices" : kind === "quote" ? "quotes" : "credit_notes";
  const rows = await sql<{ number: string }>(`select number from ${table} where organisation_id = $1 and number like $2`, [org.id, `${prefix}%`]);
  const highest = rows.reduce((max, row) => Math.max(max, Number(/(\d+)$/.exec(row.number)?.[1] ?? 0)), 0);
  return `${prefix}${String(highest + 1).padStart(kind === "quote" ? 3 : 4, "0")}`;
}

/** What a new invoice, quote or credit note form starts from: customers, income accounts, products, the next number and the terms. */
export async function getSalesFormData(kind: SalesKind) {
  const org = await requireOrg();
  const today = firmToday();
  const [customers, accounts, items, banks, number] = await Promise.all([
    sql<Pick<CustomerRow, "id" | "name" | "vat_number" | "country" | "eu_business" | "default_account_id" | "payment_terms_days">>("select id, name, vat_number, country, eu_business, default_account_id, payment_terms_days from customers where organisation_id = $1 and is_active order by name", [org.id]),
    incomeAccounts(org.id),
    sql<{ id: string; code: string | null; name: string; unit: string | null; unit_price: number; vat_rate: number; account_id: string }>("select id, code, name, unit, unit_price, vat_rate, account_id from items where organisation_id = $1 and is_active order by name", [org.id]),
    bankOptions(org.id),
    suggestNumber(org, kind),
  ]);
  const sales = (await one<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [org.id]))?.id ?? accounts[0]?.id ?? "";
  return { org, customers, accounts, items, banks, salesAccount: sales, number, today, due: addDays(today, org.payment_terms_days) };
}

/** An invoice to start a new one from: the same customer, VAT and lines, a new number and today's date. */
export async function getCopySource(id: string | undefined) {
  if (!id || !UUID_PATTERN.test(id)) return null;
  const org = await requireOrg();
  const invoice = await one<InvoiceDirectoryRow>("select * from v_invoice_directory where id = $1 and organisation_id = $2", [id, org.id]);
  return invoice ? { invoice, lines: await linesOf("invoice", id) } : null;
}

// ---------------------------------------------------------------------------
// Documents for the customer
// ---------------------------------------------------------------------------

/** The company's logo as a PDF takes it: a data URI, or nothing. */
async function logoFor(orgId: string) {
  const logo = await one<{ media_type: string; content: Uint8Array }>("select media_type, content from organisation_logos where organisation_id = $1", [orgId]);
  return logo ? `data:${logo.media_type};base64,${Buffer.from(logo.content).toString("base64")}` : null;
}

/** When the company's logo last changed, as a version for its address; null when it has none. */
export async function logoVersion(orgId: string) {
  const row = await one<{ version: string }>("select (extract(epoch from updated_at) * 1000)::bigint::text as version from organisation_logos where organisation_id = $1", [orgId]);
  return row?.version ?? null;
}

/** Everything the PDF prints about one invoice, quote or credit note. */
export async function getDocumentForPdf(kind: SalesKind, id: string) {
  const org = await requireOrg();
  const view = kind === "invoice" ? "v_invoice_directory" : kind === "quote" ? "v_quote_directory" : "v_credit_note_directory";
  const document = await one<InvoiceDirectoryRow | QuoteDirectoryRow | CreditNoteDirectoryRow>(`select * from ${view} where id = $1 and organisation_id = $2`, [id, org.id]);
  if (!document) return null;
  const [lines, customer, bank, corrects, logo] = await Promise.all([
    linesOf(kind, id),
    one<CustomerRow>("select * from customers where id = $1", [document.customer_id]),
    one<{ name: string; bank_details: string | null }>("select name, bank_details from ledger_accounts where id = $1", [org.default_bank_account_id]),
    kind === "credit_note" && (document as CreditNoteDirectoryRow).invoice_id
      ? one<{ number: string; issued_on: string }>("select number, issued_on from invoices where id = $1", [(document as CreditNoteDirectoryRow).invoice_id]) : null,
    logoFor(org.id),
  ]);
  return { org, kind, document, lines, customer, bank, corrects, logo };
}

export type StatementRow = { date: string; kind: "invoice" | "payment" | "credit_note" | "refund"; reference: string; detail: string; debit: number; credit: number; due_on: string | null };

/**
 * A customer's account for a period: what was owed at its start, every
 * invoice, payment, credit and refund in it, the running balance, and what is
 * owed now by how late it is. It agrees with the receivables in the ledger.
 */
export async function getStatement(customerId: string, from: string, to: string) {
  const org = await requireOrg();
  const customer = await one<CustomerRow>("select * from customers where id = $1 and organisation_id = $2", [customerId, org.id]);
  if (!customer) return null;
  const rows = await sql<StatementRow>(`
    select issued_on as date, 'invoice' as kind, number as reference, 'Invoice' as detail, total as debit, 0 as credit, due_on
      from invoices where customer_id = $1 and status in ('issued', 'part_paid', 'paid') and issued_on <= $2
    union all
    select p.received_on, 'payment', coalesce(p.reference, i.number), 'Payment · ' || i.number, 0, p.amount, null
      from invoice_payments p join invoices i on i.id = p.invoice_id where i.customer_id = $1 and p.received_on <= $2
    union all
    select issued_on, 'credit_note', number, 'Credit note' || coalesce(' · ' || (select number from invoices where id = n.invoice_id), ''), 0, total, null
      from credit_notes n where customer_id = $1 and status = 'issued' and issued_on <= $2
    union all
    select t.txn_date, 'refund', coalesce(t.reference, n.number), 'Refund · ' || n.number, t.amount, 0, null
      from bank_transactions t join credit_notes n on n.id = t.credit_note_id where n.customer_id = $1 and t.txn_date <= $2
    order by 1, 2 desc, 3`, [customerId, to]);
  const cents = (value: number) => Math.round(Number(value) * 100);
  const opening = rows.filter(row => row.date < from).reduce((sum, row) => sum + cents(row.debit) - cents(row.credit), 0);
  let running = opening;
  const lines = rows.filter(row => row.date >= from).map(row => { running += cents(row.debit) - cents(row.credit); return { ...row, balance: running / 100 }; });
  const [ageing, unused] = await Promise.all([
    sql<{ bucket: string; amount: number }>(`
      select case when days_overdue <= 0 then 'current' when days_overdue <= 30 then '1-30' when days_overdue <= 60 then '31-60' when days_overdue <= 90 then '61-90' else '90+' end as bucket,
             sum(balance) as amount
        from v_invoice_directory where customer_id = $1 and status in ('issued', 'part_paid') group by 1`, [customerId]),
    one<{ remaining: number }>("select coalesce(sum(remaining), 0) as remaining from v_credit_note_directory where customer_id = $1 and status = 'issued'", [customerId]),
  ]);
  const [bank, logo] = await Promise.all([one<{ name: string; bank_details: string | null }>("select name, bank_details from ledger_accounts where id = $1", [org.default_bank_account_id]), logoFor(org.id)]);
  return { org, customer, from, to, opening: opening / 100, lines, closing: running / 100, ageing: new Map(ageing.map(row => [row.bucket, Number(row.amount)])), unusedCredit: Number(unused?.remaining ?? 0), bank, logo, today: firmToday() };
}

/** What a payment reminder says: the customer's overdue invoices, who to send it to, and how to pay. */
export async function getReminder(customerId: string) {
  const org = await requireOrg();
  const [customer, contact, overdue, bank, user] = await Promise.all([
    one<CustomerRow>("select * from customers where id = $1 and organisation_id = $2", [customerId, org.id]),
    one<{ name: string; email: string | null }>("select name, email from crm_contacts where customer_id = $1 and email is not null order by name limit 1", [customerId]),
    sql<{ id: string; number: string; issued_on: string; due_on: string; balance: number; days_overdue: number }>("select id, number, issued_on, due_on, balance, days_overdue from v_invoice_directory where customer_id = $1 and status in ('issued', 'part_paid') and days_overdue > 0 order by due_on", [customerId]),
    one<{ name: string; bank_details: string | null }>("select name, bank_details from ledger_accounts where id = $1", [org.default_bank_account_id]),
    one<{ name: string }>("select name from app_users limit 1"),
  ]);
  if (!customer) return null;
  const last = await one<{ occurred_at: string }>("select occurred_at from crm_activities where customer_id = $1 and kind = 'email' and body like 'Payment reminder:%' order by occurred_at desc limit 1", [customerId]);
  return { org, customer, to: customer.email ?? contact?.email ?? "", greeting: contact?.name?.split(" ")[0] ?? null, overdue, bank, sender: org.contact_name ?? user?.name ?? org.name, lastSent: last?.occurred_at ?? null };
}

// ---------------------------------------------------------------------------
// Repeating invoices
// ---------------------------------------------------------------------------

/** What one invoice from a template comes to, worked out as the database will work it out. */
export function templateTotal(lines: Record<string, unknown>[], treatment: VatTreatment, registered: boolean) {
  const charged = treatment === "standard" && registered;
  let net = 0, vat = 0;
  for (const line of lines) {
    if (line.unit_price !== undefined && line.unit_price !== null && line.unit_price !== "") {
      const figures = lineCents({ quantity: String(line.quantity ?? 1), unit_price: String(line.unit_price), discount_pct: String(line.discount_pct ?? 0), vat_rate: charged ? Number(line.vat_rate) : 0 });
      net += figures?.net ?? 0; vat += figures?.vat ?? 0;
    } else {
      net += Math.round(Number(line.net ?? 0) * 100); vat += charged ? Math.round(Number(line.vat_amount ?? 0) * 100) : 0;
    }
  }
  return { net: net / 100, vat: vat / 100, total: (net + vat) / 100 };
}

const isDue = (row: Pick<RepeatingInvoiceRow, "is_active" | "next_on" | "ends_on">, today: string) => row.is_active && row.next_on <= today && (!row.ends_on || row.next_on <= row.ends_on);

export async function getRepeatingInvoices() {
  const org = await requireOrg();
  const today = firmToday();
  const rows = await sql<RepeatingInvoiceRow & { client_name: string; last_number: string | null }>(`
    select r.*, c.name as client_name, i.number as last_number
      from repeating_invoices r join customers c on c.id = r.customer_id left join invoices i on i.id = r.last_invoice_id
     where r.organisation_id = $1 order by r.is_active desc, r.next_on, r.name`, [org.id]);
  return { org, today, rows: rows.map(row => ({ ...row, ...templateTotal(row.lines, row.vat_treatment, org.vat_registered), due: isDue(row, today) })) };
}

export async function getRepeatingInvoice(id: string) {
  const org = await requireOrg();
  const today = firmToday();
  const row = await one<RepeatingInvoiceRow & { client_name: string; payment_terms_days: number | null }>(
    "select r.*, c.name as client_name, c.payment_terms_days from repeating_invoices r join customers c on c.id = r.customer_id where r.id = $1 and r.organisation_id = $2", [id, org.id]);
  if (!row) return null;
  const raised = await sql<InvoiceDirectoryRow>("select * from v_invoice_directory where repeating_id = $1 order by issued_on desc, number desc", [id]);
  return { org, today, row: { ...row, ...templateTotal(row.lines, row.vat_treatment, org.vat_registered), due: isDue(row, today) }, raised };
}

export async function getRepeatingDueCount() {
  const org = await requireOrg();
  const today = firmToday();
  const row = await one<{ due: number; active: number }>(`select count(*) filter (where is_active and next_on <= $2 and (ends_on is null or next_on <= ends_on)) as due,
    count(*) filter (where is_active) as active from repeating_invoices where organisation_id = $1`, [org.id, today]);
  return { due: Number(row?.due ?? 0), active: Number(row?.active ?? 0) };
}
