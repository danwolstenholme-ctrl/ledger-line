"use client";

import "./globals.css";

/** The last resort, when even the frame of the app could not be made. It brings its own page. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en-GB">
    <body className="bg-canvas text-ink grid min-h-dvh place-items-center p-6 font-sans antialiased">
      <title>Something went wrong</title>
      <main className="ll-panel w-full max-w-lg px-7 py-8">
        <p className="ll-eyebrow">Something went wrong</p>
        <h1 className="text-ink mt-1 text-[18px] font-semibold">Ledgerline could not start this page</h1>
        <p className="text-ink-muted mt-2 text-[13px] leading-relaxed">Nothing was lost: a change is either saved in full or not at all. Try again{error.digest ? `, and quote reference ${error.digest} if it keeps happening` : ""}.</p>
        <button type="button" onClick={() => retry()} className="bg-brand hover:bg-brand-dark mt-5 inline-flex min-h-8 items-center rounded-md px-3 text-[13px] font-medium text-white">Try again</button>
      </main>
    </body>
  </html>;
}
