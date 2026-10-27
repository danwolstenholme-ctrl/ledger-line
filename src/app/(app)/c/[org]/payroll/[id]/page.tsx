import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { getPayrollRun, monthName } from "@/lib/data/payroll";
import { CY_RATES, employerCost } from "@/lib/domain/payroll-cy";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageBody } from "@/components/common/primitives";
import { RecordBadge, RecordDetail, RecordDisclosure, RecordHeader, RecordSection, recordOutlineButton } from "@/components/records/record-layout";
import { ApproveRunForm, DeleteRunForm, OtherPayForm } from "@/components/payroll/payroll-forms";

export const metadata: Metadata = { title: "Payroll" };

/** One month's payroll: everyone's payslip, what goes where by when, and, while it is a draft, approving it. */
export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const data = await getPayrollRun(id);
  if (!data) notFound();
  const { org, run, slips, totals, due, today } = data;
  const draft = run.status === "draft";
  const month = monthName(run.period);
  const base = `/c/${org.slug}/payroll/${run.id}`;
  const head = "text-ink-faint px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap first:px-4 last:pr-4";
  const cell = "px-3 py-2 text-[13px] first:px-4 last:pr-4";
  const late = !draft && due < today;
  const anyThirteenth = slips.some(slip => slip.thirteenth > 0), anyOther = slips.some(slip => slip.otherPay > 0);
  const noIban = slips.filter(slip => !slip.iban && slip.net > 0);

  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title={`${month} payroll`} back={{ href: "/accounts/payroll", label: "Payroll" }}
      description={<>{slips.length} employee{slips.length === 1 ? "" : "s"} · paid on {formatDate(run.pay_date)} · {draft ? <RecordBadge tone="caution">Draft</RecordBadge> : <RecordBadge tone="positive">Posted</RecordBadge>}</>}
      action={<>
        <a href={`${base}/payslips`} className={recordOutlineButton} target="_blank" rel="noreferrer"><FileText className="size-3.5" />Payslips</a>
        {draft ? null : <a href={`${base}/sepa`} className={recordOutlineButton} download><Download className="size-3.5" />Salary payments file</a>}
        <a href={`${base}/figures`} className={recordOutlineButton} download><Download className="size-3.5" />TD7 and Social Insurance figures</a>
      </>} />

    {draft ? <RecordSection title="Approve" hint="worked out from each employee as they are now">
      <div className="space-y-3 px-4 py-3.5">
        <p className="text-ink-muted max-w-[80ch] text-[13px] leading-relaxed">Check the payslips below. Approving works the month out once more, posts it to the books on {formatDate(run.pay_date)}, and fixes it: next month’s tax is worked out from it.</p>
        <ApproveRunForm id={run.id} label={`Approve and post ${month}`} />
      </div>
      <RecordDisclosure title="Overtime, a bonus or commission this month">
        <OtherPayForm runId={run.id} employees={slips.map(slip => ({ id: slip.employee_id, name: slip.name, otherPay: slip.otherPay }))} />
      </RecordDisclosure>
      <RecordDisclosure title="Delete this draft">
        <p className="text-ink-muted mb-3 text-[12.5px]">Nothing of it is in the books. The month can be run again.</p>
        <DeleteRunForm id={run.id} />
      </RecordDisclosure>
    </RecordSection> : null}

    <RecordSection title={`To pay by ${formatDate(due)}`} hint={late ? "the end of the month after: the date has passed" : "the end of the month after"}>
      <dl className="divide-hairline divide-y px-4">
        <RecordDetail label="Employees" value={<><span className="font-medium tabular-nums">{formatAmount(totals.net)}</span> net pay, on {formatDate(run.pay_date)}{draft ? null : <>: the <a href={`${base}/sepa`} className="text-brand hover:underline" download>payments file</a> uploads to the bank</>}
          {noIban.length ? <span className="text-ink-muted"> ({noIban.map(slip => slip.name).join(", ")} {noIban.length === 1 ? "has" : "have"} no IBAN, so {noIban.length === 1 ? "is" : "are"} paid separately)</span> : null}</>} />
        <RecordDetail label="Social Insurance Services" value={<><span className="font-medium tabular-nums">{formatAmount(totals.social)}</span>: social insurance {formatAmount(totals.si)}, GESY {formatAmount(totals.gesy)}, and the employer’s funds {formatAmount(totals.funds)} (social cohesion, redundancy and training)</>} />
        <RecordDetail label="Tax Department" value={<><span className="font-medium tabular-nums">{formatAmount(totals.paye)}</span> income tax withheld, with the month’s TD7 in Tax For All</>} />
        <RecordDetail label="Cost to the company" value={<>{formatAmount(totals.gross + totals.employer)}: gross pay {formatAmount(totals.gross)} and the employer’s contributions {formatAmount(totals.employer)}</>} />
        {draft ? null : <RecordDetail label="In the books" value={<>Posted {run.posted_at ? formatDateTime(run.posted_at) : ""}{run.posted_by ? ` by ${run.posted_by}` : ""}: <Link href="/accounts/reports/general-ledger" className="text-brand hover:underline">wages and contributions</Link> against what is owed to each. Match the bank payments to accounts 835, 825 and 826.</>} />}
      </dl>
    </RecordSection>

    <RecordSection title="Payslips" hint={`Social insurance ${CY_RATES.si}% each up to the month’s maximum, GESY ${CY_RATES.gesyEmployee}% and ${CY_RATES.gesyEmployer}%, social cohesion ${CY_RATES.socialCohesion}%, redundancy ${CY_RATES.redundancy}%, training ${CY_RATES.training}%`}>
      <div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse">
        <thead className="border-hairline bg-surface-sunken border-b"><tr>
          <th scope="col" className={head}>Employee</th>
          {anyOther || anyThirteenth ? <th scope="col" className={cn(head, "text-right")}>Salary</th> : null}
          {anyOther ? <th scope="col" className={cn(head, "text-right")}>Extra</th> : null}
          {anyThirteenth ? <th scope="col" className={cn(head, "text-right")}>13th</th> : null}
          <th scope="col" className={cn(head, "text-right")}>Gross</th><th scope="col" className={cn(head, "text-right")}>Social insurance</th><th scope="col" className={cn(head, "text-right")}>GESY</th>
          <th scope="col" className={cn(head, "text-right")}>Income tax</th><th scope="col" className={cn(head, "text-right")}>Net pay</th><th scope="col" className={cn(head, "text-right")}>Employer</th>
        </tr></thead>
        <tbody className="divide-hairline divide-y">{slips.map(slip => <tr key={slip.id}>
          <td className={cell}><Link href={`/accounts/payroll/employees/${slip.employee_id}`} className="text-ink font-medium hover:underline">{slip.name}</Link>{slip.job_title ? <span className="text-ink-muted block text-[12px]">{slip.job_title}</span> : null}</td>
          {anyOther || anyThirteenth ? <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(slip.salary)}</td> : null}
          {anyOther ? <td className={cn(cell, "text-right tabular-nums")}>{slip.otherPay ? formatAmount(slip.otherPay) : ""}</td> : null}
          {anyThirteenth ? <td className={cn(cell, "text-right tabular-nums")}>{slip.thirteenth ? formatAmount(slip.thirteenth) : ""}</td> : null}
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(slip.gross)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(slip.si_employee)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(slip.gesy_employee)}</td>
          <td className={cn(cell, "text-right tabular-nums")}>{formatAmount(slip.paye)}</td>
          <td className={cn(cell, "text-right font-medium tabular-nums")}>{formatAmount(slip.net)}</td>
          <td className={cn(cell, "text-ink-muted text-right tabular-nums")}>{formatAmount(employerCost(slip))}</td>
        </tr>)}</tbody>
        <tfoot className="border-hairline-strong bg-surface-sunken border-t"><tr>
          <th scope="row" colSpan={1 + (anyOther || anyThirteenth ? 1 : 0) + (anyOther ? 1 : 0) + (anyThirteenth ? 1 : 0)} className="text-ink px-4 py-2.5 text-left text-[13px] font-semibold">Total</th>
          <td className={cn(cell, "text-right font-semibold tabular-nums")}>{formatAmount(totals.gross)}</td>
          <td className={cn(cell, "text-right font-semibold tabular-nums")}>{formatAmount(totals.siEmployee)}</td>
          <td className={cn(cell, "text-right font-semibold tabular-nums")}>{formatAmount(totals.gesyEmployee)}</td>
          <td className={cn(cell, "text-right font-semibold tabular-nums")}>{formatAmount(totals.paye)}</td>
          <td className={cn(cell, "text-right font-semibold tabular-nums")}>{formatAmount(totals.net)}</td>
          <td className={cn(cell, "text-right font-semibold tabular-nums")}>{formatAmount(totals.employer)}</td>
        </tr></tfoot>
      </table></div>
      <p className="border-hairline text-ink-muted border-t px-4 py-2.5 text-[12.5px] leading-relaxed">Income tax is the year’s tax on the year’s pay at today’s salary, less what is already withheld, after social insurance and GESY (up to a fifth of the pay) and what each employee declared on TD59.{anyThirteenth ? " The 13th salary is declared to Social Insurance on its own, against the year’s maximum insurable earnings." : ""}</p>
    </RecordSection>
  </PageBody>;
}
