import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { DeadlinesView } from "@/components/deadlines/deadlines-view";

export const metadata: Metadata = { title: "Deadlines" };

/** One company's deadlines, inside its own books. */
export default async function CompanyDeadlinesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [org, query] = await Promise.all([requireOrg(), searchParams]);
  return <DeadlinesView query={query} company={org.slug} />;
}
