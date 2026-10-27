import { Mail, MapPin, MessageCircle, Phone, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Reaching someone from their record without connecting anything: call,
 * WhatsApp or Viber with the message already written, email, and their
 * card saved to the phone's contacts. Plain links the phone already knows
 * how to open; no account, no API.
 */

const DIALLING: Record<string, string> = { CY: "357", GB: "44" };

/** A number as WhatsApp and Viber want it: country code and digits, no plus, no leading zero. */
export function internationalNumber(phone: string, country = "CY") {
  const raw = phone.trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (raw.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  const code = DIALLING[country] ?? "357";
  if (digits.startsWith(code) && digits.length > code.length + 6) return digits;
  return `${code}${digits.replace(/^0+/, "")}`;
}

const escapeCard = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, match => `\\${match}`);
/** A contact card (vCard 3.0) to save to the phone. */
export function vCard({ name, company, email, phone, role }: { name: string; company?: string | null; email?: string | null; phone?: string | null; role?: string | null }) {
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : "";
  return ["BEGIN:VCARD", "VERSION:3.0", `N:${escapeCard(last)};${escapeCard(parts.join(" "))};;;`, `FN:${escapeCard(name)}`,
    ...(company ? [`ORG:${escapeCard(company)}`] : []), ...(role ? [`TITLE:${escapeCard(role)}`] : []), ...(email ? [`EMAIL;TYPE=WORK:${email}`] : []),
    ...(phone ? [`TEL;TYPE=CELL:${phone.replace(/\s+/g, " ").trim()}`] : []), "END:VCARD"].join("\r\n");
}

const chip = "border-hairline-strong text-ink hover:bg-muted inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] touch:min-h-10 touch:px-3";

export function ContactLinks({ name, email, phone, company, role, message, country = "CY", className }: {
  name: string; email?: string | null; phone?: string | null; company?: string | null; role?: string | null; message?: string; country?: string; className?: string;
}) {
  const number = phone ? internationalNumber(phone, country) : null;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  if (!number && !email) return null;
  return <div className={cn("flex flex-wrap gap-1.5", className)}>
    {number ? <a href={`tel:+${number}`} className={chip}><Phone className="size-3.5" />Call</a> : null}
    {number ? <a href={`https://wa.me/${number}${text}`} target="_blank" rel="noreferrer" className={chip}><MessageCircle className="size-3.5" />WhatsApp</a> : null}
    {number ? <a href={`viber://chat?number=%2B${number}`} className={chip}><MessageCircle className="size-3.5" />Viber</a> : null}
    {email ? <a href={`mailto:${encodeURIComponent(email)}`} className={chip}><Mail className="size-3.5" />Email</a> : null}
    <a href={`data:text/vcard;charset=utf-8,${encodeURIComponent(vCard({ name, company, email, phone, role }))}`} download={`${name.replace(/[^\p{L}\p{N} .-]+/gu, "").trim() || "contact"}.vcf`} className={chip}><UserPlus className="size-3.5" />Save contact</a>
  </div>;
}

/** An address opened in the phone's maps. */
export function MapLink({ address }: { address: string }) {
  return <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="text-brand inline-flex items-center gap-1 hover:underline">
    <MapPin className="size-3.5" />{address}
  </a>;
}
