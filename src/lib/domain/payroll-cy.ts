/**
 * Cyprus payroll: what comes off an employee's pay and what the employer adds,
 * for one month. Client-safe. Checked on 27 Oct 2026 against PwC Tax
 * Summaries (personal income tax, other taxes, deductions) and KPMG Cyprus
 * (2026 maximum insurable earnings), and the Ministry of Labour's instructions
 * on 13th salaries.
 *
 * - Social insurance: 8.8% from the employee and 8.8% from the employer, on
 *   earnings up to the month's maximum: €5,551 in 2025, €5,742 in 2026. A 13th
 *   salary is declared on its own, against the year's maximum: nothing is
 *   insurable once the year's regular pay has reached it.
 * - On the same insurable earnings, the employer pays the Redundancy Fund
 *   (1.2%) and the Human Resource Development fund (0.5%).
 * - GESY (the General Healthcare System): 2.65% from the employee, 2.9% from
 *   the employer, on all pay, up to €180,000 a year.
 * - The Social Cohesion Fund: 2% from the employer, on all pay, no maximum.
 * - Income tax (PAYE): the year's tax on the year's chargeable income,
 *   withheld in proportion to the pay so far. Social insurance and GESY are
 *   deductible, up to a fifth of income; so is what the employee declares on
 *   form TD59 (from 2026: children, the interest or rent on their home, and
 *   the rest), and any exempt part of their pay.
 * - Central Holiday Fund: most employers are exempt, running their own leave;
 *   not included.
 */

type Band = readonly [upTo: number, rate: number];
const BANDS: Record<"2025" | "2026", readonly Band[]> = {
  "2025": [[19_500, 0], [28_000, 20], [36_300, 25], [60_000, 30], [Infinity, 35]],
  "2026": [[22_000, 0], [32_000, 20], [42_000, 25], [72_000, 30], [Infinity, 35]],
};
const CEILING: Record<number, number> = { 2025: 5_551, 2026: 5_742 };

export const CY_RATES = { si: 8.8, gesyEmployee: 2.65, gesyEmployer: 2.9, gesyCap: 180_000, socialCohesion: 2, redundancy: 1.2, training: 0.5 } as const;
/** The month's maximum insurable earnings: the latest known year's after it. */
export const siCeiling = (year: number) => CEILING[year] ?? CEILING[Math.max(...Object.keys(CEILING).map(Number).filter(known => known <= year))] ?? CEILING[2026];

const round = (value: number) => Math.round(value * 100) / 100;
const pct = (base: number, rate: number) => round(base * rate / 100);

/** The tax on a year's chargeable income: 2026's bands from 2026 (tax-free to €22,000), 2025's before. */
export function cyIncomeTax(chargeable: number, year: number) {
  let tax = 0, lower = 0;
  for (const [upTo, rate] of BANDS[year >= 2026 ? "2026" : "2025"]) {
    if (chargeable > lower) tax += (Math.min(chargeable, upTo) - lower) * rate / 100;
    lower = upTo;
  }
  return round(tax);
}

/** What the year has paid so far, before this month: gross pay, insurable earnings, the employee's contributions and the tax withheld. */
export type YearToDate = { gross: number; insurable: number; si: number; gesy: number; tax: number };
export const NO_YEAR: YearToDate = { gross: 0, insurable: 0, si: 0, gesy: 0, tax: 0 };

export type PayInput = {
  year: number; month: number;
  /** The monthly salary, other pay this month (overtime, a bonus), and the 13th salary if paid this month. */
  salary: number; otherPay: number; thirteenth: number;
  /** The months still to be paid in the year after this one, and the 13th salary still to come, for the year's projection. */
  monthsLeft: number; thirteenthToCome: number;
  ytd: YearToDate;
  /** Declared on TD59: the year's deductions, and the exempt part of the year's pay. */
  annualDeductions: number; annualExemption: number;
};

export type Payslip = {
  salary: number; otherPay: number; thirteenth: number; gross: number; insurable: number;
  si_employee: number; gesy_employee: number; paye: number; net: number;
  si_employer: number; gesy_employer: number; social_cohesion: number; redundancy: number; training: number;
};

