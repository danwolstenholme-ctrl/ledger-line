"use server";

import { revalidatePath } from "next/cache";

import { one, sql } from "@/lib/db";
import { firmToday } from "@/lib/domain/invoices";
import { getCurrentUser } from "@/lib/org";

/** A deadline other than a VAT return, marked done or opened again. A VAT return closes itself when it is filed. */

const KINDS = ["vies", "provisional_tax", "tax_return"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function read(form: FormData) {
  const organisation = String(form.get("organisation_id") ?? ""), kind = String(form.get("kind") ?? ""), periodEnd = String(form.get("period_end") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(organisation) || !(KINDS as readonly string[]).includes(kind) || !DATE.test(periodEnd)) return null;
  return { organisation, kind, periodEnd };
}

export async function markDeadlineDone(form: FormData): Promise<void> {
  const input = read(form);
  if (!input || !(await one("select 1 from organisations where id = $1", [input.organisation]))) return;
  const user = await getCurrentUser();
  await sql(`insert into deadline_marks (organisation_id, kind, period_end, done_on, done_by) values ($1, $2, $3, $4, $5)
    on conflict (organisation_id, kind, period_end) do nothing`, [input.organisation, input.kind, input.periodEnd, firmToday(), user.name]);
  revalidatePath("/", "layout");
}

export async function reopenDeadline(form: FormData): Promise<void> {
  const input = read(form);
  if (!input) return;
  await sql("delete from deadline_marks where organisation_id = $1 and kind = $2 and period_end = $3", [input.organisation, input.kind, input.periodEnd]);
  revalidatePath("/", "layout");
}
