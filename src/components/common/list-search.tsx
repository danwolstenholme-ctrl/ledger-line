import { Search } from "lucide-react";

import { NavigationForm } from "@/components/navigation/navigation-form";

/**
 * Find in a long list: a practice's hundreds of clients, a page at a time.
 * A plain GET form, so the search is in the address and the back button.
 * `keep`: other filters the page is showing, carried with the search.
 */
export function ListSearch({ action, value, placeholder, keep = {} }: { action: string; value?: string; placeholder: string; keep?: Record<string, string | undefined> }) {
  return <NavigationForm action={action} method="get" role="search" className="border-hairline-strong bg-surface flex h-8 w-full items-center gap-2 rounded-md border px-2.5 sm:w-72">
    {Object.entries(keep).map(([name, kept]) => kept ? <input key={name} type="hidden" name={name} value={kept} /> : null)}
    <Search className="text-ink-faint size-3.5 shrink-0" aria-hidden />
    <input name="q" defaultValue={value ?? ""} placeholder={placeholder} aria-label={placeholder} className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
  </NavigationForm>;
}

/** Whether a client matches what was typed: its name, or its registration or VAT number written any way. */
export function clientMatches(term: string, client: { name: string; he?: string | null; vat?: string | null }) {
  const query = term.trim().toLowerCase();
  if (!query) return true;
  if (client.name.toLowerCase().includes(query)) return true;
  const digits = query.replace(/[^a-z0-9]/g, "");
  return digits.length > 2 && [client.he, client.vat].some(number => (number ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(digits));
}
