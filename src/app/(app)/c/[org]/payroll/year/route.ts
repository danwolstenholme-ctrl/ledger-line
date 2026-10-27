import { csvResponse } from "@/lib/data/csv";
import { getPayrollYear } from "@/lib/data/payroll";
import { firmToday } from "@/lib/domain/invoices";

const money = (value: number) => value.toFixed(2);

/**
 * A tax year, employee by employee: what the employer's annual return (TD7)
 * and each employee's certificate of pay and tax (TD63) report. Pay from
 * before Ledgerline is in it as it was brought forward.
 */
export async function GET(request: Request) {
  const asked = Number(new URL(request.url).searchParams.get("year"));
  const year = asked >= 2000 && asked <= 2100 ? asked : Number(firmToday().slice(0, 4));
  const { org, rows } = await getPayrollYear(year);
  return csvResponse(`${org.slug}-payroll-${year}`,
    ["Tax year", "Name", "TIC", "ID or passport", "Social insurance no.", "Started", "Left", "Months in Ledgerline", "Gross pay", "Of which 13th salary (in Ledgerline)", "Insurable earnings",
      "Social insurance withheld", "GESY withheld", "Income tax withheld", "Deductions declared (TD59)", "Exempt pay", "Employer's contributions (in Ledgerline)", "Brought forward from before Ledgerline"],
    rows.map(row => [String(year), row.employee.name, row.employee.tic ?? "", row.employee.id_document ?? "", row.employee.social_insurance_no ?? "", row.employee.start_date, row.employee.leave_date ?? "",
      String(row.months), money(row.gross), money(row.thirteenth), money(row.insurable), money(row.si), money(row.gesy), money(row.tax), money(Number(row.employee.annual_deductions)),
      money(Number(row.employee.annual_exemption)), money(row.employer), row.brought ? "yes" : "no"]));
}
