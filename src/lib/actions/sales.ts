"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { suggestNumber } from "@/lib/data/sales";
import { EU_COUNTRIES } from "@/lib/domain/countries";
import { euVatNumber } from "@/lib/domain/eu-vat";
import { CREDIT_REASONS } from "@/lib/domain/credit-notes";
import { addDays } from "@/lib/domain/invoice-math";
import { firmToday, validRecordDate } from "@/lib/domain/invoices";
import { normalisedLine } from "@/lib/domain/line-math";
import { getCurrentUser, requireOrg } from "@/lib/org";
import { INVOICE_PAYMENT_METHODS, VAT_RATES, VAT_TREATMENTS } from "@/types/database";
import { regimeOf } from "@/lib/domain/regimes";

/**
 * Writes for selling. Invoices, quotes and credit notes are saved through
 * their database functions, which work out every line again; an issued
 * invoice or credit note posts itself to the ledger, a draft or a quote never
 * does.
 */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => {
  const failure = asDbError(error);
  console.error("[sales] save failed", failure.code);
  return { ok: false, error: describeDbError(failure, fallback) };
};
function date(p: FormParser, name: string, label: string, required = true) {
  const value = p.text(name, { required, max: 10, label });
  if (value && !validRecordDate(value)) p.errors[name] = `${label} is not a valid date.`;
  return value;
}

/**
 * The lines as the database takes them. An itemised line (a unit price) goes
 * as quantity, price and discount, and the database works out its net and
 * VAT; a single amount goes as its net.
 */
type Line = { description: string; account_id: string; item_id: string | null; unit: string | null; vat_rate: number } & ({ quantity: number; unit_price: number; discount_pct: number } | { net: number; vat_amount: number });
function documentLines(p: FormParser, raw: FormDataEntryValue | null): Line[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(typeof raw === "string" ? raw : "[]"); } catch { parsed = null; }
  if (!Array.isArray(parsed)) { p.errors.lines = "Add at least one line."; return null; }
  const lines: Line[] = [];
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  for (const [index, item] of parsed.entries()) {
    const line = item as Record<string, unknown>;
    const description = typeof line.description === "string" ? line.description.trim() : "";
    const rate = Number(line.vat_rate);
    const priced = line.unit_price !== undefined && line.unit_price !== null && String(line.unit_price).trim() !== "";
    // A row left completely empty is not a line.
    if (!description && !priced && !line.net) continue;
    if (!description || !uuid(line.account_id) || !VAT_RATES.includes(rate as (typeof VAT_RATES)[number])) {
      p.errors.lines = `Line ${index + 1} needs a description, an account and an amount.`;
      return null;
    }
    const base = { description: description.slice(0, 300), account_id: uuid(line.account_id)!, item_id: uuid(line.item_id), unit: typeof line.unit === "string" && line.unit.trim() ? line.unit.trim().slice(0, 20) : null, vat_rate: rate };
    if (priced) {
      const figures = normalisedLine({ quantity: String(line.quantity ?? "1"), unit_price: String(line.unit_price), discount_pct: String(line.discount_pct ?? "0"), vat_rate: rate });
      if (!figures || figures.quantity <= 0 || figures.discount_pct >= 100) {
        p.errors.lines = `Line ${index + 1} needs a quantity above zero, a price, and a discount under 100%.`;
        return null;
      }
      lines.push({ ...base, ...figures });
    } else {
      const net = Number(line.net), vat = Number(line.vat_amount ?? 0);
      if (!Number.isFinite(net) || net < 0 || !Number.isFinite(vat)) { p.errors.lines = `Line ${index + 1} needs an amount.`; return null; }
      lines.push({ ...base, net: Math.round(net * 100) / 100, vat_amount: Math.round(vat * 100) / 100 });
    }
  }
  if (!lines.length) { p.errors.lines = "Add at least one line."; return null; }
  return lines;
}

