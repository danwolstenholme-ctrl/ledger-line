"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { getUkVatFigures, getVatReport, ukSchemeOf } from "@/lib/data/accounts";
import { vatBoxes } from "@/lib/domain/accounts";
import { ukVatReturn } from "@/lib/domain/vat-uk";
import { euVatNumber } from "@/lib/domain/eu-vat";
import { FormParser, describeDbError, reverseChargeKind, type ActionState } from "@/lib/actions/form";
import { compactIban, validBic, validIban } from "@/lib/domain/iban";
import { validRecordDate } from "@/lib/domain/invoices";
import { orgPath, requireOrg } from "@/lib/org";
import { BANK_TRANSACTION_KINDS, INVOICE_PAYMENT_METHODS, LEDGER_ACCOUNT_TYPES, VAT_RATES } from "@/types/database";

/**
 * Writes to one company's books. Each parses the form and hands the document
 * to the database's own function for it, which checks it again and posts it.
 * Nothing here writes a ledger line.
 */

function refresh() { revalidatePath("/", "layout"); }
function dbFailure(error: unknown, fallback: string): ActionState {
  const failure = asDbError(error);
  console.error("[accounts] save failed", failure.code);
  return { ok: false, error: describeDbError(failure, fallback) };
}
function date(p: FormParser, name: string, label: string, required = true) {
  const value = p.text(name, { required, max: 10, label });
  if (value && !validRecordDate(value)) p.errors[name] = `${label} is not a valid date.`;
  return value;
}

type LineInput = { description: string; account_id: string; net: number; vat_rate: number; vat_amount: number };

