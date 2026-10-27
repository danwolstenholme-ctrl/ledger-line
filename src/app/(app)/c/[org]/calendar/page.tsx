import type { Metadata } from "next";

import { requireOrg } from "@/lib/org";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

/** One company's calendar: what is due for it, and only it. */
export default async function CompanyCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [org, query] = await Promise.all([requireOrg(), searchParams]);
  return <CalendarView query={query} company={{ id: org.id, slug: org.slug, name: org.name }} />;
}
