import { csvResponse } from "@/lib/data/csv";
import { getPayrollRun } from "@/lib/data/payroll";
import { UUID_PATTERN } from "@/lib/domain/invoices";

const money = (value: number) => value.toFixed(2);

/**
 * The month, employee by employee, as Tax For All's monthly TD7 and Social
 * Insurance Services' statement of contributions ask for it: who (TIC, ID,
 * social insurance number), the pay and insurable earnings, each
 * contribution, and the tax withheld.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return new Response("That payroll run does not exist.", { status: 404 });
  const data = await getPayrollRun(id);
  if (!data) return new Response("That payroll run does not exist.", { status: 404 });
  const { org, run, slips } = data;
  return csvResponse(`${org.slug}-payroll-${run.period.slice(0, 7)}${run.status === "draft" ? "-draft" : ""}`,
    ["Month", "Name", "TIC", "ID or passport", "Social insurance no.", "Gross pay", "Of which 13th salary", "Insurable earnings", "Social insurance, employee 8.8%", "Social insurance, employer 8.8%",
      "GESY, employee 2.65%", "GESY, employer 2.9%", "Social Cohesion Fund 2%", "Redundancy Fund 1.2%", "HRD 0.5%", "Income tax withheld", "Net pay"],
    slips.map(slip => [run.period.slice(0, 7), slip.name, slip.tic ?? "", slip.id_document ?? "", slip.social_insurance_no ?? "", money(slip.gross), money(slip.thirteenth), money(slip.insurable),
      money(slip.si_employee), money(slip.si_employer), money(slip.gesy_employee), money(slip.gesy_employer), money(slip.social_cohesion), money(slip.redundancy), money(slip.training), money(slip.paye), money(slip.net)]));
}
