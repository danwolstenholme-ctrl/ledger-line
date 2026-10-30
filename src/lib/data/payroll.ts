import "server-only";

import { one, sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { NO_YEAR, addToYear, cyMonth, toSocialInsurance, type Payslip, type YearToDate } from "@/lib/domain/payroll-cy";
import { requireOrg } from "@/lib/org";
import { companyAccent } from "./document-styles";

/**
 * A company's payroll: its employees, each month's run, and the payslips in
 * it. A month is worked out from each employee's pay and the year so far:
 * what was brought forward from the payroll before Ledgerline, and every run
 * posted since.
 */

export type EmployeeRow = {
  id: string; organisation_id: string; name: string; email: string | null; job_title: string | null; tic: string | null; social_insurance_no: string | null;
  id_document: string | null; date_of_birth: string | null; start_date: string; leave_date: string | null; monthly_salary: number; thirteenth_salary: boolean; iban: string | null;
  annual_deductions: number; annual_exemption: number; ytd_year: number | null; ytd_gross: number; ytd_insurable: number; ytd_si: number; ytd_gesy: number; ytd_tax: number;
};
export type PayrollRunRow = { id: string; organisation_id: string; period: string; pay_date: string; status: "draft" | "posted"; posted_at: string | null; posted_by: string | null; created_by: string | null };
export type PayslipRow = Payslip & { id: string; run_id: string; employee_id: string; name: string; job_title: string | null; tic: string | null; social_insurance_no: string | null; id_document: string | null; iban: string | null };

const EMPLOYEE = `id, organisation_id, name, email, job_title, tic, social_insurance_no, id_document, to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth,
  to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(leave_date, 'YYYY-MM-DD') as leave_date, monthly_salary, thirteenth_salary, iban,
  annual_deductions, annual_exemption, ytd_year, ytd_gross, ytd_insurable, ytd_si, ytd_gesy, ytd_tax`;
const RUN = `id, organisation_id, to_char(period, 'YYYY-MM-DD') as period, to_char(pay_date, 'YYYY-MM-DD') as pay_date, status, posted_at, posted_by, created_by`;
const n = (value: unknown) => Number(value ?? 0);

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
export const monthEnd = (period: string) => iso(Number(period.slice(0, 4)), Number(period.slice(5, 7)) + 1, 0);
export const monthName = (period: string) => new Date(`${period}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** Social insurance, GESY and the tax withheld are paid, and the monthly TD7 filed, by the end of the following month. */
export const payrollDue = (period: string) => monthEnd(iso(Number(period.slice(0, 4)), Number(period.slice(5, 7)) + 1, 1));

export async function getEmployees() {
  const org = await requireOrg();
  return sql<EmployeeRow>(`select ${EMPLOYEE} from employees where organisation_id = $1 order by leave_date is not null, name`, [org.id]);
}
export async function getEmployee(id: string) {
  const org = await requireOrg();
  return one<EmployeeRow>(`select ${EMPLOYEE} from employees where id = $1 and organisation_id = $2`, [id, org.id]);
}

export async function getPayroll() {
  const org = await requireOrg();
  const [employees, runs] = await Promise.all([
    getEmployees(),
    sql<PayrollRunRow & { people: number; gross: number; net: number; employer: number; paye: number; social: number }>(`
      select r.id, r.organisation_id, to_char(r.period, 'YYYY-MM-DD') as period, to_char(r.pay_date, 'YYYY-MM-DD') as pay_date, r.status, r.posted_at, r.posted_by, r.created_by,
             count(p.id) as people, coalesce(sum(p.gross), 0) as gross, coalesce(sum(p.net), 0) as net, coalesce(sum(p.paye), 0) as paye,
             coalesce(sum(p.si_employer + p.gesy_employer + p.social_cohesion + p.redundancy + p.training), 0) as employer,
             coalesce(sum(p.si_employee + p.gesy_employee + p.si_employer + p.gesy_employer + p.social_cohesion + p.redundancy + p.training), 0) as social
        from payroll_runs r left join payslips p on p.run_id = r.id where r.organisation_id = $1 group by r.id order by r.period desc`, [org.id]),
  ]);
  const today = firmToday();
  const latest = runs[0]?.period ?? null;
  // The next month to run: the one after the last, or this month.
  const next = latest ? iso(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) + 1, 1) : `${today.slice(0, 7)}-01`;
  return { org, today, employees, runs: runs.map(run => ({ ...run, people: n(run.people), gross: n(run.gross), net: n(run.net), employer: n(run.employer), paye: n(run.paye), social: n(run.social) })), next };
}

export async function getPayrollRun(id: string) {
  const org = await requireOrg();
  const run = await one<PayrollRunRow>(`select ${RUN} from payroll_runs where id = $1 and organisation_id = $2`, [id, org.id]);
  if (!run) return null;
  const slips = await sql<PayslipRow>(`
    select p.id, p.run_id, p.employee_id, p.salary, p.other_pay as "otherPay", p.thirteenth, p.gross, p.insurable, p.si_employee, p.gesy_employee, p.paye, p.net,
           p.si_employer, p.gesy_employer, p.social_cohesion, p.redundancy, p.training, e.name, e.job_title, e.tic, e.social_insurance_no, e.id_document, e.iban
      from payslips p join employees e on e.id = p.employee_id where p.run_id = $1 order by e.name`, [id]);
  const sum = (pick: (slip: PayslipRow) => number) => Math.round(slips.reduce((total, slip) => total + pick(slip), 0) * 100) / 100;
  const totals = {
    gross: sum(slip => slip.gross), net: sum(slip => slip.net), paye: sum(slip => slip.paye),
    employee: sum(slip => slip.si_employee + slip.gesy_employee), siEmployee: sum(slip => slip.si_employee), gesyEmployee: sum(slip => slip.gesy_employee), employer: sum(slip => slip.si_employer + slip.gesy_employer + slip.social_cohesion + slip.redundancy + slip.training),
    social: sum(slip => toSocialInsurance(slip)), si: sum(slip => slip.si_employee + slip.si_employer), gesy: sum(slip => slip.gesy_employee + slip.gesy_employer),
    funds: sum(slip => slip.social_cohesion + slip.redundancy + slip.training),
  };
  return { org, run, slips, totals, due: payrollDue(run.period), today: firmToday() };
}

/**
 * Each employee's tax year before a month: what was brought forward from the
 * payroll before Ledgerline, and every run posted since, up to that month.
 */
export async function yearSoFar(organisationId: string, period: string) {
  const year = Number(period.slice(0, 4));
  const [employees, posted] = await Promise.all([
    sql<Pick<EmployeeRow, "id" | "ytd_year" | "ytd_gross" | "ytd_insurable" | "ytd_si" | "ytd_gesy" | "ytd_tax">>("select id, ytd_year, ytd_gross, ytd_insurable, ytd_si, ytd_gesy, ytd_tax from employees where organisation_id = $1", [organisationId]),
    sql<{ employee_id: string; gross: number; insurable: number; si: number; gesy: number; tax: number; thirteenth: number }>(`
      select p.employee_id, sum(p.gross) as gross, sum(p.insurable) as insurable, sum(p.si_employee) as si, sum(p.gesy_employee) as gesy, sum(p.paye) as tax, sum(p.thirteenth) as thirteenth
        from payslips p join payroll_runs r on r.id = p.run_id
       where r.organisation_id = $1 and r.status = 'posted' and r.period >= $2 and r.period < $3 group by p.employee_id`, [organisationId, iso(year, 1, 1), period]),
  ]);
  return new Map(employees.map(employee => {
    const brought: YearToDate = employee.ytd_year === year
      ? { gross: n(employee.ytd_gross), insurable: n(employee.ytd_insurable), si: n(employee.ytd_si), gesy: n(employee.ytd_gesy), tax: n(employee.ytd_tax) } : NO_YEAR;
    const runs = posted.find(row => row.employee_id === employee.id);
    const ytd = runs ? addToYear(brought, { gross: n(runs.gross), insurable: n(runs.insurable), si_employee: n(runs.si), gesy_employee: n(runs.gesy), paye: n(runs.tax) } as Payslip) : brought;
    return [employee.id, { ytd, thirteenthPaid: n(runs?.thirteenth) > 0 }];
  }));
}

/**
 * A month's payslips, worked out: everyone employed in it, their pay for the
 * days they worked, the 13th salary in December, and income tax on the year
 * so far. `otherPay`: extra pay this month, by employee.
 */
export async function workOutMonth(organisationId: string, period: string, otherPay: Map<string, number> = new Map()) {
  const [employees, before] = await Promise.all([
    sql<EmployeeRow>(`select ${EMPLOYEE} from employees where organisation_id = $1 and start_date <= $2 and (leave_date is null or leave_date >= $3) order by name`, [organisationId, monthEnd(period), period]),
    yearSoFar(organisationId, period),
  ]);
  return employees.map(employee => {
    const { ytd, thirteenthPaid } = before.get(employee.id) ?? { ytd: NO_YEAR, thirteenthPaid: false };
    const slip = cyMonth({ ...employee, monthly_salary: n(employee.monthly_salary), annual_deductions: n(employee.annual_deductions), annual_exemption: n(employee.annual_exemption) },
      period, ytd, { otherPay: otherPay.get(employee.id) ?? 0, thirteenthPaid });
    return { employee, slip };
  });
}

/** A run's payslips as they are printed: each with the employee's details and their year to date through this month. */
export async function getPayslipDocuments(id: string) {
  const data = await getPayrollRun(id);
  if (!data) return null;
  const before = await yearSoFar(data.org.id, data.run.period);
  // In the company's colour: its default document style's.
  return { ...data, accent: await companyAccent(data.org.id), slips: data.slips.map(slip => ({ ...slip, ytd: addToYear(before.get(slip.employee_id)?.ytd ?? NO_YEAR, slip) })) };
}

/**
 * A tax year's payroll, employee by employee, for the employer's annual
 * return (TD7) and each employee's certificate of pay and tax (TD63): what
 * was brought forward and every posted run.
 */
export async function getPayrollYear(year: number) {
  const org = await requireOrg();
  const [employees, runs] = await Promise.all([
    sql<EmployeeRow>(`select ${EMPLOYEE} from employees where organisation_id = $1 order by name`, [org.id]),
    sql<{ employee_id: string; months: number; gross: number; thirteenth: number; insurable: number; si: number; gesy: number; tax: number; employer: number }>(`
      select p.employee_id, count(*) as months, sum(p.gross) as gross, sum(p.thirteenth) as thirteenth, sum(p.insurable) as insurable, sum(p.si_employee) as si, sum(p.gesy_employee) as gesy, sum(p.paye) as tax,
             sum(p.si_employer + p.gesy_employer + p.social_cohesion + p.redundancy + p.training) as employer
        from payslips p join payroll_runs r on r.id = p.run_id
       where r.organisation_id = $1 and r.status = 'posted' and r.period >= $2 and r.period <= $3 group by p.employee_id`, [org.id, iso(year, 1, 1), iso(year, 12, 1)]),
  ]);
  const rows = employees.map(employee => {
    const run = runs.find(row => row.employee_id === employee.id);
    const brought = employee.ytd_year === year;
    const add = (a: number, b: unknown) => Math.round((a + n(b)) * 100) / 100;
    return {
      employee, months: n(run?.months), brought,
      gross: add(brought ? n(employee.ytd_gross) : 0, run?.gross), insurable: add(brought ? n(employee.ytd_insurable) : 0, run?.insurable),
      si: add(brought ? n(employee.ytd_si) : 0, run?.si), gesy: add(brought ? n(employee.ytd_gesy) : 0, run?.gesy), tax: add(brought ? n(employee.ytd_tax) : 0, run?.tax),
      thirteenth: n(run?.thirteenth), employer: n(run?.employer),
    };
  }).filter(row => row.gross > 0);
  return { org, year, rows };
}
