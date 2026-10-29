import type { Metadata } from "next";

import { sql } from "@/lib/db";
import { requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { ImportForm } from "@/components/common/import-form";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportItemsPage() {
  const org = await requireOrg();
  const rows = await sql<{ name: string; vat: string | null; code: string | null }>("select lower(btrim(name)) as name, null as vat, lower(btrim(code)) as code from items where organisation_id = $1 and is_active", [org.id]);
  return <PageBody width="5xl" className="space-y-4">
    <RecordHeader title="Import products" back={{ href: "/accounts/items", label: "Products and services" }} description="19% VAT and the sales account when not given." />
    <Panel className="p-4 sm:p-5">
      <ImportForm kind="items" listHref="/accounts/items" existing={{ names: rows.map(row => row.name), vats: rows.map(row => row.vat).filter((vat): vat is string => Boolean(vat)), codes: rows.map(row => row.code).filter((code): code is string => Boolean(code)) }} />
    </Panel>
  </PageBody>;
}
