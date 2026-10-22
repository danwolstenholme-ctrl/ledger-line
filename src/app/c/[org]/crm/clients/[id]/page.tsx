import { redirect } from "next/navigation";

/** Clients became Customers: one record for the CRM and the books. */
export default async function ClientPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  redirect(`/c/${org}/customers/${id}`);
}
