import { getCompanyList } from "@/lib/data/shell";

export const dynamic = "force-dynamic";

/** The companies the person can see, for the company switcher: names and numbers to find them by, and what waits in each. */
export async function GET() {
  const rows = await getCompanyList();
  return Response.json({ companies: rows.map(row => ({ id: row.id, slug: row.slug, name: row.name, practice: row.practice, greek: row.greek, he: row.he, vat: row.vat, toReview: Number(row.to_review) })) },
    { headers: { "cache-control": "private, no-store" } });
}
