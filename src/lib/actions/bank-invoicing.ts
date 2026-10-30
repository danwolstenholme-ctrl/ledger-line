"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { MAX_PAYMENTS } from "@/lib/data/bank-invoicing";
import { nameKey, namedAsCompany, raisedFromPayment, splitGross } from "@/lib/domain/bank-invoicing";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { regimeOf, treatmentFor } from "@/lib/domain/regimes";
import { formatAmount, formatDate } from "@/lib/format";
import { orgPath, requireOrg } from "@/lib/org";

// special: no VAT, for a customer the form would charge at the standard rate, as an exempt supply (the rent of a home, say)
// or one outside the scope (a service to a customer abroad, not kept yet).
type Item = { line_id: string; customer_id: string | null; customer_name: string; description: string; vat_rate: number; special: "exempt" | "outside_scope" | null };
// A customer by name and kind: John Smith isn't John Smith Ltd.
const kindKey = (name: string) => `${nameKey(name)}|${namedAsCompany(name) ? "company" : "person"}`;
type Customer = { id: string; name: string; default_account_id: string | null; eu_business: boolean; country: string };
const CUSTOMERS = "select id, name, default_account_id, eu_business, country from customers where organisation_id = $1 and is_active";

/** What the page sent, each payment checked: its line, a customer (one kept, or a name for a new one), what it was for, and a VAT rate the company charges. */
function readItems(raw: unknown, rates: readonly number[]): Item[] | string {
  if (!Array.isArray(raw) || !raw.length) return "Tick the payments to invoice.";
  if (raw.length > MAX_PAYMENTS) return `At most ${MAX_PAYMENTS} payments at once.`;
  const items: Item[] = [];
  for (const [index, entry] of (raw as (Record<string, unknown> | null)[]).entries()) {
    const at = `Payment ${index + 1}`;
    if (!entry || typeof entry !== "object" || typeof entry.line_id !== "string" || !UUID_PATTERN.test(entry.line_id)) return `${at} is not one of this account's lines.`;
    const customerId = typeof entry.customer_id === "string" && UUID_PATTERN.test(entry.customer_id) ? entry.customer_id : null;
    const name = typeof entry.customer_name === "string" ? entry.customer_name.trim().replace(/\s+/g, " ").slice(0, 200) : "";
    const description = typeof entry.description === "string" ? entry.description.trim().replace(/\s+/g, " ").slice(0, 300) : "";
    const rate = Number(entry.vat_rate);
    if (!customerId && !name) return `${at} needs a customer.`;
    if (!description) return `${at} needs to say what it was for.`;
    if (!rates.includes(rate)) return `${at} has a VAT rate the company does not charge.`;
    items.push({ line_id: entry.line_id, customer_id: customerId, customer_name: name, description, vat_rate: rate, special: entry.special === "exempt" || entry.special === "outside_scope" ? entry.special : null });
  }
  return items;
}

/**
 * Each payment ticked becomes an invoice: to its customer (one already kept,
 * or a new one by the name shown), for the payment's amount, dated and due the
 * day the money arrived (its time of supply, so its VAT falls in that period),
 * and matched to the payment, so it is paid. They are numbered in a series of
 * their own, by the payment's year (INV-R2026-0001), so a year's invoices
 * from the form keep their order however late payments are invoiced; each
 * says when it was recorded and from what. Its VAT treatment is the one the
 * invoice form would start from for that customer; at the standard
 * treatment, the VAT inside the payment is worked back from the total. They
 * are raised in date order, each on its own: one that cannot be (a date
 * before the lock date, say) is reported, and the rest go ahead.
 */
