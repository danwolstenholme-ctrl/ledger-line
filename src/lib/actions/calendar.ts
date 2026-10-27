"use server";

import { revalidatePath } from "next/cache";

import { asDbError, transaction, sql } from "@/lib/db";
import { describeDbError } from "@/lib/actions/form";
import { feedHash, newFeedToken } from "@/lib/calendar-feeds";
import { parseKind } from "@/lib/domain/calendar";
import type { FeedState } from "@/lib/actions/state";
import { getCurrentUser } from "@/lib/org";
import { siteOrigin } from "@/lib/site";

/**
 * A calendar to subscribe to: a secret link, shown once and kept only as its
 * hash. Making a new one stops the old; so does stopping it. The calendar
 * behind it shows what its person may see when it is read, not when it was made.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function makeCalendarFeed(_previous: FeedState, form: FormData): Promise<FeedState> {
  const user = await getCurrentUser();
  const organisation = String(form.get("organisation_id") ?? "") || null;
  if (organisation && !UUID.test(organisation)) return { ok: false, error: "That company could not be found." };
  const kind = parseKind(form.get("kind"));
  const token = newFeedToken();
  try {
    await transaction(async run => {
      await run("update calendar_feeds set revoked_at = now() where user_id = $1 and organisation_id is not distinct from $2 and revoked_at is null", [user.id, organisation]);
      await run("insert into calendar_feeds (user_id, organisation_id, kind, token_hash) values ($1, $2, $3, $4)", [user.id, organisation, kind, feedHash(token)]);
    });
  } catch (error) {
    const failed = asDbError(error);
    console.error("[calendar] feed failed", failed.code);
    return { ok: false, error: describeDbError(failed, "The link could not be made. Try again.") };
  }
  revalidatePath("/", "layout");
  return { ok: true, error: null, link: `${await siteOrigin()}/ics/${token}.ics` };
}

export async function stopCalendarFeed(form: FormData): Promise<void> {
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) return;
  await sql("update calendar_feeds set revoked_at = now() where id = $1 and revoked_at is null", [id]);
  revalidatePath("/", "layout");
}
