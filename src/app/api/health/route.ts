import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Opens the database (seeding it the first time) and says it is ready. */
export async function GET() {
  const row = await one<{ organisations: number; entries: number }>("select (select count(*) from organisations) as organisations, (select count(*) from journal_entries) as entries");
  return Response.json({ ok: true, ...row });
}
