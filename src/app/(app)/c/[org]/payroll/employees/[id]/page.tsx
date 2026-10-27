import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getEmployee } from "@/lib/data/payroll";
import { UUID_PATTERN, firmToday } from "@/lib/domain/invoices";
import { formatAmount, formatDate } from "@/lib/format";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { EmployeeForm } from "@/components/payroll/payroll-forms";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const employee = await getEmployee(id);
  if (!employee) notFound();
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title={employee.name} back={{ href: "/accounts/payroll", label: "Payroll" }}
      description={`${employee.job_title ? `${employee.job_title} · ` : ""}${formatAmount(employee.monthly_salary)} a month · since ${formatDate(employee.start_date)}${employee.leave_date ? ` · ${employee.leave_date < firmToday() ? "left" : "leaves"} ${formatDate(employee.leave_date)}` : ""}`} />
    <Panel className="p-4 sm:p-5"><EmployeeForm employee={employee} year={Number(firmToday().slice(0, 4))} /></Panel>
  </PageBody>;
}
