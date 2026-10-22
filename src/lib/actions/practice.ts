"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { resetDemo, sql } from "@/lib/db";
import { FormParser, type ActionState } from "@/lib/actions/form";
import { getPractice } from "@/lib/org";

/** The practice's own brand: Ledgerline runs under it, "Powered by Ledgerline" underneath. */
export async function savePractice(_previous: ActionState, form: FormData): Promise<ActionState> {
  const p = new FormParser(form);
  const name = p.text("name", { required: true, max: 120, label: "Firm name" });
  const initials = p.text("initials", { required: true, max: 4, label: "Initials" });
  const tagline = p.text("tagline", { max: 120, label: "Tagline" });
  const color = p.text("brand_color", { required: true, max: 7, label: "Colour" });
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) p.errors.brand_color = "Choose a colour.";
  if (p.failed || !name || !initials || !color) return p.fail();
  const practice = await getPractice();
  await sql("update practices set name = $2, initials = $3, tagline = $4, brand_color = $5 where id = $1", [practice.id, name, initials.toUpperCase(), tagline, color.toLowerCase()]);
  revalidatePath("/", "layout");
  return { ok: true, error: null, notice: "Saved. Every screen now carries your brand." };
}

export async function resetDemoData(): Promise<void> {
  await resetDemo();
  revalidatePath("/", "layout");
  redirect("/");
}
