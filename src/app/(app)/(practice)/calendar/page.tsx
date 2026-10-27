import type { Metadata } from "next";

import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

/** Every client's calendar, in one: or one client's, picked from the row of clients. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <CalendarView query={await searchParams} />;
}