export async function raiseInvoicesFromPayments(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const bank = new FormParser(form).uuid("bank_account_id");
  if (!bank) return { ok: false, error: "Choose the bank account." };
  const rates = org.vat_registered ? regimeOf(org.country).vatRates : [0], today = firmToday();
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("items") ?? "[]")); } catch { raw = null; }
  const items = readItems(raw, rates);
  if (typeof items === "string") return { ok: false, error: items };

  const [lines, customers, sales] = await Promise.all([
    sql<{ id: string; txn_date: string; amount: number; reference: string | null; matched: boolean; excluded_at: string | null }>(
      "select id, txn_date, amount, reference, matched, excluded_at from bank_statement_lines where id = any($1::uuid[]) and bank_account_id = $2 and organisation_id = $3",
      [items.map(item => item.line_id), bank, org.id]),
    sql<Customer>(CUSTOMERS, [org.id]),
    one<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [org.id]),
  ]);
  if (!sales) return { ok: false, error: "The company has no sales account to post the invoices to." };
  const lineOf = new Map(lines.map(line => [line.id, line]));
  const byId = new Map(customers.map(customer => [customer.id, customer]));
  const byKey = new Map(customers.map(customer => [kindKey(customer.name), customer]));
  // In date order, so each year's numbers run in the order of its dates.
  const ordered = [...items].sort((a, b) => (lineOf.get(a.line_id)?.txn_date ?? "").localeCompare(lineOf.get(b.line_id)?.txn_date ?? "") || a.line_id.localeCompare(b.line_id));

  let raised = 0;
  const problems: string[] = [];
  for (const item of ordered) {
    const line = lineOf.get(item.line_id);
    const label = line ? `${formatDate(line.txn_date)}, ${formatAmount(Number(line.amount), org.currency)}` : "A payment";
    if (!line) { problems.push(`${label}: it is not one of this account's lines.`); continue; }
    if (Number(line.amount) <= 0 || line.matched || line.excluded_at) { problems.push(`${label}: it is already matched or set aside.`); continue; }
    if (org.books_from && line.txn_date < org.books_from) { problems.push(`${label}: it is before the books begin.`); continue; }
    const sent = item.customer_id ? byId.get(item.customer_id) : undefined;
    const known = (sent && (!item.customer_name || kindKey(sent.name) === kindKey(item.customer_name)) ? sent : null) ?? byKey.get(kindKey(item.customer_name)) ?? null;
    if (!known && !item.customer_name) { problems.push(`${label}: its customer is no longer kept; name one.`); continue; }
    try {
      const made = await transaction(async run => {
        // One at a time for the company, so two people raising at once can't take the same number or make the same payer
        // a customer twice: whoever is second waits, then finds what the first made.
        await run("select pg_advisory_xact_lock(hashtext($1))", [`invoice-numbers:${org.id}`]);
        // A new customer is named as the page showed it, and is in the company's own country.
        const customer = known ?? (await run<Customer>(CUSTOMERS, [org.id])).find(row => kindKey(row.name) === kindKey(item.customer_name))
          ?? (await run<Customer>("insert into customers (organisation_id, name, country, default_account_id) values ($1, $2, $3, $4) returning id, name, default_account_id, eu_business, country",
            [org.id, item.customer_name, org.country, sales.id]))[0];
        const usual = treatmentFor(customer, org.vat_registered, org.country), treatment = usual === "standard" && item.special ? item.special : usual;
        const rate = treatment === "standard" ? item.vat_rate : 0;
        const prefix = `${org.invoice_prefix}R${line.txn_date.slice(0, 4)}-`;
        const taken = await run<{ number: string }>("select number from invoices where organisation_id = $1 and number like $2", [org.id, `${prefix.replace(/[\\%_]/g, "\\$&")}%`]);
        const number = `${prefix}${String(taken.reduce((max, row) => Math.max(max, Number(/(\d+)$/.exec(row.number)?.[1] ?? 0)), 0) + 1).padStart(4, "0")}`;
        const { net, vat } = splitGross(Number(line.amount), rate);
        const [{ id }] = await run<{ id: string }>("select save_invoice($1, null, $2, $3, $4, $4, $5, $6, $7::jsonb, 'issued', $8) as id",
          [org.id, customer.id, number, line.txn_date, treatment, `Recorded on ${formatDate(today)} from the payment received on ${formatDate(line.txn_date)}.`,
            JSON.stringify([{ description: item.description, account_id: customer.default_account_id ?? sales.id, item_id: null, unit: null, vat_rate: rate, net, vat_amount: vat }]),
            line.reference?.trim().slice(0, 200) || null]);
        await run("select reconcile_bank_line($1, $2::jsonb)", [line.id, JSON.stringify([{ kind: "invoice", invoice_id: id, amount: Number(line.amount) }])]);
        return customer;
      });
      // A customer made for one payment is the customer for the next payment from the same payer.
      byId.set(made.id, made); byKey.set(kindKey(made.name), made);
      raised += 1;
    } catch (error) {
      const failure = asDbError(error);
      console.error("[bank invoicing] raise failed", failure.code);
      problems.push(`${label}: ${describeDbError(failure, "the invoice could not be raised.")}`);
    }
  }
  revalidatePath("/", "layout");
  if (!problems.length) redirect(await orgPath(`/accounts/bank/${bank}?invoiced=${raised}`));
  return { ok: raised > 0, error: `${raised ? `${raised} raised. ` : ""}${problems.length} could not be: ${problems.slice(0, 4).join(" ")}${problems.length > 4 ? ` And ${problems.length - 4} more.` : ""}`,
    notice: raised ? `Raised ${raised} invoice${raised === 1 ? "" : "s"}.` : undefined };
}

