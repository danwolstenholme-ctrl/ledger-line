"use server";

import { revalidatePath } from "next/cache";

import { asDbError, one, sql } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { getYearEnd } from "@/lib/data/year-end";
import { OPINIONS, type Opinion } from "@/lib/domain/audit";
import { firmToday, validRecordDate } from "@/lib/domain/invoices";
import { getMembership, requireOrg } from "@/lib/org";

/**
 * A company's year end, recorded by the practice: audit or review and the
 * figures the books can't know, the dates of each step, and the facts about
 * the company that company law turns on. Each change goes on the audit trail.
 */

function refresh() { revalidatePath("/", "layout"); }
function failure(error: unknown, fallback: string): ActionState {
  const failed = asDbError(error);
  console.error("[year-end] save failed", failed.code);
  return { ok: false, error: describeDbError(failed, fallback) };
}
const long = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function day(p: FormParser, name: string, label: string) {
  const value = p.text(name, { max: 10, label });
  if (!value) return null;
  if (!validRecordDate(value)) p.errors[name] = `${label} is not a valid date.`;
  else if (value > firmToday()) p.errors[name] = `${label} can’t be in the future.`;
  return value;
}

async function practiceOnly(): Promise<ActionState | null> {
  return (await getMembership()).practice ? null : { ok: false, error: "The practice records the year end. Ask them to change it." };
}

const DATE_STEPS = [
  ["sent_to_auditor_on", "Sent to the auditor"], ["approved_on", "Approved by the board"], ["report_signed_on", "Report signed"],
  ["agm_on", "Annual general meeting"], ["filed_on", "Filed with the Registrar"], ["tax_return_filed_on", "Tax return filed"],
] as const;

