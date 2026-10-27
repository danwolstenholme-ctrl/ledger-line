import { searchRecords } from "@/lib/data/search";

export const dynamic = "force-dynamic";

/** What the command palette finds as someone types: `q`, in one company (`org`, its slug) or every company they can see. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("org");
  const results = await searchRecords(url.searchParams.get("q") ?? "", slug && /^[a-z0-9-]{1,80}$/.test(slug) ? slug : null);
  return Response.json({ results }, { headers: { "cache-control": "private, no-store" } });
}