/**
 * An invoice raised from a payment, undone in one go: its payment comes off
 * (and with it the match to the bank's line, so the line is back to match or
 * code), and the invoice is voided, keeping its number. Refused when the
 * books are locked for its date, or when anything else was done with it: a
 * credit note, or another payment.
 */
export async function undoInvoiceFromPayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const id = new FormParser(form).uuid("id");
  const invoice = id ? await one<{ number: string; status: string; amount_credited: number; notes: string | null }>("select number, status::text as status, amount_credited, notes from invoices where id = $1 and organisation_id = $2", [id, org.id]) : null;
  if (!id || !invoice || invoice.status === "void" || !raisedFromPayment(invoice.notes)) return { ok: false, error: "That invoice is no longer available." };
  try {
    await transaction(async run => {
      const payments = await run<{ id: string; matched: boolean }>(`select p.id, exists (select 1 from bank_line_matches m where m.invoice_payment_id = p.id) as matched
        from invoice_payments p where p.invoice_id = $1 and p.organisation_id = $2`, [id, org.id]);
      // A credit note against it (refunded, or kept as credit, a paid invoice's credit isn't set against it) stays in the VAT: undo that first.
      const credited = await run("select 1 from credit_notes where invoice_id = $1 and organisation_id = $2 and status <> 'void' limit 1", [id, org.id]);
      if (payments.some(payment => !payment.matched) || Number(invoice.amount_credited) !== 0 || credited.length) throw new UndoRefused();
      // Removing the payment removes its match to the bank's line with it.
      await run("delete from invoice_payments where id = any($1::uuid[]) and organisation_id = $2", [payments.map(payment => payment.id), org.id]);
      const voided = await run("update invoices set status = 'void' where id = $1 and organisation_id = $2 and amount_paid = 0 and amount_credited = 0 returning id", [id, org.id]);
      if (!voided.length) throw new UndoRefused();
      // A customer made for this invoice alone (in the same moment, with nothing else of theirs) is put away with it: else the
      // payment would come back as from a customer already kept, and be ticked to be invoiced again.
      await run(`update customers c set is_active = false where c.organisation_id = $2 and c.is_active
          and c.id = (select customer_id from invoices where id = $1) and c.created_at = (select created_at from invoices where id = $1)
          and not exists (select 1 from invoices i where i.customer_id = c.id and i.id <> $1)
          and not exists (select 1 from quotes q where q.customer_id = c.id) and not exists (select 1 from credit_notes n where n.customer_id = c.id)`, [id, org.id]);
    });
  } catch (error) {
    if (error instanceof UndoRefused) return { ok: false, error: "Something else was done with this invoice since it was raised: undo that first, or raise a credit note." };
    return { ok: false, error: describeDbError(asDbError(error), "The invoice could not be undone.") };
  }
  revalidatePath("/", "layout");
  // Back to the invoice, void now, which says so: the button that did it isn't there for a void invoice.
  redirect(`/c/${org.slug}/sales/${id}?undone=1`);
}

class UndoRefused extends Error {}
