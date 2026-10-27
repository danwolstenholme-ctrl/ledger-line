import "server-only";

import { headers } from "next/headers";

/** Where people reach Ledgerline, for links that leave it (an invitation, a calendar to subscribe to): LEDGERLINE_SITE_URL, or the host this request came to. */
export async function siteOrigin() {
  const fromEnv = process.env.LEDGERLINE_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = (await headers()).get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}
