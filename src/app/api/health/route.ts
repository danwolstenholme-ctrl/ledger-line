import { asService, one } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Opens the database (seeding it the first time) and says it is ready. */
async function handleGET() {
  const row = await one<{ organisations: number; entries: number }>("select (select count(*) from organisations) as organisations, (select count(*) from journal_entries) as entries");
  return Response.json({ ok: true, ...row });
}

/** The health check counts the whole database, so it reads with the owner's rights. It returns counts only. */
export function GET() {
  return asService("the health check counts the whole database", () => handleGET());
}
