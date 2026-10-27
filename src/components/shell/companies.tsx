"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { ShellCompany } from "@/lib/data/shell";

/**
 * The shell's view of the companies. The list (for the switcher, the timer
 * and the search) is fetched when first wanted and kept for the page's life,
 * fetched again each time the switcher opens so a client just added is
 * there. The company being looked at reaches the menu from its own layout
 * (CompanyShellSync), with the page, not in a list of every client.
 */

export type CompanyEntry = { id: string; slug: string; name: string; practice: boolean; greek: string | null; he: string | null; vat: string | null; toReview: number };

let list: CompanyEntry[] | null = null;
let pending: Promise<CompanyEntry[]> | null = null;
const listListeners = new Set<() => void>();

export function loadCompanies(fresh = false): Promise<CompanyEntry[]> {
  if (pending && !fresh) return pending;
  if (list && !fresh) return Promise.resolve(list);
  pending = fetch("/api/shell/companies", { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<{ companies: CompanyEntry[] }> : { companies: list ?? [] })
    .then(body => { list = body.companies; listListeners.forEach(listener => listener()); return list; })
    .catch(() => list ?? [])
    .finally(() => { pending = null; });
  return pending;
}

/** The list, once loaded: `want` loads it (and loads it afresh each time it turns true). */
export function useCompanies(want: boolean) {
  const value = useSyncExternalStore(subscribeList, () => list, () => null);
  useEffect(() => { if (want) void loadCompanies(true); }, [want]);
  return value;
}
function subscribeList(listener: () => void) { listListeners.add(listener); return () => { listListeners.delete(listener); }; }

let current: ShellCompany | null = null;
const currentListeners = new Set<() => void>();
function subscribeCurrent(listener: () => void) { currentListeners.add(listener); return () => { currentListeners.delete(listener); }; }

/** Rendered by a company's layout: tells the menu which company this is, in its own words. */
export function CompanyShellSync({ company }: { company: ShellCompany }) {
  useEffect(() => {
    current = company;
    currentListeners.forEach(listener => listener());
  }, [company]);
  return null;
}

/** The company being looked at: from its layout once mounted, from the first page's own render before that. */
export function useCurrentCompany(initial: ShellCompany | null, slug: string | null) {
  const synced = useSyncExternalStore(subscribeCurrent, () => current, () => null);
  const [first] = useState(initial);
  if (!slug) return null;
  if (synced && synced.slug === slug) return synced;
  if (first && first.slug === slug) return first;
  // Moving to another company: its layout is a moment away; keep the menu as it was meanwhile.
  return synced ?? first;
}
