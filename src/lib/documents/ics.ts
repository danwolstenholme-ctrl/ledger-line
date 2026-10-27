/**
 * A calendar to subscribe to, as iCalendar (RFC 5545): what Google Calendar,
 * Outlook and Apple Calendar all read from a link. Each item is an all-day
 * event that blocks no time. Text is escaped, and lines longer than 75 bytes
 * are folded without splitting a character.
 */

export type IcsEvent = { uid: string; date: string; summary: string; description?: string | null; url?: string | null; categories?: string | null };

const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (date: string) => date.replaceAll("-", "");
const next = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** A content line folded at 75 bytes, each continuation starting with a space. */
function fold(line: string) {
  const bytes = (text: string) => Buffer.byteLength(text, "utf8");
  if (bytes(line) <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const character of line) {
    const limit = parts.length ? 74 : 75;
    if (bytes(current + character) > limit) { parts.push(current); current = ""; }
    current += character;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function icsCalendar(name: string, events: IcsEvent[], now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wolsten Studios//Ledgerline//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${escape(event.uid)}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(event.date)}`, `DTEND;VALUE=DATE:${day(next(event.date))}`,
      `SUMMARY:${escape(event.summary)}`, "TRANSP:TRANSPARENT");
    if (event.description) lines.push(`DESCRIPTION:${escape(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    if (event.categories) lines.push(`CATEGORIES:${escape(event.categories)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
