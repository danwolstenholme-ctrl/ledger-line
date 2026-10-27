import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { getPayroll, monthName, payrollDue } from "@/lib/data/payroll";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody, Panel } from "@/components/common/primitives";
import { CreateRecordLink, RecordBadge, RecordEmpty, RecordHeader, RecordSection, recordButton } from "@/components/records/record-layout";
import { StartRunForm } from "@/components/payroll/payroll-forms";

export const metadata: Metadata = { title: "Payroll" };

/**
 * The company's payroll: one month at a time, worked out from each
 * employee's pay and the year so far, approved, and posted to the books.
 */
export default async function PayrollPage() {
  const { org, employees, runs, next, today } = await getPayroll();
  if (org.country !== "CY") return <PageBody width="4xl" className="space-y-4">
    <RecordHeader title="Payroll" />
    <Panel><RecordEmpty title="Payroll here is Cyprus payroll">UK payroll, through HMRC’s Real Time Information, is not in Ledgerline yet. Wages paid through another payroll are coded from the bank as they are now.</RecordEmpty></Panel>
  </PageBody>;
  const draft = runs.find(run => run.status === "draft");
  const current = employees.filter(employee => !employee.leave_date || employee.leave_date >= today);
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap first:px-4 last:pr-4";
  const cell = "px-3 py-2.5 text-[13px] first:px-4 last:pr-4";

  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Payroll"
      description={`${current.length} employee${current.length === 1 ? "" : "s"}. Each month: payslips, social insurance and GESY, and the tax withheld, paid and filed by the end of the month after.`}
      action={draft ? <Link href={`/accounts/payroll/${draft.id}`} className={recordButton}>Continue {monthName(draft.period)}’s payroll</Link>
        : current.length ? <StartRunForm period={next} label={`Run ${monthName(next)}’s payroll`} /> : null} />

    <RecordSection title="Months" hint={runs.length ? `Next: ${monthName(draft?.period ?? next)}, due to Social Insurance and the Tax Department by ${formatDate(payrollDue(draft?.period ?? next))}` : undefined}>
      {runs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Month</th><th scope="col" className={cn(head, "text-right")}>People</th><th scope="col" className={cn(head, "text-right")}>Gross pay</th>
          <th scope="col" className={cn(head, "text-right")}>Net pay</th><th scope="col" className={cn(head, "text-right")}>Social insurance</th><th scope="col" className={cn(head, "text-right")}>Tax withheld</th>
          <th scope="col" className={head}><span className="sr-only">Status</span></th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{runs.map(run => <tr key={run.id} className="hover:bg-surface-sunken">
          <td className={cell}><Link href={`/accounts/payroll/${run.id}`} className="text-brand font-medium hover:underline">{monthName(run.period)}</Link></td>
          <td className={cn(cell, "text-ink-muted text-right tabular-nums")}>{run.people}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(run.gross)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(run.net)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(run.social)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(run.paye)}</td>
          <td className={cn(cell, "text-right")}>{run.status === "draft" ? <RecordBadge tone="caution">Draft</RecordBadge> : <RecordBadge tone="positive">Posted</RecordBadge>}</td>
        </tr>)}</tbody>
      </table></div> : <RecordEmpty title="No month run in Ledgerline yet">{current.length ? `Run ${monthName(next)} to work out everyone’s payslip. Nothing is posted until you approve it.` : "Add the employees first, with what they were paid this year before Ledgerline."}</RecordEmpty>}
    </RecordSection>

    <RecordSection title="Employees" action={<CreateRecordLink href="/accounts/payroll/employees/new">Add an employee</CreateRecordLink>}>
      {employees.length ? <ul className="divide-hairline divide-y">{employees.map(employee => {
        const left = employee.leave_date && employee.leave_date < today;
        return <li key={employee.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
          <Link href={`/accounts/payroll/employees/${employee.id}`} className={cn("min-w-0 flex-1 text-[13px] font-medium hover:underline", left ? "text-ink-muted" : "text-ink")}>{employee.name}</Link>
          <span className="text-ink-muted text-[12.5px]">{employee.job_title ?? ""}{left ? ` · left ${formatDate(employee.leave_date)}` : ` · since ${formatDate(employee.start_date)}`}</span>
          <span className="text-ink w-28 text-right text-[13px] tabular-nums">{formatAmount(employee.monthly_salary)}</span>
        </li>;
      })}</ul> : <RecordEmpty title="No employees yet">Add each employee with their salary, tax and social insurance numbers, and the year so far from the previous payroll.</RecordEmpty>}
      {runs.some(run => run.status === "posted") ? <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12.5px]">
        For the year: <a href={`/c/${org.slug}/payroll/year?year=${today.slice(0, 4)}`} className="text-brand hover:underline" download>each employee’s pay and tax in {today.slice(0, 4)}</a>, for the employer’s return (TD7) and their certificates (TD63).
      </p> : null}
    </RecordSection>
  </PageBody>;
}
