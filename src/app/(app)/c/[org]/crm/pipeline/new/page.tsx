import type { Metadata } from "next";

import { getWorkspace } from "@/lib/data/workspace";
import { businessType, fieldsFor } from "@/lib/domain/business-types";
import { requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { DealForm } from "@/components/crm/forms";

export const metadata: Metadata = { title: "New" };

export default async function NewDealPage() {
  const org = await requireOrg();
  const workspace = await getWorkspace(org.id);
  const [one, many] = workspace.labels.deal;
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title={`New ${one.toLowerCase()}`} back={{ href: `/c/${org.slug}/crm/pipeline`, label: many }} />
    <Panel className="p-4 sm:p-5"><DealForm fields={fieldsFor(workspace, "deal")} sources={businessType(workspace.typeKey).sources} label={one.toLowerCase()} /></Panel>
  </PageBody>;
}
