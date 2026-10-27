import { ImageResponse } from "next/og";

/**
 * The installed app's icons, drawn from Ledgerline's mark: rounded with room
 * around it for where an icon is shown as it is, full-bleed where the phone
 * cuts its own shape (Android's maskable icon, iOS's home screen).
 */
const ICONS: Record<string, { size: number; bleed: boolean }> = {
  "icon-192.png": { size: 192, bleed: false },
  "icon-512.png": { size: 512, bleed: false },
  "maskable-512.png": { size: 512, bleed: true },
  "apple-touch-icon.png": { size: 180, bleed: true },
};
const TEAL = "#0d6e6e";

export const dynamic = "force-static";
export function generateStaticParams() { return Object.keys(ICONS).map(name => ({ name })); }

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const icon = ICONS[(await params).name];
  if (!icon) return new Response("Not found", { status: 404 });
  const tile = icon.bleed ? icon.size : Math.round(icon.size * 0.86);
  const mark = Math.round(tile * 0.82);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: icon.bleed ? TEAL : "transparent" }}>
      <div style={{ width: tile, height: tile, borderRadius: icon.bleed ? 0 : Math.round(tile * 0.22), background: TEAL, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={mark} height={mark} viewBox="0 0 32 32">
          <path d="M7.5 21h17" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M7.5 14.5h9" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="21.5" cy="14.5" r="3.3" fill="#fff" />
        </svg>
      </div>
    </div>,
    { width: icon.size, height: icon.size },
  );
}