/** The dates of the year's steps, and the auditor's opinion. */
export async function saveYearEndDates(_previous: ActionState, form: FormData): Promise<ActionState> {
  const refused = await practiceOnly();
  if (refused) return refused;
  const p = new FormParser(form);
  const data = await getYearEnd(String(form.get("period_end") ?? ""));
  if (data.periodEnd !== form.get("period_end")) return { ok: false, error: "That financial year could not be found. Reload and try again." };
  const dates = Object.fromEntries(DATE_STEPS.map(([key, label]) => [key, day(p, key, label)])) as Record<(typeof DATE_STEPS)[number][0], string | null>;
  const opinion = p.enum<Opinion>("opinion", Object.keys(OPINIONS) as Opinion[], { label: "Opinion" });
  const notes = p.text("notes", { max: 2000, label: "Notes" });
  const auditor = data.assurance === "review" ? "reviewer" : "auditor";
  for (const [key, label] of DATE_STEPS) if (dates[key] && dates[key]! <= data.periodEnd) p.errors[key] = `${label} must be after the year end, ${long(data.periodEnd)}.`;
  if (dates.report_signed_on && !opinion) p.errors.opinion = `Say what the ${auditor}’s ${data.assurance === "review" ? "conclusion" : "opinion"} was.`;
  if (opinion && !dates.report_signed_on) p.errors.report_signed_on = "Give the date the report was signed.";
  if (dates.report_signed_on && dates.approved_on && dates.report_signed_on < dates.approved_on) p.errors.report_signed_on = "The report can’t be dated before the board approved the financial statements.";
  if (dates.report_signed_on && dates.sent_to_auditor_on && dates.report_signed_on < dates.sent_to_auditor_on) p.errors.report_signed_on = `The report can’t be signed before the ${auditor} had the financial statements.`;
  if (dates.agm_on && !dates.report_signed_on) p.errors.agm_on = "The financial statements laid before the meeting are the signed ones: record the report first.";
  else if (dates.agm_on && dates.report_signed_on && dates.agm_on < dates.report_signed_on) p.errors.agm_on = "The meeting can’t be before the report was signed.";
  if (dates.filed_on && !dates.report_signed_on) p.errors.filed_on = "The Registrar takes the signed financial statements: record the report first.";
  else if (dates.filed_on && dates.report_signed_on && dates.filed_on < dates.report_signed_on) p.errors.filed_on = "They can’t be filed before the report was signed.";
  if (p.failed) return p.fail();

  const before = data.row;
  const changes: string[] = [];
  for (const [key, label] of DATE_STEPS) if ((before?.[key] ?? null) !== dates[key]) changes.push(dates[key] ? `${label}: ${long(dates[key]!)}` : `${label}: cleared`);
  if ((before?.opinion ?? null) !== opinion && opinion) changes.push(`Opinion: ${OPINIONS[opinion]}`);
  try {
    const saved = await one<{ id: string }>(`
      insert into year_ends (organisation_id, period_end, assurance, sent_to_auditor_on, approved_on, report_signed_on, opinion, agm_on, filed_on, tax_return_filed_on, notes, updated_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, (select name from app_users where id = app_user_id()))
      on conflict (organisation_id, period_end) do update set sent_to_auditor_on = excluded.sent_to_auditor_on, approved_on = excluded.approved_on, report_signed_on = excluded.report_signed_on,
        opinion = excluded.opinion, agm_on = excluded.agm_on, filed_on = excluded.filed_on, tax_return_filed_on = excluded.tax_return_filed_on, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = now()
      returning id`,
      [data.org.id, data.periodEnd, data.assurance, dates.sent_to_auditor_on, dates.approved_on, dates.report_signed_on, opinion, dates.agm_on, dates.filed_on, dates.tax_return_filed_on, notes]);
    if (changes.length) await sql("select audit_append($1, 'updated', 'year_end', $2, $3::jsonb)", [data.org.id, saved!.id, JSON.stringify({ period_end: data.periodEnd, changes })]);
  } catch (error) { return failure(error, "The year end could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** Audit or review, and the figures the books can't know: the months before them, the year before, the people employed. */
export async function saveYearEndFigures(_previous: ActionState, form: FormData): Promise<ActionState> {
  const refused = await practiceOnly();
  if (refused) return refused;
  const p = new FormParser(form);
  const period = String(form.get("period_end") ?? "");
  const current = await getYearEnd(period);
  if (current.periodEnd !== period) return { ok: false, error: "That financial year could not be found. Reload and try again." };
  const assurance = p.enum("assurance", ["audit", "review"] as const, { fallback: "audit", label: "Audit or review" })!;
  const employees = p.text("average_employees", { max: 6, label: "Average employees" });
  if (employees && !/^\d{1,5}$/.test(employees)) p.errors.average_employees = "Average employees must be a whole number.";
  const turnoverBefore = current.startsBeforeBooks ? p.money("turnover_before_books", "Turnover before the books") : null;
  const priorTurnover = current.priorInBooks ? null : p.money("prior_turnover", "The year before’s turnover");
  const priorAssets = current.priorInBooks ? null : p.money("prior_total_assets", "The year before’s total assets");
  if (p.failed) return p.fail();

  const values = { turnover_before_books: turnoverBefore, prior_turnover: priorTurnover, prior_total_assets: priorAssets, average_employees: employees === null ? null : Number(employees) };
  let saved: { id: string } | null;
  try {
    saved = await one<{ id: string }>(`
      insert into year_ends (organisation_id, period_end, assurance, average_employees, turnover_before_books, prior_turnover, prior_total_assets, updated_by)
      values ($1, $2, 'audit', $3, $4, $5, $6, (select name from app_users where id = app_user_id()))
      on conflict (organisation_id, period_end) do update set average_employees = excluded.average_employees, turnover_before_books = excluded.turnover_before_books,
        prior_turnover = excluded.prior_turnover, prior_total_assets = excluded.prior_total_assets, updated_by = excluded.updated_by, updated_at = now()
      returning id`, [current.org.id, period, values.average_employees, values.turnover_before_books, values.prior_turnover, values.prior_total_assets]);
  } catch (error) { return failure(error, "The figures could not be saved."); }

  // A review only where the law allows it, judged on the figures just saved.
  const data = await getYearEnd(period);
  if (assurance === "review" && data.review.allowed !== true) {
    refresh();
    return { ok: false, error: data.review.allowed === false ? "This year must be audited: it is outside what a review allows (see the reasons)." : "A review needs both years’ turnover and total assets: enter the ones Ledgerline doesn’t have." };
  }
  const changes: string[] = [];
  if (assurance !== current.assurance) changes.push(assurance === "review" ? "Review under ISRE 2400 instead of an audit" : "Audit");
  const before = current.row;
  if ((before?.average_employees ?? null) !== values.average_employees) changes.push(`Average employees: ${values.average_employees ?? "cleared"}`);
  for (const [key, label] of [["turnover_before_books", "Turnover before the books"], ["prior_turnover", "The year before’s turnover"], ["prior_total_assets", "The year before’s total assets"]] as const) {
    const was = before?.[key] === null || before?.[key] === undefined ? null : Number(before[key]);
    if (was !== values[key]) changes.push(`${label}: ${values[key] === null ? "cleared" : `€${values[key]!.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`}`);
  }
  try {
    await sql("update year_ends set assurance = $2 where id = $1", [saved!.id, assurance]);
    if (changes.length) await sql("select audit_append($1, 'updated', 'year_end', $2, $3::jsonb)", [data.org.id, saved!.id, JSON.stringify({ period_end: period, changes })]);
  } catch (error) { return failure(error, "The year end could not be saved."); }
  refresh();
  return { ok: true, error: null };
}

/** What company law turns on: when the company was incorporated, who audits it, and whether it is regulated or part of a group. */
export async function saveCompanyLaw(_previous: ActionState, form: FormData): Promise<ActionState> {
  const refused = await practiceOnly();
  if (refused) return refused;
  const org = await requireOrg();
  const p = new FormParser(form);
  const incorporated = day(p, "incorporated_on", "Incorporated on");
  const auditor = p.text("auditor_name", { max: 160, label: "Auditor" });
  const practiceAudits = p.boolean("auditor_is_practice"), regulated = p.boolean("regulated"), group = p.boolean("consolidated_group");
  if (p.failed) return p.fail();
  try {
    await sql("update organisations set incorporated_on = $2, auditor_name = $3, auditor_is_practice = $4, regulated = $5, consolidated_group = $6 where id = $1",
      [org.id, incorporated, auditor, practiceAudits, regulated, group]);
  } catch (error) { return failure(error, "The company’s details could not be saved."); }
  refresh();
  return { ok: true, error: null };
}
