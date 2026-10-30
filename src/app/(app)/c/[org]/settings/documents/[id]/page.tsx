import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { addDocumentStyle, deleteDocumentStyle } from "@/lib/actions/document-styles";
import { getDocumentStyle } from "@/lib/data/document-styles";
import { logoVersion } from "@/lib/data/sales";
import { UUID_PATTERN } from "@/lib/domain/invoices";
import { requireOrg } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { InlineSubmit } from "@/components/common/form-fields";
import { RecordBadge, RecordDisclosure, RecordHeader, recordOutlineButton } from "@/components/records/record-layout";
import { StyleEditor } from "@/components/settings/style-editor";

export const metadata: Metadata = { title: "Document style" };

/** One document style, with its preview beside it. */
export default async function DocumentStylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const org = await requireOrg();
  const [row, logo] = await Promise.all([getDocumentStyle(id), logoVersion(org.id)]);
  if (!row) notFound();
  return <PageBody className="space-y-4">
    <RecordHeader title={row.name} eyebrow={row.is_default ? <RecordBadge tone="positive">Default style</RecordBadge> : undefined}
      back={{ href: "/accounts/settings/documents", label: "Documents" }}
      action={<form action={addDocumentStyle}><input type="hidden" name="from" value={row.id} /><button className={recordOutlineButton}>Copy it</button></form>} />
    <StyleEditor slug={org.slug} id={row.id} name={row.name} saved={row.style} hasLogo={Boolean(logo)} />
    {row.is_default ? null : <div className="ll-panel"><RecordDisclosure title="Remove this style">
      <form action={deleteDocumentStyle} className="space-y-2">
        <input type="hidden" name="id" value={row.id} />
        <p className="text-ink-muted text-[12.5px]">Its customers’ documents take the default style from then on. Documents already sent are not changed.</p>
        <InlineSubmit>Remove the style</InlineSubmit>
      </form>
    </RecordDisclosure></div>}
  </PageBody>;
}
