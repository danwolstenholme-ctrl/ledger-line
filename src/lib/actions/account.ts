"use server";

import { revalidatePath } from "next/cache";

import { sql } from "@/lib/db";
import { isLocale } from "@/lib/i18n";

/** The language someone reads Ledgerline in: theirs alone, wherever they sign in. */
export async function chooseLanguage(form: FormData) {
  const locale = form.get("locale");
  if (!isLocale(locale)) return;
  await sql("update app_users set locale = $1 where id = app_user_id()", [locale]);
  revalidatePath("/", "layout");
}
