import { getPractice } from "@/lib/org";

export const dynamic = "force-dynamic";

const escape = (text: string) => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/** The browser tab's icon: the practice's initials on its colour, so the white label reaches the tab too. */
export async function GET() {
  const practice = await getPractice();
  const initials = escape(practice.initials.slice(0, 3));
  const size = initials.length > 2 ? 26 : 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${escape(practice.brand_color)}"/>` +
    `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="Roboto, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#fff">${initials}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
}
