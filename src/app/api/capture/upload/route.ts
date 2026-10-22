import { createHash } from "node:crypto";

import { one } from "@/lib/db";
import { getPractice } from "@/lib/org";

export const dynamic = "force-dynamic";

const ACCEPTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Files dropped into the practice's inbox, or into one company's. Stored, not yet read: each is read by its own request so a batch is read in parallel. */
export async function POST(request: Request) {
  const form = await request.formData();
  const practice = await getPractice();
  const files = form.getAll("files").filter((item): item is File => item instanceof File);
  // Uploaded from inside one company: where a document goes when nothing on it names a client.
  const requested = form.get("organisation_id");
  const company = typeof requested === "string" && /^[0-9a-f-]{36}$/i.test(requested) ? (await one<{ id: string }>("select id from organisations where id = $1", [requested]))?.id ?? null : null;
  if (!files.length) return Response.json({ ok: false, error: "Choose at least one file." }, { status: 400 });
  const saved = [];
  for (const file of files.slice(0, 25)) {
    const type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    if (!ACCEPTED.has(type)) { saved.push({ id: null, name: file.name, error: "Only PDF, JPG, PNG or WebP files can be read." }); continue; }
    if (file.size > 20 * 1024 * 1024) { saved.push({ id: null, name: file.name, error: "Files over 20 MB cannot be read." }); continue; }
    const bytes = Buffer.from(await file.arrayBuffer());
    const row = await one<{ id: string }>("insert into capture_files (practice_id, organisation_id, file_name, media_type, size_bytes, sha256, content) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [practice.id, company, file.name.slice(0, 200), type, bytes.length, createHash("sha256").update(bytes).digest("hex"), bytes]);
    saved.push({ id: row!.id, name: file.name, error: null });
  }
  return Response.json({ ok: true, files: saved });
}
