import { one } from "@/lib/db";
import { companyForToken } from "@/lib/crm/intake";
import { enquiryPage } from "@/lib/crm/form-page";

export const dynamic = "force-dynamic";

/** A company's hosted enquiry form: link to it, or open it from any website. ?sent=1 is the thank-you. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const company = await companyForToken(token);
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (!company) return html(enquiryPage({ state: "problem", message: "This form is not taking enquiries at the moment." }), 404);
  const logo = Boolean(await one("select 1 from organisation_logos where organisation_id = $1", [company.id]));
  if (new URL(request.url).searchParams.get("sent") === "1") return html(enquiryPage({ state: "sent", company, logo }));
  return html(enquiryPage({ state: "form", company, token, logo }));
}