function documentLines(p: FormParser, raw: FormDataEntryValue | null): LineInput[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(typeof raw === "string" ? raw : "[]"); } catch { parsed = null; }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 200) { p.errors.lines = "Add at least one line."; return null; }
  const lines: LineInput[] = [];
  for (const [index, item] of parsed.entries()) {
    const line = item as Record<string, unknown>;
    const description = typeof line.description === "string" ? line.description.trim() : "";
    const account = typeof line.account_id === "string" ? line.account_id : "";
    const net = Number(line.net), rate = Number(line.vat_rate), vat = Number(line.vat_amount);
    if (!description || !account || !Number.isFinite(net) || net < 0 || !VAT_RATES.includes(rate as (typeof VAT_RATES)[number]) || !Number.isFinite(vat) || vat < 0) {
      p.errors.lines = `Line ${index + 1} needs a description, an account, an amount and a VAT rate.`;
      return null;
    }
    lines.push({ description: description.slice(0, 300), account_id: account, net: Math.round(net * 100) / 100, vat_rate: rate, vat_amount: Math.round(vat * 100) / 100 });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function saveSupplier(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const name = p.text("name", { required: true, max: 200, label: "Supplier name" }) ?? "";
  const email = p.email("email"), phone = p.text("phone", { max: 40, label: "Phone" });
  const typedVat = euVatNumber(p.text("vat_number", { max: 40, label: "VAT number" }), id ? (await one<{ country: string }>("select country from suppliers where id = $1 and organisation_id = $2", [id, org.id]))?.country : null);
  if (typedVat.problem) p.errors.vat_number = typedVat.problem;
  const vat = typedVat.value;
  const account = p.uuid("default_account_id"), notes = p.text("notes", { max: 2000, label: "Notes" }), rc = p.boolean("reverse_charge");
  const ibanText = p.text("iban", { max: 42, label: "IBAN" }), bicText = p.text("bic", { max: 11, label: "BIC" });
  const iban = ibanText ? compactIban(ibanText) : null, bic = bicText ? bicText.replace(/\s+/g, "").toUpperCase() : null;
  if (iban && !validIban(iban)) p.errors.iban = "That IBAN does not check out: look at it against the supplier's invoice.";
  if (bic && !validBic(bic)) p.errors.bic = "A BIC is 8 or 11 letters and digits, e.g. BCYPCY2N.";
  if (p.failed) return p.fail();
  let savedId: string | null = id;
  try {
    if (id) await sql("update suppliers set name = $3, email = $4, phone = $5, vat_number = $6, default_account_id = $7, notes = $8, reverse_charge = $9, iban = $10, bic = $11, updated_at = now() where id = $1 and organisation_id = $2",
      [id, org.id, name, email, phone, vat, account, notes, rc, iban, bic]);
    else savedId = (await one<{ id: string }>("insert into suppliers (organisation_id, name, email, phone, vat_number, default_account_id, notes, reverse_charge, iban, bic) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id",
      [org.id, name, email, phone, vat, account, notes, rc, iban, bic]))!.id;
  } catch (error) { return dbFailure(error, "The supplier could not be saved."); }
  refresh();
  if (!id && form.get("return") !== "stay") redirect(await orgPath(`/accounts/suppliers/${savedId}`));
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export async function saveBill(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  let supplier = p.uuid("supplier_id");
  const newSupplier = supplier ? null : p.text("new_supplier", { max: 200, label: "Supplier name" });
  if (!supplier && !newSupplier) p.errors.supplier_id = "Choose the supplier, or name a new one.";
  const issued = date(p, "issued_on", "Bill date"), due = date(p, "due_on", "Due date", false);
  if (issued && due && due < issued) p.errors.due_on = "The due date cannot be before the bill date.";
  const number = p.text("number", { max: 60, label: "Supplier's invoice number" });
  const reference = p.text("reference", { max: 120, label: "Reference" });
  const notes = p.text("notes", { max: 2000, label: "Notes" });
  const source = p.text("source_document", { max: 300, label: "Source document" });
  const lines = documentLines(p, form.get("lines"));
  if (p.failed || (!supplier && !newSupplier) || !issued || !lines) return p.fail();
  let billId: string;
  try {
    if (!supplier && newSupplier) supplier = (await one<{ id: string }>("insert into suppliers (organisation_id, name) values ($1, $2) returning id", [org.id, newSupplier]))!.id;
    billId = (await one<{ id: string }>("select save_bill($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) as id",
      [org.id, id, supplier, number, reference, issued, due, notes, source, JSON.stringify(lines), p.boolean("reverse_charge"), reverseChargeKind(form)]))!.id;
  } catch (error) { return dbFailure(error, "The bill could not be saved."); }
  refresh();
  redirect(await orgPath(`/accounts/bills/${billId}`));
}

export async function setBillVoid(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  const p = new FormParser(form), id = p.uuid("id");
  if (!id) return { ok: false, error: "That bill is no longer available." };
  try { await sql("select set_bill_void($1, $2)", [id, p.boolean("void")]); } catch (error) { return dbFailure(error, "The bill could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function recordBillPayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const bill = p.uuid("bill_id"), bank = p.uuid("bank_account_id");
  const paid = date(p, "paid_on", "Date paid");
  const amount = p.money("amount", "Amount paid");
  if (!amount) p.errors.amount = "Enter the amount paid.";
  if (!bank) p.errors.bank_account_id = "Choose the bank account it was paid from.";
  const method = p.enum("method", INVOICE_PAYMENT_METHODS, { fallback: "bank_transfer" }) ?? "bank_transfer";
  const reference = p.text("reference", { max: 120, label: "Reference" });
  if (p.failed || !bill || !bank || !paid || !amount) return p.fail();
  try {
    await sql("insert into bill_payments (organisation_id, bill_id, paid_on, amount, bank_account_id, method, reference) values ($1, $2, $3, $4, $5, $6, $7)", [org.id, bill, paid, amount, bank, method, reference]);
  } catch (error) { return dbFailure(error, "The payment could not be recorded."); }
  refresh();
  return { ok: true, error: null };
}

export async function removeBillPayment(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  try { await sql("delete from bill_payments where id = $1 and organisation_id = $2", [id, org.id]); } catch (error) { console.error("[accounts] payment removal failed", asDbError(error).code); }
  refresh();
}

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

export async function saveBankTransaction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const kind = p.enum("kind", BANK_TRANSACTION_KINDS, { required: true, label: "Type" });
  const bank = p.uuid("bank_account_id"), other = p.uuid("transfer_account_id");
  if (!bank) p.errors.bank_account_id = "Choose the bank account.";
  if (kind === "transfer" && !other) p.errors.transfer_account_id = "Choose the account it went to.";
  if (kind === "transfer" && other && other === bank) p.errors.transfer_account_id = "Choose a different account.";
  const when = date(p, "txn_date", "Date");
  const contact = p.text("contact", { max: 200, label: kind === "receive" ? "Received from" : "Paid to" });
  const reference = p.text("reference", { max: 120, label: "Reference" });
  const amount = kind === "transfer" ? p.money("amount", "Amount") : null;
  if (kind === "transfer" && !amount) p.errors.amount = "Enter the amount to transfer.";
  const lines = kind === "transfer" ? [] : documentLines(p, form.get("lines"));
  if (p.failed || !kind || !bank || !when || !lines) return p.fail();
  let saved: string;
  try {
    saved = (await one<{ id: string }>("select save_bank_transaction($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) as id",
      [org.id, id, kind, bank, kind === "transfer" ? other : null, when, contact, reference, amount, kind === "transfer" ? null : JSON.stringify(lines), kind === "spend" && p.boolean("reverse_charge"), reverseChargeKind(form)]))!.id;
  } catch (error) { return dbFailure(error, "The transaction could not be saved."); }
  refresh();
  redirect(await orgPath(`/accounts/bank/transactions/${saved}`));
}

export async function deleteBankTransaction(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return { ok: false, error: "That transaction is no longer available." };
  try { await sql("select delete_bank_transaction($1)", [id]); } catch (error) { return dbFailure(error, "The transaction could not be removed."); }
  refresh();
  redirect(await orgPath("/accounts/bank"));
}

// ---------------------------------------------------------------------------
// Journals, the chart and settings
// ---------------------------------------------------------------------------

export async function saveManualJournal(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const when = date(p, "entry_date", "Date");
  const narration = p.text("narration", { required: true, max: 300, label: "Narration" });
  const reference = p.text("reference", { max: 120, label: "Reference" });
  let lines: { account_id: string; debit: number; credit: number; description: string | null }[] = [];
  try {
    const parsed = JSON.parse(String(form.get("lines") ?? "[]")) as Record<string, unknown>[];
    lines = (Array.isArray(parsed) ? parsed : []).map(line => ({
      account_id: String(line.account_id ?? ""), debit: Math.round(Number(line.debit || 0) * 100) / 100,
      credit: Math.round(Number(line.credit || 0) * 100) / 100, description: typeof line.description === "string" && line.description.trim() ? line.description.trim().slice(0, 300) : null,
    })).filter(line => line.account_id && (line.debit > 0 || line.credit > 0));
  } catch { lines = []; }
  if (lines.length < 2) p.errors.lines = "A journal needs at least two lines.";
  if (p.failed || !when || !narration) return p.fail();
  let saved: string | undefined;
  try { saved = (await one<{ id: string }>("select save_manual_journal($1, $2, $3, $4, $5, $6::jsonb) as id", [org.id, id, when, reference, narration, JSON.stringify(lines)]))?.id; }
  catch (error) { return dbFailure(error, "The journal could not be saved."); }
  refresh();
  redirect(await orgPath(`/accounts/journals/${saved}?saved=${id ? "edited" : "posted"}`));
}

export async function deleteManualJournal(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  const journal = id ? await one("select 1 from journal_entries where id = $1 and organisation_id = $2 and source = 'manual'", [id, org.id]) : null;
  if (!id || !journal) return { ok: false, error: "That journal is no longer available." };
  try { await sql("select delete_manual_journal($1)", [id]); } catch (error) { return dbFailure(error, "The journal could not be removed."); }
  refresh();
  redirect(await orgPath("/accounts/journals?removed=1"));
}

export async function saveLedgerAccount(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  const code = p.text("code", { required: true, max: 6, label: "Code" });
  if (code && !/^\d{3,6}$/.test(code)) p.errors.code = "Use a code of three to six digits.";
  const name = p.text("name", { required: true, max: 120, label: "Account name" }) ?? "";
  const type = p.enum("type", LEDGER_ACCOUNT_TYPES, { required: true, label: "Type" }) ?? "expense";
  const description = p.text("description", { max: 500, label: "Description" }), bankDetails = p.text("bank_details", { max: 200, label: "Bank details" });
  const active = id ? p.boolean("is_active") : true;
  if (p.failed) return p.fail();
  let saved = id;
  try {
    if (id) await sql("update ledger_accounts set code = $3, name = $4, type = $5, description = $6, bank_details = $7, is_active = $8, updated_at = now() where id = $1 and organisation_id = $2",
      [id, org.id, code, name, type, description, bankDetails, active]);
    else saved = (await one<{ id: string }>("insert into ledger_accounts (organisation_id, code, name, type, description, bank_details) values ($1, $2, $3, $4, $5, $6) returning id",
      [org.id, code, name, type, description, bankDetails]))!.id;
  } catch (error) { return dbFailure(error, "The account could not be saved."); }
  refresh();
  if (!id) redirect(await orgPath(`/accounts/chart/${saved}`));
  return { ok: true, error: null };
}

export async function saveAccountingSettings(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const lock = date(p, "lock_date", "Lock date", false);
  const bank = p.uuid("default_bank_account_id");
  const yearEnd = Number(form.get("year_end_month"));
  if (!Number.isInteger(yearEnd) || yearEnd < 1 || yearEnd > 12) p.errors.year_end_month = "Choose the month the financial year ends.";
  const manager = p.text("manager", { max: 120, label: "Looked after by" });
  if (p.failed) return p.fail();
  try { await sql("update organisations set lock_date = $2, default_bank_account_id = coalesce($3, default_bank_account_id), year_end_month = $4, manager = $5 where id = $1", [org.id, lock, bank, yearEnd, manager]); }
  catch (error) { return dbFailure(error, "The settings could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** How a UK company returns VAT: its period, its stagger or VAT year, and its schemes (lib/domain/vat-uk). */
export async function saveVatScheme(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  if (org.country !== "GB") return { ok: false, error: "VAT schemes here are the UK’s." };
  const p = new FormParser(form);
  const period = p.enum("vat_period", ["quarterly", "monthly", "annual"] as const, { fallback: "quarterly", label: "VAT period" })!;
  const stagger = Number(form.get("vat_quarter_end_month"));
  if (![1, 2, 3].includes(stagger)) p.errors.vat_quarter_end_month = "Choose the months the VAT quarters end in.";
  const yearEnd = period === "annual" ? Number(form.get("vat_year_end_month")) : null;
  if (period === "annual" && !(Number.isInteger(yearEnd) && yearEnd! >= 1 && yearEnd! <= 12)) p.errors.vat_year_end_month = "Choose the month the VAT year ends.";
  const payments = period === "annual" ? p.enum("vat_annual_payments", ["monthly", "quarterly"] as const, { required: true, label: "Payments on account" }) : null;
  const cash = p.boolean("vat_cash_accounting");
  const flatText = p.text("vat_flat_rate", { max: 6, label: "Flat rate" });
  const flat = flatText ? Number(flatText.replace("%", "")) : null;
  if (flat !== null && !(Number.isFinite(flat) && flat > 0 && flat <= 16.5)) p.errors.vat_flat_rate = "A flat rate is a percentage from HMRC’s list, at most 16.5% (the limited cost business rate).";
  if (p.failed) return p.fail();
  try {
    await sql(`update organisations set vat_period = $2, vat_quarter_end_month = $3, vat_year_end_month = $4, vat_annual_payments = $5, vat_cash_accounting = $6, vat_flat_rate = $7 where id = $1`,
      [org.id, period, stagger, yearEnd, payments, cash, flat]);
  } catch (error) { return dbFailure(error, "The VAT settings could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/**
 * File the return for a period: record it and lock the books up to its last day. A UK return is worked out again
 * here, and its nine boxes kept exactly as filed; on the flat rate, the difference between the VAT charged and the
 * flat rate paid is moved from the VAT account to the scheme's surplus, so the VAT account shows what HMRC is owed.
 */
export async function fileVatReturn(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const from = date(p, "from", "Period start"), to = date(p, "to", "Period end");
  let net = Number(form.get("net"));
  if (p.failed || !from || !to || !Number.isFinite(net)) return { ok: false, error: "That period could not be read." };
  const reference = String(form.get("reference") ?? "").trim().replace(/\s+/g, " ").slice(0, 60) || null;
  let boxes: Record<string, number> = {};
  let flatRateShift = 0;
  if (org.country !== "GB") {
    // The boxes as filed, kept with the filing: what the Tax Department was told.
    const report = await getVatReport({ range: "custom", from, to });
    const { vat, values } = vatBoxes(report.summary, report.breakdown);
    boxes = Object.fromEntries([...vat, ...values].map(box => [box.box, box.amount]));
  }
  if (org.country === "GB") {
    const figures = await getUkVatFigures(org, from, to);
    const uk = ukVatReturn(figures, ukSchemeOf(org));
    net = uk.net;
    boxes = Object.fromEntries(uk.boxes.map(box => [box.box, box.amount]));
    if (org.vat_flat_rate !== null) flatRateShift = Math.round(((figures.salesVat - figures.purchaseVat) - (uk.flatVat - figures.capital.vat)) * 100) / 100;
  }
  try {
    await transaction(async run => {
      if (flatRateShift) {
        const [vat, surplus] = await Promise.all([
          run<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'vat'", [org.id]),
          run<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and code = '265'", [org.id]),
        ]);
        if (!vat[0] || !surplus[0]) throw Object.assign(new Error("flat_rate_accounts: the VAT account or the Flat Rate Scheme surplus account (265) is missing"), { code: "23514" });
        const amount = Math.abs(flatRateShift), up = flatRateShift > 0;
        await run("select save_manual_journal($1, null, $2, $3, $4, $5::jsonb)", [org.id, to, `FRS ${to}`, `Flat Rate Scheme: VAT charged less the ${org.vat_flat_rate}% flat rate, ${from} to ${to}`,
          JSON.stringify([{ account_id: vat[0].id, debit: up ? amount : 0, credit: up ? 0 : amount }, { account_id: surplus[0].id, debit: up ? 0 : amount, credit: up ? amount : 0 }])]);
      }
      await run("insert into vat_returns (organisation_id, period_from, period_to, filed_on, net_vat, boxes, reference) values ($1, $2, $3, (now() at time zone 'Asia/Nicosia')::date, $4, $5::jsonb, $6) on conflict (organisation_id, period_to) do nothing",
        [org.id, from, to, net, JSON.stringify(boxes), reference]);
      await run("update organisations set lock_date = greatest(coalesce(lock_date, $2::date), $2::date) where id = $1", [org.id, to]);
    });
  } catch (error) { return dbFailure(error, "The return could not be recorded."); }
  refresh();
  return { ok: true, error: null, notice: flatRateShift ? "Filed, the flat rate surplus posted, and the books locked to the end of the period." : "Filed, and the books are locked to the end of the period." };
}

export async function setSupplierActive(form: FormData): Promise<void> {
  const org = await requireOrg();
  const p = new FormParser(form), id = p.uuid("id");
  if (!id) return;
  try { await sql("update suppliers set is_active = $3 where id = $1 and organisation_id = $2", [id, org.id, p.boolean("is_active")]); }
  catch (error) { console.error("[accounts] supplier status failed", asDbError(error).code); }
  refresh();
}
