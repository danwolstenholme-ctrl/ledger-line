"use server";

import { revalidatePath } from "next/cache";

import { sql } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Put a company's getting-started steps away, for the person asking only. */
export async function hideGettingStarted(form: FormData) {
  const organisation = String(form.get("organisation_id") ?? "");
  if (!UUID.test(organisation)) return;
  await sql("insert into user_dismissals (user_id, organisation_id, what) values (app_user_id(), $1, 'getting_started') on conflict do nothing", [organisation]);
  revalidatePath("/", "layout");
}