export function cyPayslip(input: PayInput): Payslip {
  const ceiling = siCeiling(input.year);
  const regular = round(input.salary + input.otherPay);
  const gross = round(regular + input.thirteenth);
  // Insurable: the month's regular pay up to the month's maximum; a 13th salary up to what is left of the year's.
  const regularInsurable = Math.min(regular, ceiling);
  const thirteenthInsurable = Math.max(0, Math.min(input.thirteenth, 12 * ceiling - input.ytd.insurable - regularInsurable));
  const insurable = round(regularInsurable + thirteenthInsurable);
  const gesyBase = Math.max(0, Math.min(gross, CY_RATES.gesyCap - input.ytd.gross));
  const si = pct(insurable, CY_RATES.si), gesy = pct(gesyBase, CY_RATES.gesyEmployee);

  // Income tax: the year projected at today's pay, its tax, and the share of it due by the end of this month.
  const later = input.salary * input.monthsLeft + input.thirteenthToCome;
  const laterInsurable = Math.min(input.salary, ceiling) * input.monthsLeft + Math.max(0, Math.min(input.thirteenthToCome, 12 * ceiling - input.ytd.insurable - insurable - Math.min(input.salary, ceiling) * input.monthsLeft));
  const yearGross = input.ytd.gross + gross + later;
  const yearContributions = input.ytd.si + input.ytd.gesy + si + gesy + pct(laterInsurable, CY_RATES.si) + pct(later, CY_RATES.gesyEmployee);
  const chargeable = Math.max(0, yearGross - input.annualExemption - Math.min(yearContributions, yearGross / 5) - input.annualDeductions);
  const yearTax = cyIncomeTax(chargeable, input.year);
  const dueByNow = yearGross > 0 ? yearTax * (input.ytd.gross + gross) / yearGross : 0;
  const paye = Math.max(0, round(dueByNow - input.ytd.tax));

  return {
    salary: input.salary, otherPay: input.otherPay, thirteenth: input.thirteenth, gross, insurable,
    si_employee: si, gesy_employee: gesy, paye, net: round(gross - si - gesy - paye),
    si_employer: si, gesy_employer: pct(gesyBase, CY_RATES.gesyEmployer), social_cohesion: pct(gross, CY_RATES.socialCohesion),
    redundancy: pct(insurable, CY_RATES.redundancy), training: pct(insurable, CY_RATES.training),
  };
}

/** The employer's cost of a payslip on top of the gross pay. */
export const employerCost = (slip: Pick<Payslip, "si_employer" | "gesy_employer" | "social_cohesion" | "redundancy" | "training">) =>
  round(slip.si_employer + slip.gesy_employer + slip.social_cohesion + slip.redundancy + slip.training);
/** What goes to Social Insurance Services: both shares of social insurance and GESY, and the employer's funds. */
export const toSocialInsurance = (slip: Payslip) => round(slip.si_employee + slip.gesy_employee + employerCost(slip));

/** A 13th salary for the year: a month's salary, in proportion to the months worked if the employee started during it or leaves before December. */
export function thirteenthFor(salary: number, startDate: string, year: number, lastMonth = 12) {
  const start = startDate > `${year}-01-01` ? Number(startDate.slice(5, 7)) : 1;
  return startDate.slice(0, 4) > String(year) ? 0 : round(salary * Math.max(0, lastMonth - start + 1) / 12);
}

/** An employee as payroll needs them. */
export type PayEmployee = { start_date: string; leave_date: string | null; monthly_salary: number; thirteenth_salary: boolean; annual_deductions: number; annual_exemption: number };

/**
 * One employee's month (`period`, its first day): the salary for the days
 * they worked in it, the 13th salary in December (or, pro rata, in the month
 * they leave), and the payslip on the year so far.
 */
export function cyMonth(employee: PayEmployee, period: string, ytd: YearToDate, options: { otherPay?: number; thirteenthPaid?: boolean } = {}): Payslip {
  const year = Number(period.slice(0, 4)), month = Number(period.slice(5, 7));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${period.slice(0, 8)}${String(days).padStart(2, "0")}`;
  const from = employee.start_date > period ? Number(employee.start_date.slice(8, 10)) : 1;
  const to = employee.leave_date && employee.leave_date < end ? Number(employee.leave_date.slice(8, 10)) : days;
  const salary = round(employee.monthly_salary * Math.max(0, to - from + 1) / days);
  // The last month paid this year: December, or the month they leave.
  const last = employee.leave_date && employee.leave_date.slice(0, 4) === String(year) ? Number(employee.leave_date.slice(5, 7)) : 12;
  const owed = employee.thirteenth_salary && !options.thirteenthPaid ? thirteenthFor(employee.monthly_salary, employee.start_date, year, last) : 0;
  return cyPayslip({ year, month, salary, otherPay: options.otherPay ?? 0, thirteenth: month === last ? owed : 0, monthsLeft: Math.max(0, last - month), thirteenthToCome: month < last ? owed : 0,
    ytd, annualDeductions: employee.annual_deductions, annualExemption: employee.annual_exemption });
}

/** The year-to-date figures after a payslip. */
export const addToYear = (ytd: YearToDate, slip: Payslip): YearToDate => ({
  gross: round(ytd.gross + slip.gross), insurable: round(ytd.insurable + slip.insurable), si: round(ytd.si + slip.si_employee), gesy: round(ytd.gesy + slip.gesy_employee), tax: round(ytd.tax + slip.paye),
});
