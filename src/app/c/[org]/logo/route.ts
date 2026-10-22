import { one } from "@/lib/db";
import { requireOrg } from "@/lib/org";

/** The company's logo, as its settings show it. */
export async function GET() {
  const org = await requireOrg();
  const logo = await one<{ media_type: string; content: Uint8Array }>("select media_type, content from organisation_logos where organisation_id = $1", [org.id]);
  if (!logo) return new Response("No logo.", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(logo.content), { headers: { "content-type": logo.media_type, "cache-control": "private, no-store" } });
}
