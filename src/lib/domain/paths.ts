/**
 * The company's books live under /c/{slug}. Pages and components written for
 * one set of books link to /accounts/… and /invoices/…; this puts those links
 * inside the company being viewed. Client-safe.
 */
export function booksHref(href: string, slug: string | null | undefined) {
  if (!slug || !href.startsWith("/")) return href;
  const base = `/c/${slug}`;
  if (href.startsWith("/invoices/ageing")) return `${base}/reports/aged-receivables${href.slice("/invoices/ageing".length)}`;
  for (const [from, to] of [["/accounts", ""], ["/invoices", "/sales"]] as const) {
    if (href === from || href.startsWith(`${from}/`) || href.startsWith(`${from}?`)) return `${base}${to}${href.slice(from.length)}`;
  }
  return href;
}
export function slugFromPath(pathname: string) {
  return /^\/c\/([a-z0-9-]+)/.exec(pathname)?.[1] ?? null;
}
