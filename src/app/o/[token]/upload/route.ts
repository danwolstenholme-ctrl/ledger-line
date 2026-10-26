import { keepDocument } from "@/lib/client-documents";
import { fileForToken, seeOther } from "@/lib/clients/client-link";
import { asService } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One document from the client, for one of the practice's requests. */
async function handlePOST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await fileForToken(token);
  if (!found || found.file.status === "declined") return seeOther(`/o/${token}`);
  const form = await request.formData();
  const documentId = String(form.get("document") ?? "");
  const upload = form.get("file");
  const request_ = found.documents.find(document => document.id === documentId);
  const problem = !request_ ? "That request is no longer on the list."
    : request_.received_at ? null
    : !(upload instanceof File) || !upload.size ? "Choose the file first, then press Upload."
    : await keepDocument(documentId, found.file.id, upload, "client");
  return seeOther(`/o/${token}${problem ? `?problem=${encodeURIComponent(problem)}` : "?uploaded=1"}`);
}

/** Runs for a client sending a document through their private link: with the database owner's rights, and so only after the token or key is checked. */
export function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return asService("a client sending a document through their private link", () => handlePOST(request, { params }));
}
