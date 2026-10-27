import type { Metadata } from "next";

import { sql } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { ImportForm } from "@/components/common/import-form";

export const metadata: Metadata = { title: "Import suppliers" };

export default async function ImportSuppliersPage() {
  const org = await requireOrg();
  const rows = await sql<{ name: string; vat: string | null; code: string | null }>("select lower(btrim(name)) as name, upper(vat_number) as vat, null as code from suppliers where organisation_id = $1", [org.id]);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Import suppliers" back={{ href: "/accounts/suppliers", label: "Suppliers" }} description="From a spreadsheet: a name each, and any of email, phone, VAT number, country, IBAN and BIC. IBANs are checked before they are saved." />
    <Panel className="p-4 sm:p-5">
      <ImportForm kind="suppliers" listHref="/accounts/suppliers" existing={{ names: rows.map(row => row.name), vats: rows.map(row => row.vat).filter((vat): vat is string => Boolean(vat)), codes: rows.map(row => row.code).filter((code): code is string => Boolean(code)) }} />
    </Panel>
  </PageBody>;
}
