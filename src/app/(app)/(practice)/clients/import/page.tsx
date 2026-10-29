import type { Metadata } from "next";

import { sql } from "@/lib/db";
import { clientKeys } from "@/lib/domain/client-import";
import { firmToday } from "@/lib/domain/invoices";
import { getPractice, requirePracticeMember } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { ClientImportForm } from "@/components/clients/client-import-form";

export const metadata: Metadata = { title: "Bring your clients over" };

/** A practice's existing clients, from its own spreadsheet: every company's books opened at once, shaped to its business. */
export default async function ClientImportPage() {
  await requirePracticeMember();
  const practice = await getPractice();
  const [staff, existing] = await Promise.all([
    sql<{ name: string }>("select name from practice_staff where practice_id = $1 order by name", [practice.id]),
    sql<{ name: string; he_number: string | null; vat_number: string | null }>(`select name, he_number, vat_number from organisations where practice_id = $1
      union all select company_name, he_number, vat_number from client_files where practice_id = $1 and status <> 'declined'`, [practice.id]),
  ]);
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="Bring your clients over" back={{ href: "/clients", label: "Client files" }}
      description="One row a company. Each one’s books open at once." />
    <Panel className="p-4 sm:p-5"><ClientImportForm existing={[...new Set(existing.flatMap(row => clientKeys(row)))]} staff={staff.map(person => person.name)} today={firmToday()} /></Panel>
  </PageBody>;
}
