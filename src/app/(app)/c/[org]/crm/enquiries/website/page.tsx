import { redirect } from "next/navigation";

/** Moved: every company's pipeline and jobs now go by the company's own names. */
export default async function Moved({ params }: { params: Promise<{ org: string }> }) {
  redirect(`/c/${(await params).org}/crm/pipeline/form`);
}
