"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { firmToday, validRecordDate } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import { VAT_RATES } from "@/types/database";

/**
 * Writes for buying beyond the bill itself: suppliers' credit notes, their
 * refunds, and bills paid together. Each goes through the database's own
 * function or checks, which post it and keep every balance in step.
 */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => {
  const failure = asDbError(error);
  console.error("[purchases] save failed", failure.code);
  return { ok: false, error: describeDbError(failure, fallback) };
};
function date(p: FormParser, name: string, label: string, required = true) {
  const value = p.text(name, { required, max: 10, label });
  if (value && !validRecordDate(value)) p.errors[name] = `${label} is not a valid date.`;
  return value;
}

/** Lines as the supplier printed them: net, rate and VAT, as on a bill. */
function supplierLines(p: FormParser, raw: FormDataEntryValue | null) {
  let parsed: unknown;
  try { parsed = JSON.parse(typeof raw === "string" ? raw : "[]"); } catch { parsed = null; }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 200) { p.errors.lines = "Add at least one line."; return null; }
  const lines: { description: string; account_id: string; net: number; vat_rate: number; vat_amount: number }[] = [];
  for (const [index, item] of parsed.entries()) {
    const line = item as Record<string, unknown>;
    const description = typeof line.description === "string" ? line.description.trim() : "";
    const net = Number(line.net), rate = Number(line.vat_rate), vat = Number(line.vat_amount);
    if (!description && !net) continue;
    if (!description || typeof line.account_id !== "string" || !line.account_id || !Number.isFinite(net) || net < 0 || !VAT_RATES.includes(rate as (typeof VAT_RATES)[number]) || !Number.isFinite(vat) || vat < 0) {
      p.errors.lines = `Line ${index + 1} needs a description, an account, an amount and a VAT rate.`;
      return null;
    }
    lines.push({ description: description.slice(0, 300), account_id: line.account_id, net: Math.round(net * 100) / 100, vat_rate: rate, vat_amount: Math.round(vat * 100) / 100 });
  }
  if (!lines.length) { p.errors.lines = "Add at least one line."; return null; }
  return lines;
}

// ---------------------------------------------------------------------------
// Suppliers' credit notes
// ---------------------------------------------------------------------------

export async function saveSupplierCredit(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id"), bill = p.uuid("bill_id"), supplier = p.uuid("supplier_id");
  if (!supplier) p.errors.supplier_id = "Choose the supplier.";
  const number = p.text("number", { max: 60, label: "Credit note number" });
  const issued = date(p, "issued_on", "Credit note date");
  const lines = supplierLines(p, form.get("lines"));
  if (p.failed || !supplier || !issued || !lines) return p.fail();
  let creditId: string;
  try {
    creditId = (await one<{ id: string }>("select save_supplier_credit($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) as id",
      [org.id, id, supplier, bill, number, issued, p.text("notes", { max: 2000 }), JSON.stringify(lines), p.boolean("reverse_charge")]))!.id;
  } catch (error) { return fail(error, "The credit note could not be saved."); }
  refresh();
  redirect(`/c/${org.slug}/supplier-credits/${creditId}${id ? "" : "?recorded=1"}`);
}

export async function setSupplierCreditVoid(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const id = p.uuid("id");
  if (!id || !(await one("select 1 from supplier_credits where id = $1 and organisation_id = $2", [id, org.id]))) return { ok: false, error: "That credit note is no longer available." };
  try { await sql("select set_supplier_credit_void($1, $2)", [id, p.boolean("void")]); }
  catch (error) { return fail(error, "The credit note could not be changed."); }
  refresh();
  return { ok: true, error: null };
}

export async function allocateSupplierCredit(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const credit = p.uuid("supplier_credit_id"), bill = p.uuid("bill_id");
  const amount = p.money("amount", "Amount");
  if (!bill) p.errors.bill_id = "Choose the bill.";
  if (!amount) p.errors.amount = "Enter the amount to set against it.";
  if (p.failed || !credit || !bill || !amount) return p.fail();
  try {
    await sql(`insert into supplier_credit_allocations (organisation_id, supplier_credit_id, bill_id, amount, allocated_on)
               select $1, $2, $3, $4, $5 where exists (select 1 from supplier_credits where id = $2 and organisation_id = $1)`, [org.id, credit, bill, amount, firmToday()]);
  } catch (error) { return fail(error, "The credit could not be set against that bill."); }
  refresh();
  return { ok: true, error: null };
}

export async function removeSupplierAllocation(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  try { await sql("delete from supplier_credit_allocations where id = $1 and organisation_id = $2", [id, org.id]); }
  catch (error) { console.error("[purchases] allocation removal failed", asDbError(error).code); }
  refresh();
}

