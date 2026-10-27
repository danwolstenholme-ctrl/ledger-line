import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import "./globals.css";

// Inter: drawn for screens, with Greek as well as Latin for Cyprus's names and addresses. Geist Mono for numbers and codes.
const inter = Inter({ subsets: ["latin", "latin-ext", "greek"], variable: "--font-inter", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Ledgerline", template: "%s · Ledgerline" },
  description: "Books, AI capture and a practice dashboard for Cyprus accountants.",
  robots: { index: false, follow: false },
  // Added to a phone's home screen, it opens in its own window like an app.
  appleWebApp: { capable: true, title: "Ledgerline", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { colorScheme: "light", themeColor: "#0d6e6e", viewportFit: "cover" };

/** The page itself. What is behind sign-in gets the app's menu and top bar from (app)/layout; signing in, its own. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-GB" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
    <body className="bg-canvas text-ink min-h-full">{children}</body>
  </html>;
}
