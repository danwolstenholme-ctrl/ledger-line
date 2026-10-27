"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asDbError, one, sql, transaction } from "@/lib/db";
import { FormParser, describeDbError, type ActionState } from "@/lib/actions/form";
import { monthEnd, monthName, workOutMonth } from "@/lib/data/payroll";
import { compactIban, validIban } from "@/lib/domain/iban";
import { firmToday, validRecordDate } from "@/lib/domain/invoices";
import { getCurrentUser, orgPath, requireOrg } from "@/lib/org";

/**
 * Payroll: the employees, and each month's run. A run is worked out when it
 * is started and again whenever extra pay changes; approving it works it out
 * once more, posts it to the books and fixes it. Cyprus companies only.
 */

function refresh() { revalidatePath("/", "layout"); }
function failure(error: unknown, fallback: string): ActionState {
  const failed = asDbError(error);
  console.error("[payroll] save failed", failed.code);
  return { ok: false, error: describeDbError(failed, fallback) };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CYPRUS: ActionState = { ok: false, error: "Payroll here is Cyprus payroll. UK payroll, through HMRC’s RTI, is not in Ledgerline yet." };

function day(p: FormParser, name: string, label: string, required = false) {
  const value = p.text(name, { required, max: 10, label });
  if (value && !validRecordDate(value)) p.errors[name] = `${label} is not a valid date.`;
  return value;
}

const SLIP_COLUMNS = "organisation_id, run_id, employee_id, salary, other_pay, thirteenth, gross, insurable, si_employee, gesy_employee, paye, net, si_employer, gesy_employer, social_cohesion, redundancy, training";
type Run = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/** The run's payslips, replaced by those just worked out. Worked out before the transaction opens: the embedded database runs one at a time. */
async function writeSlips(run: Run, organisationId: string, runId: string, slips: Awaited<ReturnType<typeof workOutMonth>>) {
  await run("delete from payslips where run_id = $1", [runId]);
  for (const { employee, slip } of slips) {
    await run(`insert into payslips (${SLIP_COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [organisationId, runId, employee.id, slip.salary, slip.otherPay, slip.thirteenth, slip.gross, slip.insurable, slip.si_employee, slip.gesy_employee, slip.paye, slip.net,
        slip.si_employer, slip.gesy_employer, slip.social_cohesion, slip.redundancy, slip.training]);
  }
}
const extrasOf = async (runId: string) =>
  new Map((await sql<{ employee_id: string; other_pay: number }>("select employee_id, other_pay from payslips where run_id = $1", [runId])).map(row => [row.employee_id, Number(row.other_pay)]));
const draftRun = (id: string, organisationId: string) =>
  one<{ period: string; status: string }>("select to_char(period, 'YYYY-MM-DD') as period, status from payroll_runs where id = $1 and organisation_id = $2", [id, organisationId]);

export async function saveEmployee(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  if (org.country !== "CY") return NOT_CYPRUS;
  const p = new FormParser(form);
  const id = p.uuid("id");
  const name = p.text("name", { required: true, max: 200, label: "Name" });
  const email = p.text("email", { max: 320, label: "Email" }), jobTitle = p.text("job_title", { max: 120, label: "Job title" });
  const tic = p.text("tic", { max: 20, label: "Tax identification" }), si = p.text("social_insurance_no", { max: 20, label: "Social insurance number" });
  const document = p.text("id_document", { max: 40, label: "ID or passport" });
  const born = day(p, "date_of_birth", "Date of birth"), start = day(p, "start_date", "Start date", true), leave = day(p, "leave_date", "Leaving date");
  if (start && leave && leave < start) p.errors.leave_date = "The leaving date can’t be before the start date.";
  const salary = p.money("monthly_salary", "Monthly salary");
  if (salary === null && !p.errors.monthly_salary) p.errors.monthly_salary = "Write the gross monthly salary.";
  const iban = p.text("iban", { max: 40, label: "IBAN" });
  if (iban && !validIban(iban)) p.errors.iban = "That IBAN is not in the right form.";
  const deductions = p.money("annual_deductions", "Deductions") ?? 0, exemption = p.money("annual_exemption", "Exempt pay") ?? 0;
  const ytd = [p.money("ytd_gross", "Gross pay so far") ?? 0, p.money("ytd_insurable", "Insurable earnings so far") ?? 0, p.money("ytd_si", "Social insurance so far") ?? 0,
    p.money("ytd_gesy", "GESY so far") ?? 0, p.money("ytd_tax", "Tax withheld so far") ?? 0];
  // The year brought forward: this year unless said, and none when nothing is.
  const year = Number(String(form.get("ytd_year") ?? "")) || Number(firmToday().slice(0, 4));
  if (year < 2000 || year > 2100) p.errors.ytd_year = "Write the tax year, such as 2026.";
  if (p.failed || !name || !start || salary === null) return p.fail();
  const values = [name, email, jobTitle, tic, si, document, born, start, leave, salary, p.boolean("thirteenth_salary"), iban ? compactIban(iban) : null, deductions, exemption,
    ytd.some(Boolean) ? year : null, ...ytd];
  let saved: string | undefined;
  try {
    saved = id
      ? (await one<{ id: string }>(`update employees set name = $3, email = $4, job_title = $5, tic = $6, social_insurance_no = $7, id_document = $8, date_of_birth = $9, start_date = $10, leave_date = $11,
          monthly_salary = $12, thirteenth_salary = $13, iban = $14, annual_deductions = $15, annual_exemption = $16, ytd_year = $17, ytd_gross = $18, ytd_insurable = $19, ytd_si = $20, ytd_gesy = $21, ytd_tax = $22,
          updated_at = now() where id = $1 and organisation_id = $2 returning id`, [id, org.id, ...values]))?.id
      : (await one<{ id: string }>(`insert into employees (organisation_id, name, email, job_title, tic, social_insurance_no, id_document, date_of_birth, start_date, leave_date, monthly_salary, thirteenth_salary, iban,
          annual_deductions, annual_exemption, ytd_year, ytd_gross, ytd_insurable, ytd_si, ytd_gesy, ytd_tax) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          returning id`, [org.id, ...values]))?.id;
  } catch (error) { return failure(error, "The employee could not be saved."); }
  if (!saved) return { ok: false, error: "That employee could not be found. Reload and try again." };
  refresh();
  redirect(await orgPath("/accounts/payroll"));
}

/** Start a month: every employee's payslip worked out, as a draft to look over. */
export async function startPayrollRun(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  if (org.country !== "CY") return NOT_CYPRUS;
  const period = String(form.get("period") ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(period)) return { ok: false, error: "Choose the month to run." };
  const user = await getCurrentUser();
  let id: string | undefined;
  try {
    const slips = await workOutMonth(org.id, period);
    id = await transaction(async run => {
      const made = await run<{ id: string }>("insert into payroll_runs (organisation_id, period, pay_date, created_by) values ($1, $2, $3, $4) on conflict (organisation_id, period) do nothing returning id",
        [org.id, period, monthEnd(period), user.name]);
      if (!made[0]) return undefined;
      await writeSlips(run, org.id, made[0].id, slips);
      return made[0].id;
    });
  } catch (error) { return failure(error, "The month could not be worked out."); }
  if (!id) return { ok: false, error: `${monthName(period)}’s payroll is already started. Open it from the list.` };
  refresh();
  redirect(await orgPath(`/accounts/payroll/${id}`));
}

/** Extra pay this month for one employee (overtime, a bonus, commission): the draft worked out again. */
export async function setOtherPay(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  if (org.country !== "CY") return NOT_CYPRUS;
  const p = new FormParser(form);
  const runId = p.uuid("run_id"), employee = p.uuid("employee_id");
  const amount = p.money("other_pay", "Extra pay") ?? 0;
  if (!employee && !p.errors.employee_id) p.errors.employee_id = "Choose who it is for.";
  if (p.failed || !runId || !employee) return p.fail();
  const run = await draftRun(runId, org.id);
  if (!run) return { ok: false, error: "That run could not be found." };
  if (run.status !== "draft") return { ok: false, error: "This run is posted, so it can’t change. Add the extra pay to next month’s." };
  try {
    const extras = await extrasOf(runId);
    extras.set(employee, amount);
    const slips = await workOutMonth(org.id, run.period, extras);
    await transaction(tx => writeSlips(tx, org.id, runId, slips));
  } catch (error) { return failure(error, "The run could not be worked out again."); }
  refresh();
  return { ok: true, error: null };
}

/** Approve a run: worked out once more, posted to the books on its pay date, and fixed from then on. */
export async function approvePayrollRun(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  if (org.country !== "CY") return NOT_CYPRUS;
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { ok: false, error: "That run could not be found." };
  const run = await draftRun(id, org.id);
  if (!run) return { ok: false, error: "That run could not be found." };
  if (run.status !== "draft") return { ok: false, error: "This run is already posted." };
  const user = await getCurrentUser();
  try {
    const slips = await workOutMonth(org.id, run.period, await extrasOf(id));
    await transaction(async tx => {
      await writeSlips(tx, org.id, id, slips);
      const totals = (await tx<{ people: number; gross: number; net: number }>("select count(*) as people, coalesce(sum(gross), 0) as gross, coalesce(sum(net), 0) as net from payslips where run_id = $1", [id]))[0];
      if (!Number(totals?.people)) throw Object.assign(new Error("payroll_empty"), { code: "P0001" });
      await tx("update payroll_runs set status = 'posted', posted_at = now(), posted_by = $2 where id = $1", [id, user.name]);
      await tx("select post_payroll_run($1)", [id]);
      await tx("select audit_append($1, 'posted', 'payroll_run', $2, $3::jsonb)", [org.id, id, JSON.stringify({ period: monthName(run.period), people: Number(totals.people), gross: Number(totals.gross), net: Number(totals.net) })]);
    });
  } catch (error) {
    if (asDbError(error).message === "payroll_empty") return { ok: false, error: "Nobody is employed in this month, so there is nothing to post." };
    return failure(error, "The run could not be posted.");
  }
  refresh();
  return { ok: true, error: null, notice: "Posted to the books." };
}

/** Throw a draft away. A posted run stays: it is in the books and the year so far. */
export async function deletePayrollRun(_previous: ActionState, form: FormData): Promise<ActionState> {
  const org = await requireOrg();
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return { ok: false, error: "That run could not be found." };
  try {
    const gone = await one<{ id: string }>("delete from payroll_runs where id = $1 and organisation_id = $2 and status = 'draft' returning id", [id, org.id]);
    if (!gone) return { ok: false, error: "Only a draft can be deleted. This run is posted." };
  } catch (error) { return failure(error, "The draft could not be deleted."); }
  refresh();
  redirect(await orgPath("/accounts/payroll"));
}
