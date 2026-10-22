import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getOrgBySlug } from "@/lib/org";

/** One client company's books. The proxy names the company on every request beneath this. */
export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!(await getOrgBySlug(org))) notFound();
  return children;
}
