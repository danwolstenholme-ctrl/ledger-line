import "server-only";

import { one, sql } from "@/lib/db";
import { fromPerson, nameKey, namedAsCompany, notASale, payerName, paymentDescription } from "@/lib/domain/bank-invoicing";
import { suggestMatches } from "@/lib/domain/bank-statements";
import { COUNTRIES } from "@/lib/domain/countries";
import { regimeOf, standardRate } from "@/lib/domain/regimes";
import { formatAmount, formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/org";
import type { UnreconciledBankItemRow } from "@/types/database";
import { getMatchCandidates, LINES_PAGE } from "./bank";

export const MAX_PAYMENTS = 500;
// For a while after the books open with customers owing, a payment is likelier for one of those invoices than a new sale.
const OPENING_DEBTORS_DAYS = 120;
// How far before a payment's bank date one recorded by hand is looked for.
const RECORDED_DAYS = 120;
const kindKey = (name: string) => `${nameKey(name)}|${namedAsCompany(name) ? "company" : "person"}`;
const RECORDED = new Set(["invoice_payment", "bill_payment", "bank_transaction"]);

type Line = { id: string; txn_date: string; amount: number; description: string; reference: string | null; counterparty: string | null };
// Words of a bank's text without the customer's own name: what is left says what the money was.
const withoutName = (text: string, name: string) => { const own = nameKey(name).split(" "); return text.split(/\s+/).filter(word => !own.includes(nameKey(word))).join(" "); };
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Money received into a bank account that nothing in the books accounts for
 * yet: what can be invoiced from here. Each payment comes with the bank's own
 * words, its payer as a customer (one already kept when the name is the same,
 * or found in the bank's text), what the invoice would say it was for, and a
 * note when something says it isn't a new sale: it looks like it pays an
 * invoice already raised, or is already in the books, or was coded otherwise
 * before, or its payer owes money already, or it is there twice, or it isn't
 * a sale at all (interest, a loan, a refund, card takings), or it may pay an
 * invoice from before the books began. A payment with a note starts unticked,
 * as does one from a payer not yet kept as a customer; one before the books
 * began or on or before the lock date can't be ticked.
 */
export async function getPaymentsToInvoice(bankAccountId: string, lineId?: string | null) {
  const org = await requireOrg();
  const bank = await one<{ id: string; name: string }>("select id, name from ledger_accounts where id = $1 and organisation_id = $2 and type = 'bank'", [bankAccountId, org.id]);
  if (!bank) return null;
  const waiting = "bank_account_id = $1 and organisation_id = $2 and amount > 0 and not matched and excluded_at is null";
  // Lines from before the books began, or in months the lock date closes, can't be invoiced: they are counted, not listed.
  const open = "txn_date >= coalesce($3::date, '-infinity'::date) and txn_date > coalesce($4::date, '-infinity'::date)";
  const dates = [org.books_from ?? null, org.lock_date ?? null];
  const [lines, counts, customers, candidates, unreconciled, owing, twins, opening, people, raised] = await Promise.all([
    sql<Line>(`select id, txn_date, amount, description, reference, counterparty from bank_statement_lines where ${waiting} and ${open} ${lineId ? "and id = $5" : ""}
       order by txn_date, id limit ${MAX_PAYMENTS + 1}`, lineId ? [bank.id, org.id, ...dates, lineId] : [bank.id, org.id, ...dates]),
    one<{ count: number; closed: number }>(`select count(*) filter (where ${open}) as count, count(*) filter (where not (${open})) as closed from bank_statement_lines where ${waiting}`, [bank.id, org.id, ...dates]),
    sql<{ id: string; name: string; eu_business: boolean; country: string; vat_number: string | null }>("select id, name, eu_business, country, vat_number from customers where organisation_id = $1 and is_active order by name", [org.id]),
    getMatchCandidates(),
    sql<UnreconciledBankItemRow>("select * from unreconciled_bank_items($1)", [bank.id]),
    // What each customer still owes, drafts too.
    sql<{ customer_id: string; invoices: number; owed: number }>(`select customer_id, count(*) as invoices, sum(total - amount_paid - amount_credited) as owed from invoices
       where organisation_id = $1 and status in ('draft', 'issued', 'part_paid') and total - amount_paid - amount_credited > 0 group by customer_id`, [org.id]),
    // Lines that share their day and amount with another: the same payment brought in twice, by statements in two formats.
    sql<Line & { matched: boolean }>(`select id, txn_date, amount, description, reference, counterparty, matched from bank_statement_lines
       where bank_account_id = $1 and amount > 0 and excluded_at is null
         and (txn_date, amount) in (select txn_date, amount from bank_statement_lines where bank_account_id = $1 and amount > 0 and excluded_at is null group by txn_date, amount having count(*) > 1)`, [bank.id]),
    // What customers owed when the books opened, from the opening balances.
    org.books_from ? one<{ owed: number }>(`select coalesce(sum(jl.debit - jl.credit), 0) as owed from journal_lines jl
       join journal_entries je on je.id = jl.entry_id join ledger_accounts a on a.id = jl.account_id
      where je.organisation_id = $1 and a.system_role = 'receivable' and je.entry_date <= $2`, [org.id, org.books_from]) : Promise.resolve(null),
    // The company's own people, on its client file: money from them is no sale.
    sql<{ name: string; roles: string[] }>(`select p.name, p.roles from client_people p join client_files f on f.id = p.file_id
      where f.organisation_id = $1 and p.roles && array['director', 'secretary', 'shareholder', 'beneficial_owner']`, [org.id]),
    // The latest date in each year's series of invoices raised from payments: one dated before it can't be numbered in date order.
    sql<{ year: string; latest: string }>(`select substr(number, length($3) + 1, 4) as year, max(issued_on)::text as latest from invoices
      where organisation_id = $1 and number like $2 || '%' group by 1`, [org.id, `${org.invoice_prefix.replace(/[\\%_]/g, "\\$&")}R`, `${org.invoice_prefix}R`]),
  ]);
  const shown = lines.slice(0, MAX_PAYMENTS);
  const since = shown.length ? addDays(shown[0].txn_date, -RECORDED_DAYS) : null;
  const [recordedPayments, latestRates, usualRate] = await Promise.all([
    // Payments recorded by hand on customers' invoices, into any account, that no bank line is matched to yet.
    since ? sql<{ received_on: string; amount: number; customer_id: string; number: string }>(`select p.received_on, p.amount, i.customer_id, i.number from invoice_payments p join invoices i on i.id = p.invoice_id
      where p.organisation_id = $1 and p.received_on >= $2 and not exists (select 1 from bank_line_matches m where m.invoice_payment_id = p.id)`, [org.id, since]) : Promise.resolve([]),
    // What each customer was charged last: a row for them starts at it.
    sql<{ customer_id: string; treatment: string; vat_rate: number }>(`select distinct on (i.customer_id) i.customer_id, i.vat_treatment::text as treatment, l.vat_rate
      from invoices i join invoice_lines l on l.invoice_id = i.id where i.organisation_id = $1 and i.status <> 'void' order by i.customer_id, i.issued_on desc, i.created_at desc, l.position`, [org.id]),
    // And the company's most usual rate, for a payer not kept yet.
    one<{ vat_rate: number }>(`select l.vat_rate from invoice_lines l join invoices i on i.id = l.invoice_id where i.organisation_id = $1 and i.status <> 'void' and i.vat_treatment = 'standard'
      group by l.vat_rate order by count(*) desc, l.vat_rate desc limit 1`, [org.id]),
  ]);
  // Where each is on the reconcile page, to open it there.
  const places = new Map((await sql<{ id: string; position: number }>(`select id, position from (
      select id, row_number() over (order by txn_date, created_at, id) as position from v_bank_statement_lines where bank_account_id = $1 and status in ('unmatched', 'partial')) ranked
     where id = any($2::uuid[])`, [bank.id, shown.map(line => line.id)])).map(row => [row.id, Number(row.position)]));
  // A customer is found by name and kind: John Smith isn't John Smith Ltd.
  const byKind = new Map(customers.map(customer => [kindKey(customer.name), customer]));
  const byKey = new Map(customers.map(customer => [nameKey(customer.name), customer]));
  const longestFirst = customers.map(customer => ({ customer, key: nameKey(customer.name) })).filter(item => item.key.length >= 4).sort((a, b) => b.key.length - a.key.length);
  const owes = new Map(owing.map(row => [row.customer_id, { invoices: Number(row.invoices), owed: Number(row.owed) }]));
  const twinKey = (line: Line) => `${line.txn_date}|${Number(line.amount).toFixed(2)}|${nameKey(payerName(line))}`;
  const twinCount = new Map<string, { count: number; matched: boolean }>();
  for (const line of twins) {
    const key = twinKey(line), seen = twinCount.get(key);
    twinCount.set(key, { count: (seen?.count ?? 0) + 1, matched: (seen?.matched ?? false) || line.matched });
  }
  const openingOwed = Number(opening?.owed ?? 0);
  const latestOf = new Map(latestRates.map(row => [row.customer_id, row]));
  const regime = regimeOf(org.country), rates: number[] = org.vat_registered ? [...regime.vatRates] : [0];
  const defaultRate = !org.vat_registered ? 0 : usualRate && rates.includes(Number(usualRate.vat_rate)) ? Number(usualRate.vat_rate) : standardRate(org.country);
  const money = (value: number) => formatAmount(value, org.currency);

  const payments = shown.map(line => {
    const amount = Number(line.amount);
    // The payer: a customer already kept when the bank names one, or when one's name is in its words; else the bank's words.
    const words = ` ${nameKey(`${line.description} ${line.counterparty ?? ""}`)} `;
    const named = payerName(line);
    // A customer of the same name, and the same kind (John Smith isn't John Smith Ltd), is theirs. One whose name is only
    // somewhere in the bank's words, or of another kind, may be: it is offered, to be checked.
    const exact = byKind.get(kindKey(named)) ?? null;
    const maybe = exact ? null : byKey.get(nameKey(named)) ?? longestFirst.find(item => words.includes(` ${item.key} `))?.customer ?? null;
    const known = exact ?? maybe;
    const payer = known?.name ?? named;
    const person = people.find(item => fromPerson(named, item.name));
    const latest = known ? latestOf.get(known.id) : undefined;
    const place = places.get(line.id);
    const href = `/accounts/bank/${bank.id}${place && place > LINES_PAGE ? `?page=${Math.ceil(place / LINES_PAGE)}` : ""}#line-${line.id}`;
    const locked = org.books_from && line.txn_date < org.books_from ? `Before the books begin, on ${formatDate(org.books_from)}.`
      : org.lock_date && line.txn_date <= org.lock_date ? "On or before the lock date: the books are closed for it." : null;
    const found = candidates.failed ? [] : suggestMatches({ date: line.txn_date, amount, description: line.description, reference: line.reference, counterparty: line.counterparty },
      { unreconciled, invoices: candidates.invoices, bills: [], examples: candidates.examples });
    const recorded = found.find(suggestion => suggestion.items.some(item => RECORDED.has(item.kind)));
    const pays = found.find(suggestion => suggestion.items.some(item => item.kind === "invoice"));
    const coded = found.find(suggestion => suggestion.items.some(item => item.kind === "receive"));
    const owed = known ? owes.get(known.id) : undefined;
    // A payment of theirs recorded by hand, the same amount, when the bank's date is weeks after the one written on it.
    const byHand = known ? recordedPayments.find(item => item.customer_id === known.id && Math.round(Number(item.amount) * 100) === Math.round(amount * 100)) : undefined;
    // A UK company's customer recorded as in Cyprus with no VAT number is the table's Cyprus, not the customer's: its sale would go out of scope.
    const misplaced = exact && org.country === "GB" && (exact.country === "CY" || !COUNTRIES.some(([code]) => code === exact.country)) && !exact.vat_number;
    const twin = twinCount.get(twinKey(line));
    const other = exact ? notASale({ description: withoutName(line.description, exact.name), reference: line.reference, counterparty: null }, payer, org.name) : notASale(line, payer, org.name);
    // The first that applies, each pointing to the reconcile page, where the payment is matched or coded instead.
    const note: { text: string; action: string | null; opening?: boolean } | null =
      recorded ? { text: `Already in the books: ${recorded.label.replace(/ · already recorded$/, "")}.`, action: "Match it" }
      : byHand ? { text: `Already in the books: ${money(Number(byHand.amount))} recorded on ${formatDate(byHand.received_on)} against ${byHand.number}.`, action: "Match it" }
      : pays ? { text: `${pays.confidence === "high" ? "Looks like it pays" : "Might pay"} ${pays.label}.`, action: "Match it" }
      : owed ? { text: `${known!.name} owes ${money(owed.owed)} on ${owed.invoices} invoice${owed.invoices === 1 ? "" : "s"} already: this may pay ${owed.invoices === 1 ? "it" : "some of them"}.`, action: "Match it" }
      : twin && twin.count > 1 ? { text: `Another line has the same day, amount and payer${twin.matched ? ", and is matched" : ""}: is the payment there twice?`, action: "Check it" }
      : coded ? { text: `Coded before as ${coded.label.replace(/^Received · /, "")}.`, action: "Code it" }
      : person ? { text: `From ${person.name}, ${person.roles.includes("director") ? "a director" : person.roles.includes("shareholder") || person.roles.includes("beneficial_owner") ? "a shareholder" : "the secretary"}: money from the company's own people isn't a sale.`, action: "Code it" }
      : other ? { text: `${other}.`, action: "Code it" }
      : openingOwed > 0 && org.books_from && line.txn_date <= addDays(org.books_from, OPENING_DEBTORS_DAYS)
        ? { text: `The books began on ${formatDate(org.books_from)} with customers owing ${money(openingOwed)}: this may pay one of those invoices, so it isn't a new sale.`, action: "Check it", opening: true }
      : misplaced ? { text: `${exact.name} is recorded as in ${exact.country === "CY" ? "Cyprus" : exact.country}, so this would be outside the scope of UK VAT: check the customer's country first.`, action: null }
      : maybe ? { text: `Is this ${maybe.name}? The bank says “${named}”: check before it is invoiced to them.`, action: null } : null;
    return {
      id: line.id, txn_date: line.txn_date, amount, bankText: line.description, reference: line.reference, counterparty: line.counterparty,
      payer, customerId: known?.id ?? null, description: paymentDescription(line), locked, note, href,
      // The VAT a row starts at: what the customer was charged last, else the company's usual rate.
      rate: latest?.treatment === "standard" && rates.includes(Number(latest.vat_rate)) ? Number(latest.vat_rate) : defaultRate,
      special: latest?.treatment === "exempt" || latest?.treatment === "outside_scope" ? latest.treatment as "exempt" | "outside_scope" : null,
      // Ticked to start with only when nothing says otherwise and the payer is a customer already: a new one is ticked by hand.
      ticked: !note && !locked && Boolean(known),
    };
  });
  return {
    org, bank, payments, total: lineId ? payments.length : Number(counts?.count ?? payments.length), closed: lineId ? 0 : Number(counts?.closed ?? 0), single: Boolean(lineId), customers,
    registered: org.vat_registered, rates, defaultRate,
    opening: openingOwed > 0 && org.books_from ? { date: org.books_from, owed: openingOwed } : null,
    lockDate: org.lock_date, currency: org.currency, country: org.country,
    latestRaised: Object.fromEntries(raised.map(row => [row.year, row.latest])),
  };
}
