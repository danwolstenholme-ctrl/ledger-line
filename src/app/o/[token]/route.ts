import { clientPage } from "@/lib/clients/client-page";
import { fileForToken, htmlResponse } from "@/lib/clients/client-link";
import { asService } from "@/lib/db";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "ok" | "problem"; text: string }> = {
  signed: { tone: "ok", text: "Thank you: the letter is signed. You can download a copy below." },
  uploaded: { tone: "ok", text: "Received. Thank you." },
};

/** A new client's page: their engagement letter to sign and the documents to send. ?signed=1, ?uploaded=1 and ?problem= say what just happened. */
async function handleGET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await fileForToken(token);
  if (!found) return htmlResponse(clientPage({ token: "", practice: { name: "Ledgerline", initials: "L", colour: "#0d6e6e" }, company: "", contact: null, letter: null, signed: null, documents: [],
    closed: "This link isn’t one we recognise. Check you have the whole link from the email, or ask your accountant for a new one." }), 404);
  const query = new URL(request.url).searchParams;
  const problem = query.get("problem");
  const notice = problem ? { tone: "problem" as const, text: problem.slice(0, 200) } : NOTICES[[...query.keys()].find(key => key in NOTICES) ?? ""] ?? null;
  const { file } = found;
  return htmlResponse(clientPage({
    token, practice: found.practice, company: file.company_name, contact: file.contact_name, letter: found.letter,
    signed: file.signed_at && file.signed_name ? { name: file.signed_name, position: file.signed_position, at: file.signed_at } : null,
    documents: found.documents, notice,
    closed: file.status === "declined" ? `${found.practice.name} isn’t taking ${file.company_name} on, so this link is closed.` : null,
  }));
}

/** Runs for a client's private link: with the database owner's rights, and so only after the token or key is checked. */
export function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return asService("a client's private link", () => handleGET(request, { params }));
}
