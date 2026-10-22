import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { PageBody } from "@/components/common/primitives";
import { RecordHeader, RecordSection } from "@/components/records/record-layout";
import { NewEnquiryForm } from "@/components/crm/new-enquiry-form";

export const metadata: Metadata = { title: "New enquiry" };

export default async function NewEnquiryPage() {
  const org = await requireOrg();
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title="New enquiry" description={`For ${org.name}`} back={{ href: `/c/${org.slug}/crm/enquiries`, label: "Enquiries" }} />
    <RecordSection title="Who, and what they want"><div className="p-4 sm:p-5"><NewEnquiryForm /></div></RecordSection>
  </PageBody>;
}
