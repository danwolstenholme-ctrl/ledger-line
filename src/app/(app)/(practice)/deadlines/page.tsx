import type { Metadata } from "next";

import { DeadlinesView } from "@/components/deadlines/deadlines-view";

export const metadata: Metadata = { title: "Deadlines" };

/** Every client's deadlines on one page, worked out from their own books. */
export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <DeadlinesView query={await searchParams} />;
}
