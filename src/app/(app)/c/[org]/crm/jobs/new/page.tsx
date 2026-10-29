import type { Metadata } from "next";

import { getCrmPeople, getCustomerChoices } from "@/lib/data/crm";
import { getWorkspace } from "@/lib/data/workspace";
import { fieldsFor } from "@/lib/domain/business-types";
import { getCurrentUser, requireOrg } from "@/lib/org";
import { PageBody, Panel } from "@/components/common/primitives";
import { RecordHeader } from "@/components/records/record-layout";
import { JobForm } from "@/components/crm/forms";

export const metadata: Metadata = { title: "New" };

/** A new job, whatever the company calls it: `?customer=` starts it for one of its customers. */
export default async function NewJobPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const org = await requireOrg();
  const [workspace, customers, people, user, query] = await Promise.all([getWorkspace(org.id), getCustomerChoices(), getCrmPeople(), getCurrentUser(), searchParams]);
  const [one, many] = workspace.labels.job;
  return <PageBody width="3xl" className="space-y-4">
    <RecordHeader title={`New ${one.toLowerCase()}`} back={{ href: `/c/${org.slug}/crm/jobs`, label: many }} />
    <Panel className="p-4 sm:p-5"><JobForm fields={fieldsFor(workspace, "job")} customers={customers} people={[...new Set([user.name, ...people])]} customerId={customers.some(customer => customer.id === query.customer) ? query.customer : undefined}
      labels={{ job: one, customer: workspace.labels.customer[0] }} /></Panel>
  </PageBody>;
}