/** The supplier paid the credit back: money received into the bank against what they owed. */
export async function recordSupplierRefund(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const credit = p.uuid("supplier_credit_id"), bank = p.uuid("bank_account_id");
  const received = date(p, "received_on", "Date received");
  const amount = p.money("amount", "Amount received");
  if (!amount) p.errors.amount = "Enter the amount received.";
  if (!bank) p.errors.bank_account_id = "Choose the bank account it went into.";
  if (received && received > firmToday()) p.errors.received_on = "A refund cannot be dated in the future.";
  if (p.failed || !credit || !bank || !received || !amount) return p.fail();
  try {
    await sql(`insert into bank_transactions (organisation_id, kind, bank_account_id, txn_date, contact, reference, amount, net, supplier_credit_id)
               select c.organisation_id, 'receive', $3, $4, s.name, 'Refund · ' || coalesce(c.number, s.name), $5, $5, c.id
                 from supplier_credits c join suppliers s on s.id = c.supplier_id where c.id = $2 and c.organisation_id = $1`, [org.id, credit, bank, received, amount]);
  } catch (error) { return fail(error, "The refund could not be recorded."); }
  refresh();
  return { ok: true, error: null };
}

export async function removeSupplierRefund(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  try { await sql("delete from bank_transactions where id = $1 and organisation_id = $2 and supplier_credit_id is not null", [id, org.id]); }
  catch (error) { console.error("[purchases] refund removal failed", asDbError(error).code); }
  refresh();
}

// ---------------------------------------------------------------------------
// Bills paid together
// ---------------------------------------------------------------------------

/** Pay several bills in full from one account on one day: a payment each, and a run that makes the bank's SEPA file. */
export async function payBills(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const p = new FormParser(form);
  const bank = p.uuid("bank_account_id");
  const paid = date(p, "paid_on", "Payment date");
  const reference = p.text("reference", { max: 120, label: "Reference" });
  let ids: string[] = [];
  try { ids = (JSON.parse(String(form.get("bill_ids") ?? "[]")) as unknown[]).filter((value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)); } catch { ids = []; }
  if (!bank) p.errors.bank_account_id = "Choose the bank account to pay from.";
  if (!ids.length) return { ok: false, error: "Choose the bills to pay." };
  if (ids.length > 200) return { ok: false, error: "Pay up to 200 bills at a time." };
  if (p.failed || !bank || !paid) return p.fail();
  let runId: string;
  try {
    runId = await transaction(async run => {
      const created = (await run<{ id: string }>("insert into bill_payment_runs (organisation_id, bank_account_id, paid_on, reference) values ($1, $2, $3, $4) returning id", [org.id, bank, paid, reference]))[0].id;
      const bills = await run<{ id: string; number: string | null; balance: number }>(
        "select id, number, balance from v_bill_directory where organisation_id = $1 and id = any($2::uuid[]) and status in ('awaiting_payment', 'part_paid') and balance > 0", [org.id, ids]);
      if (!bills.length) throw Object.assign(new Error("nothing to pay"), { code: "P0001", message: "bills_nothing_to_pay" });
      for (const bill of bills) {
        await run("insert into bill_payments (organisation_id, bill_id, paid_on, amount, bank_account_id, method, reference, run_id) values ($1, $2, $3, $4, $5, 'bank_transfer', $6, $7)",
          [org.id, bill.id, paid, bill.balance, bank, reference ?? bill.number, created]);
      }
      return created;
    });
  } catch (error) {
    if (asDbError(error).message.includes("bills_nothing_to_pay")) return { ok: false, error: "Those bills are already paid." };
    return fail(error, "The payments could not be recorded.");
  }
  refresh();
  redirect(`/c/${org.slug}/bills/runs/${runId}`);
}

/** Undo a run that has not reached the bank statement: its payments come off, and the bills are owed again. */
export async function undoPaymentRun(form: FormData): Promise<void> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  if (!id) return;
  try {
    await transaction(async run => {
      await run(`delete from bill_payments p where p.run_id = $1 and p.organisation_id = $2 and not exists (select 1 from bank_line_matches m where m.bill_payment_id = p.id)`, [id, org.id]);
      await run("delete from bill_payment_runs r where r.id = $1 and r.organisation_id = $2 and not exists (select 1 from bill_payments p where p.run_id = r.id)", [id, org.id]);
    });
  } catch (error) { console.error("[purchases] run undo failed", asDbError(error).code); }
  refresh();
  redirect(`/c/${org.slug}/bills`);
}
