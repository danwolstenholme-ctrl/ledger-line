"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { getFees, getPracticeBooks, monthName } from "@/lib/data/work";
import { firmToday, validRecordDate } from "@/lib/domain/invoices";
import { getCurrentUser, getPractice } from "@/lib/org";

/** The practice's own work: timers, time, each client's fee, and the month's fee invoices. */

function refresh() { revalidatePath("/", "layout"); }
const fail = (error: unknown, fallback: string): ActionState => ({ ok: false, error: describeDbError(asDbError(error), fallback) });
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "1:30", "1.5", "1,5", "90m" or "2h": a length of time, in minutes. */
function minutesOf(text: string | null) {
  const value = (text ?? "").trim().toLowerCase().replace(",", ".");
  let minutes: number | null = null;
  if (/^\d{1,2}:\d{2}$/.test(value)) { const [h, m] = value.split(":").map(Number); minutes = m < 60 ? h * 60 + m : null; }
  else if (/^\d+(\.\d+)?\s*h?$/.test(value)) minutes = Math.round(parseFloat(value) * 60);
  else if (/^\d+\s*m(in)?$/.test(value)) minutes = parseInt(value, 10);
  return minutes && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

async function company(id: string | null) {
  return id ? one<{ id: string }>("select id from organisations where id = $1", [id]) : null;
}

/** Start the clock on a client. A timer already running is stopped first: one person, one timer. */
export async function startTimer(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const org = await company(p.uuid("organisation_id"));
  const work = p.text("work", { required: true, max: 200, label: "What you are working on" });
  if (!org) return { ok: false, error: "Choose the client the time is for." };
  if (!work) return { ok: false, error: "Say what you are working on." };
  const user = await getCurrentUser();
  try {
    await transaction(async run => {
      await run(`update time_entries set ended_at = now(), minutes = greatest(1, least(1440, round(extract(epoch from now() - started_at) / 60)::int))
        where person = $1 and ended_at is null`, [user.name]);
      await run("insert into time_entries (organisation_id, person, work, started_at) values ($1, $2, $3, now())", [org.id, user.name, work]);
    });
  } catch (error) { return fail(error, "The timer could not be started."); }
  refresh();
  return { ok: true, error: null };
}

export async function stopTimer(): Promise<void> {
  const user = await getCurrentUser();
  await sql(`update time_entries set ended_at = now(), minutes = greatest(1, least(1440, round(extract(epoch from now() - started_at) / 60)::int))
    where person = $1 and ended_at is null`, [user.name]);
  refresh();
}

/** Time worked without a timer: a client, what it was, how long, and the day. */
export async function addTime(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const org = await company(p.uuid("organisation_id"));
  const work = p.text("work", { required: true, max: 200, label: "Work" });
  const minutes = minutesOf(p.text("duration", { max: 12 }));
  const on = p.text("on", { max: 10 }) ?? firmToday();
  if (!org) p.errors.organisation_id = "Choose the client.";
  if (!minutes) p.errors.duration = "Write it as 1:30, 1.5 or 90m.";
  if (!validRecordDate(on) || on > firmToday()) p.errors.on = "Choose a day, today or before.";
  if (p.failed || !org || !work || !minutes) return p.fail();
  const user = await getCurrentUser();
  const person = p.text("person", { max: 120 }) ?? user.name;
  try {
    await sql(`insert into time_entries (organisation_id, person, work, started_at, ended_at, minutes, extra)
      values ($1, $2, $3, ($4::date + time '09:00') at time zone 'Asia/Nicosia', ($4::date + time '09:00') at time zone 'Asia/Nicosia' + make_interval(mins => $5), $5, $6)`,
      [org.id, person, work, on, minutes, p.boolean("extra")]);
  } catch (error) { return fail(error, "The time could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** Time not yet on a fee invoice can be taken away; once billed, it stays. */
export async function deleteTime(form: FormData): Promise<void> {
  const id = new FormParser(form).uuid("id");
  if (id) await sql("delete from time_entries where id = $1 and invoice_id is null", [id]);
  refresh();
}

export async function saveClientFee(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const org = p.uuid("organisation_id");
  const fee = p.money("monthly_fee", "Monthly fee"), rate = p.money("hourly_rate", "Rate for extra work"), app = p.money("app_fee", "App fee");
  if (p.failed || !org) return p.fail();
  try { await sql("update client_fees set monthly_fee = coalesce($2, monthly_fee), hourly_rate = coalesce($3, hourly_rate), app_fee = coalesce($4, app_fee), updated_at = now() where organisation_id = $1", [org, fee, rate, app]); }
  catch (error) { return fail(error, "The fee could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

export async function saveFeeFloor(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const floor = p.money("fee_floor", "Floor");
  if (p.failed || floor === null) return p.fail();
  const practice = await getPractice();
  try { await sql("update practices set fee_floor = $2 where id = $1", [practice.id, floor]); }
  catch (error) { return fail(error, "The floor could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/**
 * Every client's fee for the month, invoiced in one press from the firm's own
 * books: the monthly fee, and any extra work logged and not yet billed, at
 * the client's rate, with 19% VAT. A client already invoiced for the month is
 * left alone, so pressing twice bills nobody twice.
 */
export async function raiseFees(_previous: ActionState, form: FormData): Promise<ActionState> {
  const period = String(form.get("period") ?? "");
  const data = await getFees(period);
  const books = await getPracticeBooks();
  if (!books) return { ok: false, error: "The firm's own books are not set up, so there is nowhere to invoice from." };
  if (data.month > firmToday()) return { ok: false, error: "A month that has not begun cannot be invoiced yet." };
  const account = await one<{ id: string }>("select id from ledger_accounts where organisation_id = $1 and system_role = 'sales'", [books.id]);
  if (!account) return { ok: false, error: "The firm's books have no sales account to post fees to." };
  const todo = data.rows.filter(row => !row.invoice && (row.monthly_fee > 0 || row.app_fee > 0 || row.extraUnbilled > 0));
  if (!todo.length) return { ok: false, error: `Every fee for ${monthName(data.month)} is already invoiced.` };
  const year = data.month.slice(0, 4), prefix = `${books.invoice_prefix}${year}-`;
  const issued = data.month, due = addDays(issued, books.payment_terms_days);
  const next = data.next;
  let raised = 0;
  try {
    await transaction(async run => {
      const [last] = await run<{ n: number | null }>("select max(substring(number from '(\\d+)$')::int) as n from invoices where organisation_id = $1 and number like $2", [books.id, `${prefix}%`]);
      let number = Number(last?.n ?? 0);
      for (const row of todo) {
        const extra = await run<{ minutes: number; works: string }>(`
          select coalesce(sum(minutes), 0) as minutes, string_agg(distinct work, ', ') as works from time_entries
           where organisation_id = $1 and extra and invoice_id is null and ended_at is not null
             and (started_at at time zone 'Asia/Nicosia')::date >= $2 and (started_at at time zone 'Asia/Nicosia')::date < $3`, [row.organisation_id, data.month, next]);
        const extraMinutes = Number(extra[0]?.minutes ?? 0);
        const lines: { description: string; account_id: string; net: number; vat_rate: number; vat_amount: number }[] = [];
        const line = (description: string, net: number) => lines.push({ description, account_id: account.id, net, vat_rate: 19, vat_amount: Math.round(net * 19) / 100 });
        if (row.monthly_fee > 0) line(`Accounting services, ${monthName(data.month)}`, row.monthly_fee);
        // Ledgerline, resold under the firm's name at the firm's own price.
        if (row.app_fee > 0) line(`Online books and invoicing, ${monthName(data.month)}`, row.app_fee);
        if (extraMinutes > 0) {
          const hours = Math.round(extraMinutes / 60 * 100) / 100;
          line(`Additional work, ${hours} hours at €${row.hourly_rate}: ${extra[0].works}`.slice(0, 300), Math.round(hours * row.hourly_rate * 100) / 100);
        }
        if (!lines.length) continue;
        number += 1;
        const [saved] = await run<{ id: string }>("select save_invoice($1, null, $2, $3, $4, $5, 'standard', null, $6::jsonb, 'issued', $7) as id",
          [books.id, row.customer_id, `${prefix}${String(number).padStart(4, "0")}`, issued, due, JSON.stringify(lines), `Fees ${monthName(data.month)}`]);
        await run("delete from fee_invoices where client_organisation_id = $1 and period = $2", [row.organisation_id, data.month]);
        await run("insert into fee_invoices (client_organisation_id, period, invoice_id) values ($1, $2, $3)", [row.organisation_id, data.month, saved.id]);
        await run(`update time_entries set invoice_id = $4 where organisation_id = $1 and extra and invoice_id is null and ended_at is not null
          and (started_at at time zone 'Asia/Nicosia')::date >= $2 and (started_at at time zone 'Asia/Nicosia')::date < $3`, [row.organisation_id, data.month, next, saved.id]);
        raised += 1;
      }
    });
  } catch (error) { return fail(error, "The fees could not be invoiced."); }
  refresh();
  redirect(`/fees?period=${data.month}&raised=${raised}`);
}
