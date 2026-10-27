import { redirect } from "next/navigation";

/** Moved: every company's pipeline and jobs now go by the company's own names. */
export default async function Moved({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  redirect(`/c/${org}/crm/jobs/${id}`);
}
