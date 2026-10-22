import { redirect } from "next/navigation";

/** Clients became Customers: one record for the CRM and the books. */
export default async function ClientsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ org }, { q }] = await Promise.all([params, searchParams]);
  redirect(`/c/${org}/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}
