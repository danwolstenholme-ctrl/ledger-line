import { one } from "@/lib/db";
import { getPayrollRun, monthName } from "@/lib/data/payroll";
import { ibanIn } from "@/lib/domain/iban";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { sepaCreditTransfer } from "@/lib/documents/sepa";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** A posted month's net pay as a SEPA credit transfer file, marked as salaries, from the company's main bank account. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return text("That payroll run does not exist.", 404);
  const data = await getPayrollRun(id);
  if (!data) return text("That payroll run does not exist.", 404);
  const { org, run, slips, today } = data;
  if (run.status !== "posted") return text("Approve the month first: the payments file is made from the posted payslips.", 409);
  const bank = await one<{ name: string; bank_details: string | null }>(`
    select name, bank_details from ledger_accounts where organisation_id = $1 and is_active and (id = $2 or bank_details ~* 'IBAN')
     order by (id = $2) desc nulls last, code limit 1`, [org.id, org.default_bank_account_id]);
  const iban = ibanIn(bank?.bank_details);
  if (!bank || !iban) return text("The company’s bank account has no valid IBAN in its details. Add it to the bank account first.", 409);
  let xml: string;
  try {
    xml = sepaCreditTransfer({
      messageId: `LLPAY${run.period.slice(0, 7).replace("-", "")}${run.id.replace(/-/g, "").slice(0, 12)}`, createdAt: new Date().toISOString(),
      // A bank won't take a date gone by: a late file goes today.
      executionDate: run.pay_date < today ? today : run.pay_date, salaries: true,
      debtor: { name: org.name, iban, bic: /BIC[:\s]*([A-Z0-9]{8,11})/i.exec(bank.bank_details ?? "")?.[1] ?? null },
      payments: slips.filter(slip => slip.iban).map(slip => ({ endToEndId: `PAY${run.period.slice(0, 7).replace("-", "")}-${slip.employee_id.slice(0, 8)}`, amount: slip.net, name: slip.name, iban: slip.iban!, bic: null, remittance: `Salary ${monthName(run.period)}` })),
    });
  } catch (error) { return text(error instanceof Error ? error.message : "The file could not be made.", 409); }
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="Salaries ${run.period.slice(0, 7)}.xml"`, "cache-control": "private, no-store" } });
}
