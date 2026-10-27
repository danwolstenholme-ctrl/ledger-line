import { asPerson } from "@/lib/db";
import { findFeed } from "@/lib/calendar-feeds";
import { calendarCompanyLabel, getCalendarItems } from "@/lib/data/calendar";
import { addDays, CALENDAR_KIND_LABEL, CALENDAR_KINDS } from "@/lib/domain/calendar";
import { icsCalendar } from "@/lib/documents/ics";
import { firmToday } from "@/lib/domain/invoices";
import { siteOrigin } from "@/lib/site";

/**
 * A subscribed calendar, as Google, Outlook or Apple Calendar read it every
 * few hours: what is still open, two months back to a year ahead, read as the
 * person whose link it is. A replaced or stopped link reads nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const feed = await findFeed(token.replace(/\.ics$/, ""));
  if (!feed?.auth_id) return new Response("This calendar link was replaced or stopped. Make a new one in Ledgerline.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const today = firmToday();
  const data = await asPerson(feed.auth_id, () => getCalendarItems({ from: addDays(today, -60), to: addDays(today, 365), client: feed.slug, kind: feed.kind, grouped: !feed.organisation_id }));
  const origin = await siteOrigin();
  const events = data.items.filter(item => item.state !== "done").map(item => ({
    uid: `${item.key}@ledgerline`, date: item.date,
    summary: `${item.state === "overdue" ? "Overdue: " : ""}${item.title}${feed.organisation_id || !item.company.name ? "" : ` · ${calendarCompanyLabel(item.company.name)}`}`,
    description: [item.company.name, CALENDAR_KIND_LABEL[item.kind], item.detail].filter(Boolean).join(" · "),
    url: `${origin}${item.href}`, categories: CALENDAR_KIND_LABEL[item.kind],
  }));
  return new Response(icsCalendar(`Ledgerline · ${feed.company ?? "All clients"}${feed.kind ? ` · ${CALENDAR_KINDS[feed.kind]}` : ""}`, events), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="ledgerline.ics"', "cache-control": "no-store" },
  });
}
