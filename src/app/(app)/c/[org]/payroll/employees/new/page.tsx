import type { Metadata } from "next";

import { firmToday } from "@/lib/domain/invoices";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { EmployeeForm } from "@/components/payroll/payroll-forms";

export const metadata: Metadata = { title: "New employee" };

export default function NewEmployeePage() {
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title="New employee" back={{ href: "/accounts/payroll", label: "Payroll" }}
      description="Their salary, the numbers the Tax Department and Social Insurance Services know them by, and what they were paid this year before Ledgerline." />
    <Panel className="p-4 sm:p-5"><EmployeeForm year={Number(firmToday().slice(0, 4))} /></Panel>
  </PageBody>;
}
