import { createHash } from "node:crypto";

import { transaction } from "@/lib/db";
import { fileForToken, seeOther } from "@/lib/clients/client-link";
import { letterText } from "@/lib/domain/onboarding";

export const dynamic = "force-dynamic";

/**
 * The client signs the letter. What they signed is checked against the
 * fingerprint taken when it was sent, and kept with who signed, when, and
 * from where: a simple electronic signature, with its evidence.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await fileForToken(token);
  const back = (problem?: string) => seeOther(`/o/${token}${problem ? `?problem=${encodeURIComponent(problem)}` : "?signed=1"}`);
  if (!found || !found.letter) return seeOther(`/o/${token}`);
  const { file } = found;
  if (file.status === "declined") return seeOther(`/o/${token}`);
  if (file.signed_at) return back();
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  const position = String(form.get("position") ?? "").trim().slice(0, 100);
  if (name.split(" ").length < 2) return back("Write your full name, first name and surname, to sign.");
  if (!position) return back("Say your position in the company, such as Director.");
  if (form.get("agree") !== "1") return back("Tick the box to confirm you are authorised to sign and agree to the letter.");
  const hash = createHash("sha256").update(letterText(found.letter)).digest("hex");
  if (hash !== file.letter_hash) return back("This letter has changed since it was sent. Ask your accountant to send it again.");
  // The address it was signed from, as the server saw it; an IPv4 address written the IPv6 way loses its prefix.
  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "").trim().replace(/^::ffff:/, "").slice(0, 64) || "127.0.0.1";
  const agent = (request.headers.get("user-agent") ?? "").slice(0, 300);
  // On the audit trail as the person who signed, not as whoever is signed in to Ledgerline.
  await transaction(async run => {
    await run("select set_config('ledgerline.actor', $1, true)", [`${name} (client)`]);
    await run(`update client_files set signed_at = now(), signed_name = $2, signed_position = $3, signed_ip = $4, signed_agent = $5, signed_hash = $6
      where id = $1 and signed_at is null and letter_hash = $6`, [file.id, name, position, ip, agent, hash]);
  });
  return back();
}
