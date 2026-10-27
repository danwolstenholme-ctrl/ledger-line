import type { MetadataRoute } from "next";

/** Ledgerline installed on a phone or a desk: its own window and an icon on the home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ledgerline",
    short_name: "Ledgerline",
    description: "Your company's books, invoices and receipts, kept with your accountant.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#0d6e6e",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
