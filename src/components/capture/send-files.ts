/**
 * Sending documents to be read: stored first, in one request, then each read
 * by Claude in a request of its own, so a batch is read in parallel. Shared by
 * the drop zone and the phone's "Snap a receipt".
 */

export type Stored = { id: string | null; name: string; error: string | null };

export async function storeFiles(files: File[], organisationId?: string): Promise<{ ok: true; files: Stored[] } | { ok: false; error: string }> {
  const form = new FormData();
  files.forEach(file => form.append("files", file));
  if (organisationId) form.append("organisation_id", organisationId);
  const response = await fetch("/api/capture/upload", { method: "POST", body: form }).then(result => result.json()).catch(() => null) as { ok: boolean; files?: Stored[]; error?: string } | null;
  return response?.ok && response.files ? { ok: true, files: response.files } : { ok: false, error: response?.error ?? "The upload failed." };
}

/** Read one stored file: how many invoices were found in it, or why it could not be read. */
export async function readFile(id: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const result = await fetch(`/api/capture/files/${id}/read`, { method: "POST" }).then(reply => reply.json()).catch(() => null) as { ok: boolean; count?: number; error?: string } | null;
  return result ?? { ok: false, error: "Could not be read." };
}
