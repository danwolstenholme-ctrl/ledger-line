import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { asService, one, sql } from "@/lib/db";
import type { CalendarKind } from "@/lib/domain/calendar";

/** Calendar links: a random token in the address, and only its SHA-256 in the database. */
export const newFeedToken = () => randomBytes(32).toString("base64url");
export const feedHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type Feed = { id: string; auth_id: string | null; organisation_id: string | null; kind: CalendarKind | null; slug: string | null; company: string | null; person: string };

/** The live link behind a token, and whose it is: looked up for nobody in particular, since a calendar app signs in as no one. */
export async function findFeed(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return asService("reading a calendar link", async () => {
    const feed = await one<Feed>(`select f.id, u.auth_id, f.organisation_id, f.kind, o.slug, o.name as company, u.name as person
      from calendar_feeds f join app_users u on u.id = f.user_id left join organisations o on o.id = f.organisation_id
      where f.token_hash = $1 and f.revoked_at is null`, [feedHash(token)]);
    if (feed) await sql("update calendar_feeds set last_used_at = now() where id = $1", [feed.id]);
    return feed;
  });
}

/** The person's live link for this scope, if any: when it was made and last read. */
export const liveFeed = (userId: string, organisationId: string | null) =>
  one<{ id: string; created_at: string; last_used_at: string | null; kind: string | null }>("select id, created_at, last_used_at, kind from calendar_feeds where user_id = $1 and organisation_id is not distinct from $2 and revoked_at is null", [userId, organisationId]);
