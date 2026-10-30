import type { Metadata } from "next";
import Link from "@/components/navigation/navigation-link";

import { addDocumentStyle, makeDefaultDocumentStyle } from "@/lib/actions/document-styles";
import { getDocumentStyles } from "@/lib/data/document-styles";
import { logoVersion } from "@/lib/data/sales";
import { FONTS, LAYOUTS } from "@/lib/documents/style";
import { requireOrg } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { RecordBadge, RecordHeader, RecordSection, recordButton } from "@/components/records/record-layout";
import { DocumentBasicsForm } from "@/components/settings/document-basics-form";

export const metadata: Metadata = { title: "Documents" };

/** How the company's documents look: its logo and language, and its styles, one of them the default. */
export default async function DocumentsSettingsPage() {
  const org = await requireOrg();
  const [styles, logo] = await Promise.all([getDocumentStyles(), logoVersion(org.id)]);
  return <PageBody width="6xl" className="space-y-4">
    <RecordHeader title="Documents" back={{ href: "/accounts/settings", label: "Company settings" }}
      action={<form action={addDocumentStyle}><button className={recordButton}>Add a style</button></form>} />
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <RecordSection title="Styles" hint="Invoices, quotes, credit notes, statements and remittance advice">
        <ul className="divide-hairline divide-y">
          {styles.map(row => <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
            <span aria-hidden className="border-hairline size-8 shrink-0 rounded-full border" style={{ backgroundColor: row.style.layout === "plain" ? "#1d2433" : row.style.accent }} />
            <div className="min-w-0 flex-1">
              <Link href={`/accounts/settings/documents/${row.id}`} className="text-ink hover:text-brand text-[13.5px] font-medium">{row.name}</Link>
              <p className="text-ink-muted text-[12.5px]">
                {LAYOUTS.find(layout => layout.key === row.style.layout)?.label} · {FONTS.find(font => font.key === row.style.font)?.label.toLowerCase()} · {row.style.paper === "A4" ? "A4" : "US Letter"}
                {row.is_default ? " · every customer without a style of their own" : row.customers ? ` · ${row.customers} customer${row.customers === 1 ? "" : "s"}` : " · no customers yet"}
              </p>
            </div>
            {row.is_default ? <RecordBadge tone="positive">Default</RecordBadge> : <form action={makeDefaultDocumentStyle}><input type="hidden" name="id" value={row.id} /><InlineSubmit>Make default</InlineSubmit></form>}
            <Link href={`/accounts/settings/documents/${row.id}`} className="text-brand text-[13px] font-medium hover:underline touch:inline-flex touch:min-h-10 touch:items-center">Change</Link>
          </li>)}
        </ul>
        <p className="border-hairline text-ink-muted border-t px-4 py-3 text-[12.5px] leading-relaxed sm:px-5">
          A customer can be given a style of its own on its page: a wholesale customer’s plain invoices, say, while everyone else gets the default.
        </p>
      </RecordSection>
      <RecordSection title="Logo and language">
        <div className="p-4 sm:p-5"><DocumentBasicsForm slug={org.slug} logoVersion={logo} language={org.document_language} cyprus={org.country === "CY"} /></div>
      </RecordSection>
    </div>
  </PageBody>;
}
