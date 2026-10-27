import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";

import "./globals.css";

const roboto = Roboto({ subsets: ["latin", "greek"], variable: "--font-roboto", display: "swap" });
const robotoMono = Roboto_Mono({ subsets: ["latin", "greek"], variable: "--font-roboto-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Ledgerline", template: "%s · Ledgerline" },
  description: "Books, AI capture and a practice dashboard for Cyprus accountants.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { colorScheme: "light" };

/** The page itself. What is behind sign-in gets the app's menu and top bar from (app)/layout; signing in, its own. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GB" className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}>
    <body className="bg-canvas text-ink min-h-full">{children}</body>
  </html>;
}