/** The customer chosen, or a new one named on the form and created with the document. */
async function customerFor(orgId: string, p: FormParser) {
  const chosen = p.uuid("customer_id");
  if (chosen) return chosen;
  const name = p.text("new_customer", { max: 200, label: "Customer" });
  if (!name) { p.errors.customer_id = "Choose the customer, or name a new one."; return null; }
  const sales = await one<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [orgId]);
  const existing = await one<{ id: string }>("select id from customers where organisation_id = $1 and lower(btrim(name)) = lower(btrim($2))", [orgId, name]);
  // In the company's own country, as a customer is until it is told otherwise (not the table's Cyprus, for a UK company).
  return existing?.id ?? (await one<{ id: string }>("insert into customers (organisation_id, name, country, default_account_id) values ($1, $2, (select country from organisations where id = $1), $3) returning id", [orgId, name, sales?.id ?? null]))!.id;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export async function saveInvoice(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const intent = form.get("intent") === "issue" ? "issue" : "draft";
  const number = p.text("number", { required: true, max: 60, label: "Invoice number" });
  const issued = date(p, "issued_on", "Invoice date"), due = date(p, "due_on", "Due date", false);
  if (issued && due && due < issued) p.errors.due_on = "The due date cannot be before the invoice date.";
  const treatment = p.enum("vat_treatment", VAT_TREATMENTS, { fallback: "standard" }) ?? "standard";
  const notes = p.text("notes", { max: 2000, label: "Notes" });
  const reference = p.text("reference", { max: 80, label: "Their reference" });
  const lines = documentLines(p, form.get("lines"));
  // Paid on the spot: a card or cash sale, recorded as paid the moment it is issued.
  const paidNow = intent === "issue" && p.boolean("paid_now");
  const paidInto = paidNow ? p.uuid("paid_bank_account_id") : null;
  const paidBy = p.enum("paid_method", INVOICE_PAYMENT_METHODS, { fallback: "card" }) ?? "card";
  if (paidNow && !paidInto) p.errors.paid_bank_account_id = "Choose where the money went.";
  if (paidNow && issued && issued > firmToday()) p.errors.issued_on = "A sale paid on the spot cannot be dated in the future.";
  if (p.failed || !number || !issued || !lines) return p.fail();
  let invoiceId: string;
  try {
    const customer = await customerFor(org.id, p);
    if (!customer) return p.fail();
    invoiceId = await transaction(async run => {
      const saved = (await run<{ id: string }>("select save_invoice($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11) as id",
        [org.id, id, customer, number, issued, due, treatment, notes, JSON.stringify(lines), intent === "issue" ? "issued" : "draft", reference]))[0].id;
      if (id && intent === "issue") await run("update invoices set status = 'issued' where id = $1 and status = 'draft'", [saved]);
      if (paidNow && paidInto) {
        await run(`insert into invoice_payments (organisation_id, invoice_id, received_on, amount, bank_account_id, method, reference)
                   select organisation_id, id, issued_on, total, $2, $3, number from invoices where id = $1 and total > 0`, [saved, paidInto, paidBy]);
      }
      return saved;
    });
  } catch (error) { return fail(error, "The invoice could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/sales/${invoiceId}${intent === "issue" ? "?issued=1" : ""}`);
}

export async function setInvoiceStatus(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const to = p.enum("to", ["issued", "void", "draft"] as const, { required: true, label: "Status" });
  if (!id || !to) return { ok: false, error: "That invoice is no longer available." };
  try {
    const from = to === "issued" ? ["draft", "void"] : to === "void" ? ["draft", "issued"] : ["issued"];
    const changed = await sql("update invoices set status = $3 where id = $1 and organisation_id = $2 and amount_paid = 0 and amount_credited = 0 and status::text = any($4::text[]) returning id", [id, org.id, to, from]);
    if (!changed.length) return { ok: false, error: to === "void" ? "Only an invoice with nothing paid or credited against it can be voided. Raise a credit note instead." : "That change is not possible for this invoice." };
  } catch (error) { return fail(error, "The invoice could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function deleteDraftInvoice(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  await sql("delete from invoices where id = $1 and organisation_id = $2 and status = 'draft'", [id, org.id]);
  refresh();
  redirect(`/c/${org.slug}/sales?view=draft`);
}

export async function recordInvoicePayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const invoice = p.uuid("invoice_id"), bank = p.uuid("bank_account_id");
  const received = date(p, "received_on", "Date received");
  const amount = p.money("amount", "Amount received");
  if (!amount) p.errors.amount = "Enter the amount received.";
  if (!bank) p.errors.bank_account_id = "Choose the bank account it went into.";
  const method = p.enum("method", INVOICE_PAYMENT_METHODS, { fallback: "bank_transfer" }) ?? "bank_transfer";
  if (p.failed || !invoice || !bank || !received || !amount) return p.fail();
  try {
    await sql("insert into invoice_payments (organisation_id, invoice_id, received_on, amount, bank_account_id, method, reference) values ($1, $2, $3, $4, $5, $6, $7)",
      [org.id, invoice, received, amount, bank, method, p.text("reference", { max: 120 })]);
  } catch (error) { return fail(error, "The payment could not be recorded."); }
  refresh();
  return { ok: true, error: null };
}

export async function removeInvoicePayment(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  try { await sql("delete from invoice_payments where id = $1 and organisation_id = $2", [id, org.id]); }
  catch (error) { console.error("[sales] payment removal failed", asDbError(error).code); }
  refresh();
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export async function saveQuote(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const intent = form.get("intent") === "send" ? "send" : "draft";
  const number = p.text("number", { required: true, max: 60, label: "Quote number" });
  const issued = date(p, "issued_on", "Quote date"), until = date(p, "due_on", "Valid until", false);
  if (issued && until && until < issued) p.errors.due_on = "A quote cannot expire before its date.";
  const treatment = p.enum("vat_treatment", VAT_TREATMENTS, { fallback: "standard" }) ?? "standard";
  const lines = documentLines(p, form.get("lines"));
  if (p.failed || !number || !issued || !lines) return p.fail();
  let quoteId: string;
  try {
    const customer = await customerFor(org.id, p);
    if (!customer) return p.fail();
    quoteId = (await one<{ id: string }>("select save_quote($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) as id",
      [org.id, id, customer, number, issued, until, treatment, p.text("notes", { max: 2000 }), JSON.stringify(lines)]))!.id;
    if (intent === "send") await sql("update quotes set status = 'sent' where id = $1 and status = 'draft'", [quoteId]);
  } catch (error) { return fail(error, "The quote could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/quotes/${quoteId}`);
}

export async function setQuoteStatus(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const to = p.enum("to", ["draft", "sent", "declined"] as const, { required: true, label: "Status" });
  if (!id || !to) return { ok: false, error: "That quote is no longer available." };
  const changed = await sql("update quotes set status = $3 where id = $1 and organisation_id = $2 and status <> 'accepted' returning id", [id, org.id, to]);
  if (!changed.length) return { ok: false, error: "An accepted quote cannot change: its invoice exists." };
  refresh();
  return { ok: true, error: null };
}

/** The customer said yes: the invoice is raised from the quote's lines, issued today on the company's terms. */
export async function acceptQuote(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return { ok: false, error: "That quote is no longer available." };
  let invoice: string;
  try {
    const today = firmToday();
    const terms = (await one<{ days: number | null }>("select c.payment_terms_days as days from quotes q join customers c on c.id = q.customer_id where q.id = $1 and q.organisation_id = $2", [id, org.id]))?.days;
    invoice = (await one<{ id: string }>("select accept_quote($1, $2, $3, $4) as id", [id, await suggestNumber(org, "invoice"), today, addDays(today, terms ?? org.payment_terms_days)]))!.id;
  } catch (error) { return fail(error, "The quote could not be accepted."); }
  refresh();
  redirect(`/c/${org.slug}/sales/${invoice}?issued=1`);
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

export async function saveCreditNote(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const intent = form.get("intent") === "issue" ? "issue" : "draft";
  const invoice = p.uuid("invoice_id");
  const number = p.text("number", { required: true, max: 60, label: "Credit note number" });
  const issued = date(p, "issued_on", "Date");
  const reason = p.enum("reason", CREDIT_REASONS, { required: true, label: "Reason" });
  const treatment = p.enum("vat_treatment", VAT_TREATMENTS, { fallback: "standard" }) ?? "standard";
  const lines = documentLines(p, form.get("lines"));
  if (p.failed || !number || !issued || !reason || !lines) return p.fail();
  let creditId: string;
  try {
    const customer = await customerFor(org.id, p);
    if (!customer) return p.fail();
    creditId = await transaction(async run => {
      const saved = (await run<{ id: string }>("select save_credit_note($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) as id",
        [org.id, id, customer, invoice, number, issued, treatment, reason, p.text("notes", { max: 2000 }), JSON.stringify(lines), id ? "draft" : intent === "issue" ? "issued" : "draft"]))[0].id;
      if (id && intent === "issue") await run("select issue_credit_note($1)", [saved]);
      return saved;
    });
  } catch (error) { return fail(error, "The credit note could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/credit-notes/${creditId}${intent === "issue" ? "?issued=1" : ""}`);
}

export async function issueCreditNote(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id || !(await one("select 1 from credit_notes where id = $1 and organisation_id = $2", [id, org.id]))) return { ok: false, error: "That credit note is no longer available." };
  try { await sql("select issue_credit_note($1)", [id]); }
  catch (error) { return fail(error, "The credit note could not be issued."); }
  refresh();
  return { ok: true, error: null };
}

export async function setCreditNoteVoid(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  if (!id || !(await one("select 1 from credit_notes where id = $1 and organisation_id = $2", [id, org.id]))) return { ok: false, error: "That credit note is no longer available." };
  try { await sql("select set_credit_note_void($1, $2)", [id, p.boolean("void")]); }
  catch (error) { return fail(error, "The credit note could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function deleteDraftCreditNote(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  await sql("delete from credit_notes where id = $1 and organisation_id = $2 and status = 'draft'", [id, org.id]);
  refresh();
  redirect(`/c/${org.slug}/credit-notes`);
}

/** Set some of a credit against another of the customer's invoices. */
export async function allocateCredit(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const credit = p.uuid("credit_note_id"), invoice = p.uuid("invoice_id");
  const amount = p.money("amount", "Amount");
  if (!invoice) p.errors.invoice_id = "Choose the invoice.";
  if (!amount) p.errors.amount = "Enter the amount to set against it.";
  if (p.failed || !credit || !invoice || !amount) return p.fail();
  try {
    await sql(`insert into credit_allocations (organisation_id, credit_note_id, invoice_id, amount, allocated_on)
               select $1, $2, $3, $4, $5 where exists (select 1 from credit_notes where id = $2 and organisation_id = $1)`, [org.id, credit, invoice, amount, firmToday()]);
  } catch (error) { return fail(error, "The credit could not be set against that invoice."); }
  refresh();
  return { ok: true, error: null };
}

export async function removeAllocation(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  try { await sql("delete from credit_allocations where id = $1 and organisation_id = $2", [id, org.id]); }
  catch (error) { console.error("[sales] allocation removal failed", asDbError(error).code); }
  refresh();
}

/** Pay the credit back: money spent from the bank against the customer's account. */
export async function refundCredit(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const credit = p.uuid("credit_note_id"), bank = p.uuid("bank_account_id");
  const refunded = date(p, "refunded_on", "Date refunded");
  const amount = p.money("amount", "Amount refunded");
  if (!amount) p.errors.amount = "Enter the amount refunded.";
  if (!bank) p.errors.bank_account_id = "Choose the bank account it was paid from.";
  if (refunded && refunded > firmToday()) p.errors.refunded_on = "A refund cannot be dated in the future.";
  if (p.failed || !credit || !bank || !refunded || !amount) return p.fail();
  try {
    await sql(`insert into bank_transactions (organisation_id, kind, bank_account_id, txn_date, contact, reference, amount, net, credit_note_id)
               select n.organisation_id, 'spend', $3, $4, c.name, coalesce(nullif($6, ''), 'Refund · ' || n.number), $5, $5, n.id
                 from credit_notes n join customers c on c.id = n.customer_id where n.id = $2 and n.organisation_id = $1`,
      [org.id, credit, bank, refunded, amount, p.text("reference", { max: 120 }) ?? ""]);
  } catch (error) { return fail(error, "The refund could not be recorded."); }
  refresh();
  return { ok: true, error: null };
}

export async function removeRefund(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  try { await sql("delete from bank_transactions where id = $1 and organisation_id = $2 and credit_note_id is not null", [id, org.id]); }
  catch (error) { console.error("[sales] refund removal failed", asDbError(error).code); }
  refresh();
}

// ---------------------------------------------------------------------------
// Products and services
// ---------------------------------------------------------------------------

export async function saveItem(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const name = p.text("name", { required: true, max: 200, label: "Name" });
  const code = p.text("code", { max: 40, label: "Code" })?.toUpperCase() ?? null;
  const unit = p.text("unit", { max: 20, label: "Unit" });
  const price = normalisedLine({ quantity: "1", unit_price: String(form.get("unit_price") ?? ""), vat_rate: 0 })?.unit_price;
  if (price === undefined) p.errors.unit_price = "Enter the price before VAT, e.g. 18.50.";
  const rate = Number(form.get("vat_rate"));
  const rates = regimeOf(org.country).vatRates;
  if (!rates.includes(rate)) p.errors.vat_rate = `Choose one of the company’s VAT rates: ${rates.slice(0, -1).join("%, ")}% or ${rates.at(-1)}%.`;
  const account = p.uuid("account_id");
  if (!account) p.errors.account_id = "Choose the income account it is sold to.";
  if (p.failed || !name || price === undefined || !account) return p.fail();
  const income = await one("select 1 from ledger_accounts where id = $1 and organisation_id = $2 and type in ('revenue', 'other_income') and is_active", [account, org.id]);
  if (!income) return { ok: false, error: "Choose an income account.", fieldErrors: { account_id: "Choose an income account." } };
  let saved = id;
  try {
    if (id) {
      await sql("update items set name = $3, code = $4, unit = $5, unit_price = $6, vat_rate = $7, account_id = $8, description = $9 where id = $1 and organisation_id = $2",
        [id, org.id, name, code, unit, price, rate, account, p.text("description", { max: 500 })]);
    } else {
      saved = (await one<{ id: string }>("insert into items (organisation_id, name, code, unit, unit_price, vat_rate, account_id, description) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
        [org.id, name, code, unit, price, rate, account, p.text("description", { max: 500 })]))!.id;
    }
  } catch (error) { return fail(error, "The product could not be saved."); }
  refresh();
  if (!id) redirect(`/c/${org.slug}/items?added=${saved}`);
  return { ok: true, error: null };
}

export async function setItemActive(form: FormData): Promise<void> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  if (!id) return;
  try { await sql("update items set is_active = $3 where id = $1 and organisation_id = $2", [id, org.id, p.boolean("active")]); }
  catch (error) { console.error("[sales] product change failed", asDbError(error).code); }
  refresh();
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function saveCustomer(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const name = p.text("name", { required: true, max: 200, label: "Customer name" });
  const email = p.email("email"), phone = p.text("phone", { max: 40, label: "Phone" });
  let vat = p.text("vat_number", { max: 40, label: "VAT number" })?.toUpperCase().replace(/\s+/g, "") ?? null;
  const country = (p.text("country", { max: 2, label: "Country" }) ?? "CY").toUpperCase();
  const address = p.text("address", { max: 500, label: "Address" });
  const typedVat = euVatNumber(vat, country);
  if (typedVat.problem) p.errors.vat_number = typedVat.problem;
  else vat = typedVat.value;
  const eu = country !== "CY" && EU_COUNTRIES.has(country) && Boolean(vat) && p.boolean("eu_business");
  if (eu && vat?.startsWith("CY")) p.errors.vat_number = "A sale to a Cyprus VAT number isn’t an EU sale: give the customer’s VAT number in its own member state.";
  const termsText = p.text("payment_terms_days", { max: 3, label: "Payment terms" });
  const terms = termsText === null ? null : Number(termsText);
  if (terms !== null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) p.errors.payment_terms_days = "Between 0 and 365 days, or empty for the company's terms.";
  // Empty: the company's own language for its documents.
  const language = p.enum("document_language", ["en", "el", "en+el"] as const, { label: "Documents in" });
  // Empty: the company's default style. A style of another company's is refused by the database.
  const style = p.uuid("document_style_id");
  if (p.failed || !name) return p.fail();
  let saved = id;
  try {
    if (id) {
      // The style only when the form had its choice: with one style there is none to make, and what was chosen stays.
      await sql(`update customers set name = $3, email = $4, phone = $5, vat_number = $6, country = $7, address = $8, eu_business = $9, payment_terms_days = $10, document_language = $11,
          document_style_id = case when $13 then $12::uuid else document_style_id end where id = $1 and organisation_id = $2`,
        [id, org.id, name, email, phone, vat, country, address, eu, terms, language, style, form.has("document_style_id")]);
    } else {
      const sales = await one<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [org.id]);
      saved = (await one<{ id: string }>("insert into customers (organisation_id, name, email, phone, vat_number, country, address, eu_business, default_account_id, payment_terms_days, document_language, document_style_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id",
        [org.id, name, email, phone, vat, country, address, eu, sales?.id ?? null, terms, language, style]))!.id;
    }
  } catch (error) { return fail(error, "The customer could not be saved."); }
  refresh();
  if (!id) redirect(`/c/${org.slug}/customers/${saved}`);
  return { ok: true, error: null, notice: "Saved." };
}

/** A payment reminder opened in the person's own email: logged on the customer's timeline. */
export async function logReminder(customerId: string, summary: string): Promise<void> {
  const org = await requireOrg();
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return;
  const user = await getCurrentUser();
  await sql(`insert into crm_activities (organisation_id, customer_id, kind, body, actor)
             select $1, id, 'email', $3, $4 from customers where id = $2 and organisation_id = $1`, [org.id, customerId, `Payment reminder: ${summary}`.slice(0, 1000), user.name]);
  refresh();
}

// ---------------------------------------------------------------------------
// Invoice settings
// ---------------------------------------------------------------------------

/** How this company numbers its invoices and quotes, and the days it gives customers to pay. */
export async function saveInvoiceSettings(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const prefix = p.text("invoice_prefix", { required: true, max: 12, label: "Number prefix" })?.toUpperCase() ?? null;
  if (prefix && !/^[A-Z0-9][A-Z0-9/-]*$/.test(prefix)) p.errors.invoice_prefix = "Letters, numbers, hyphens and slashes only, e.g. LRC-.";
  const terms = Number(form.get("payment_terms_days"));
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) p.errors.payment_terms_days = "Between 0 and 365 days.";
  if (p.failed || !prefix) return p.fail();
  try { await sql("update organisations set invoice_prefix = $2, payment_terms_days = $3 where id = $1", [org.id, prefix, terms]); }
  catch (error) { return fail(error, "The invoice settings could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// Repeating invoices
// ---------------------------------------------------------------------------

const EVERY = [1, 2, 3, 6, 12] as const;

function schedule(p: FormParser, form: FormData) {
  const name = p.text("name", { required: true, max: 120, label: "Name" });
  const every = Number(form.get("every_months"));
  if (!EVERY.includes(every as (typeof EVERY)[number])) p.errors.every_months = "Choose how often.";
  const next = date(p, "next_on", "Next invoice date");
  const ends = date(p, "ends_on", "Last invoice date", false);
  if (next && ends && ends < next) p.errors.ends_on = "The last date cannot be before the next one.";
  const issue = form.get("issue") !== "draft";
  return { name, every, next, ends, issue };
}

/** Start raising this invoice again every month, quarter or year: its customer, VAT and lines, on the dates chosen. */
export async function startRepeating(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const invoiceId = p.uuid("invoice_id");
  const { name, every, next, ends, issue } = schedule(p, form);
  if (next && next < firmToday()) p.errors.next_on = "The next invoice cannot be dated in the past.";
  if (p.failed || !invoiceId || !name || !next) return p.fail();
  const invoice = await one<{ customer_id: string; vat_treatment: string; notes: string | null }>("select customer_id, vat_treatment, notes from invoices where id = $1 and organisation_id = $2 and status <> 'void'", [invoiceId, org.id]);
  if (!invoice) return { ok: false, error: "That invoice is no longer available." };
  const lines = await sql<{ description: string; account_id: string; item_id: string | null; unit: string | null; quantity: number; unit_price: number | null; discount_pct: number; net: number; vat_rate: number; vat_amount: number }>(
    "select description, account_id, item_id, unit, quantity, unit_price, discount_pct, net, vat_rate, vat_amount from invoice_lines where invoice_id = $1 order by position", [invoiceId]);
  // Each line as save_invoice takes it: itemised as quantity and price, or a single amount.
  const template = lines.map(line => line.unit_price === null
    ? { description: line.description, account_id: line.account_id, item_id: line.item_id, unit: line.unit, net: Number(line.net), vat_rate: Number(line.vat_rate), vat_amount: Number(line.vat_amount) }
    : { description: line.description, account_id: line.account_id, item_id: line.item_id, unit: line.unit, quantity: Number(line.quantity), unit_price: Number(line.unit_price), discount_pct: Number(line.discount_pct), vat_rate: Number(line.vat_rate) });
  let id: string;
  try {
    id = (await one<{ id: string }>(`insert into repeating_invoices (organisation_id, customer_id, name, every_months, day_of_month, next_on, ends_on, issue, vat_treatment, notes, lines)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) returning id`,
      [org.id, invoice.customer_id, name, every, Number(next.slice(8, 10)), next, ends, issue, invoice.vat_treatment, invoice.notes, JSON.stringify(template)]))!.id;
  } catch (error) { return fail(error, "The repeating invoice could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/repeating/${id}?started=1`);
}

export async function updateRepeating(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const { name, every, next, ends, issue } = schedule(p, form);
  if (p.failed || !id || !name || !next) return p.fail();
  try {
    await sql(`update repeating_invoices set name = $3, every_months = $4, day_of_month = $5, next_on = $6, ends_on = $7, issue = $8,
                 is_active = case when $7::date is not null and $6::date > $7::date then false else is_active end where id = $1 and organisation_id = $2`,
      [id, org.id, name, every, Number(next.slice(8, 10)), next, ends, issue]);
  } catch (error) { return fail(error, "The repeating invoice could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

export async function setRepeatingActive(form: FormData): Promise<void> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  if (!id) return;
  try { await sql("update repeating_invoices set is_active = $3 where id = $1 and organisation_id = $2 and ($3 = false or ends_on is null or next_on <= ends_on)", [id, org.id, p.boolean("active")]); }
  catch (error) { console.error("[sales] repeating change failed", asDbError(error).code); }
  refresh();
}

export async function deleteRepeating(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  await sql("delete from repeating_invoices where id = $1 and organisation_id = $2", [id, org.id]);
  refresh();
  redirect(`/c/${org.slug}/repeating`);
}

/**
 * Raise every invoice that has come due, oldest first: a schedule a month
 * behind raises each month it missed, each on its own date and number.
 */
export async function raiseDueRepeating(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const only = new FormParser(form).uuid("id");
  // Back to the page the button was on, which says what was raised: the button itself goes once nothing is due.
  const back = `/c/${org.slug}/repeating${only ? `/${only}` : ""}`;
  const today = firmToday();
  const due = await sql<{ id: string; name: string }>(`select id, name from repeating_invoices where organisation_id = $1 and is_active and next_on <= $2
    and (ends_on is null or next_on <= ends_on) ${only ? "and id = $3" : ""} order by next_on, name`, only ? [org.id, today, only] : [org.id, today]);
  const raised: string[] = [];
  let problem: string | null = null;
  for (const schedule of due) {
    for (let count = 0; count < 24; count++) {
      const still = await one("select 1 from repeating_invoices where id = $1 and is_active and next_on <= $2 and (ends_on is null or next_on <= ends_on)", [schedule.id, today]);
      if (!still) break;
      const number = await suggestNumber(org, "invoice");
      try {
        await one("select raise_repeating_invoice($1, $2, $3)", [schedule.id, number, today]);
        raised.push(number);
      } catch (error) {
        problem = `${schedule.name}: ${describeDbError(asDbError(error), "it could not be raised.")}`;
        break;
      }
    }
  }
  refresh();
  if (!raised.length) return { ok: !problem, error: problem ?? null, notice: problem ? undefined : "Nothing is due." };
  redirect(`${back}?raised=${encodeURIComponent(raised.join(","))}${problem ? `&problem=${encodeURIComponent(problem)}` : ""}`);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** An invoice sent from the person's own email: recorded on the invoice and on the customer's timeline. */
export async function markInvoiceSent(invoiceId: string, to: string): Promise<void> {
  const org = await requireOrg();
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return;
  const user = await getCurrentUser();
  const recipient = to.trim().slice(0, 320) || null;
  const invoice = await one<{ customer_id: string; number: string }>(
    "update invoices set sent_at = now(), sent_to = $3 where id = $1 and organisation_id = $2 and status in ('issued', 'part_paid', 'paid') returning customer_id, number", [invoiceId, org.id, recipient]);
  if (invoice) await sql("insert into crm_activities (organisation_id, customer_id, kind, body, actor) values ($1, $2, 'email', $3, $4)",
    [org.id, invoice.customer_id, `Invoice ${invoice.number} sent${recipient ? ` to ${recipient}` : ""}.`, user.name]);
  refresh();
}
