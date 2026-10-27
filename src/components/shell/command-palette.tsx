"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Banknote, BriefcaseBusiness, Building2, CornerDownLeft, FilePen, FileText, Inbox, Loader2, Package, Receipt, Search, Truck, UserRound, Users, type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { SearchHit, SearchKind } from "@/lib/data/search";
import { useCompanies, type CompanyEntry } from "@/components/shell/companies";
import { hasWords, matchOf, plain, readRecent, rememberCompany, sameSection } from "@/components/shell/finding";
import { EASE } from "@/components/motion/motion";

/** Something to do or somewhere to go, offered before anything is typed and found by its words after. */
export type PaletteEntry = { id: string; label: string; detail?: string; href: string; icon: LucideIcon; keywords?: string };

type Item = { key: string; section: string; label: string; detail?: string; href: string; icon: LucideIcon; company?: CompanyEntry };

const KIND_ORDER: SearchKind[] = ["customer", "invoice", "quote", "bill", "supplier", "deal", "job", "product", "employee"];
const KIND_ICON: Record<SearchKind, LucideIcon> = {
  customer: Users, supplier: Truck, invoice: FileText, bill: Receipt, quote: FilePen, product: Package, deal: Inbox, job: BriefcaseBusiness, employee: Banknote,
};
const subscribeNothing = () => () => undefined;
const typingIn = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

/**
 * The command palette: ⌘K or Ctrl+K (or /) from any page. Before anything is
 * typed it offers what is usually done next; as letters arrive it finds
 * actions, pages, companies, and the company's own records (customers,
 * invoices, bills…) from the server, a few of each. Enter opens the one
 * highlighted. `scope`: the company being looked at, whose records it
 * searches; none on the practice's own pages, where it searches every client.
 */
export function CommandPalette({ actions, pages, scope, labels, pathname }: {
  actions: PaletteEntry[]; pages: PaletteEntry[]; scope: { slug: string; name: string } | null;
  labels: Partial<Record<SearchKind, string>>; pathname: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [found, setFound] = useState<{ term: string; scope: string | null; hits: SearchHit[] } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const companies = (useCompanies(open) ?? []).filter(entry => !entry.practice);
  const shortcut = useSyncExternalStore(subscribeNothing, () => /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K", () => null);
  // In the browser only: the server has no body to hang the palette on.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);

  const show = () => { setRecent(readRecent()); setQuery(""); setActive(0); setOpen(true); };
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };

  // ⌘K or Ctrl+K anywhere opens and closes it; / opens it when not typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close(); else show();
      } else if (event.key === "/" && !open && !event.metaKey && !event.ctrlKey && !typingIn(event.target)) { event.preventDefault(); show(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // The page behind stays where it was.
  useEffect(() => {
    if (!open) return;
    const before = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = before; };
  }, [open]);

  // The company's records, from the server, a moment after the typing stops.
  const term = query.trim();
  const where = scope?.slug ?? null;
  const wanted = open && term.length >= 2;
  const answered = found !== null && found.term === term && found.scope === where;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}${where ? `&org=${where}` : ""}`, { signal: controller.signal, cache: "no-store" })
        .then(response => response.ok ? response.json() as Promise<{ results: SearchHit[] }> : { results: [] })
        .then(body => setFound({ term, scope: where, hits: body.results }))
        .catch(() => { /* superseded, or offline: the rest still works */ });
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [wanted, term, where]);

  const q = plain(term);
  const items: Item[] = [];
  const add = (section: string, list: Omit<Item, "section" | "key">[]) => list.forEach((entry, index) => items.push({ ...entry, section, key: `${section}-${index}-${entry.href}` }));
  const companyItem = (entry: CompanyEntry, via: string | null): Omit<Item, "section" | "key"> =>
    ({ label: entry.name, detail: via || [entry.he, entry.vat].filter(Boolean).join(" · ") || undefined, href: sameSection(pathname, entry.slug), icon: Building2, company: entry });
  if (!q) {
    add("Actions", actions.slice(0, 6));
    if (companies.length > 1) add("Recent companies", recent.map(slug => companies.find(entry => entry.slug === slug)).filter((entry): entry is CompanyEntry => Boolean(entry) && entry?.slug !== where).slice(0, 4).map(entry => companyItem(entry, null)));
    add("Go to", pages.slice(0, 8));
  } else {
    if (companies.length > 1) add("Companies", companies.map(entry => ({ entry, via: matchOf(entry, q) })).filter(row => row.via !== null)
      .sort((a, b) => Number(!plain(a.entry.name).startsWith(q)) - Number(!plain(b.entry.name).startsWith(q)) || a.entry.name.localeCompare(b.entry.name))
      .slice(0, 6).map(row => companyItem(row.entry, row.via)));
    add("Actions", actions.filter(entry => hasWords(`${entry.label} ${entry.keywords ?? ""}`, q)).slice(0, 6));
    add("Go to", pages.filter(entry => hasWords(`${entry.label} ${entry.keywords ?? ""}`, q)).slice(0, 6));
    if (answered) for (const kind of KIND_ORDER) add(labels[kind] ?? kind, found.hits.filter(hit => hit.kind === kind).map(hit => ({ label: hit.title, detail: hit.detail, href: hit.href, icon: KIND_ICON[kind] })));
  }
  const current = Math.min(active, Math.max(items.length - 1, 0));
  useEffect(() => { if (open) document.getElementById(`palette-${current}`)?.scrollIntoView({ block: "nearest" }); }, [open, current]);

  const pick = (item: Item) => {
    if (item.company) rememberCompany(item.company.slug);
    close(false);
    router.push(item.href);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(Math.min(current + 1, items.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(current - 1, 0)); }
    else if (event.key === "Enter" && items[current]) { event.preventDefault(); pick(items[current]); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
  };
  const sections = [...new Set(items.map(item => item.section))];
  const searching = wanted && !answered;

  return <>
    <button ref={trigger} type="button" onClick={show} aria-label="Search or jump to" aria-keyshortcuts="Meta+K Control+K /" aria-haspopup="dialog"
      className="border-hairline-strong bg-surface text-ink-faint hover:border-ink-faint/60 hover:text-ink-muted flex h-8 shrink-0 items-center gap-2 rounded-md border px-2.5 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 md:w-[240px] xl:w-[300px] touch:size-11 touch:justify-center touch:border-transparent touch:px-0 md:touch:w-[240px] md:touch:justify-start md:touch:border-hairline-strong md:touch:px-2.5">
      <Search className="size-3.5 shrink-0 touch:size-[18px]" />
      <span className="hidden flex-1 text-left text-[13px] md:block">Search or jump to…</span>
      {shortcut ? <kbd className="border-hairline bg-surface-sunken text-ink-faint hidden rounded border px-1.5 font-sans text-[11px] leading-[18px] md:block">{shortcut}</kbd> : null}
    </button>
    {!mounted ? null : createPortal(<AnimatePresence>
      {open ? <div key="palette" className="fixed inset-0 z-[80] print:hidden">
        <motion.div aria-hidden className="bg-brand-deep/25 absolute inset-0 backdrop-blur-[2px]" onClick={() => close()}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE }} />
        <motion.div role="dialog" aria-modal="true" aria-label="Search and jump"
          className="bg-surface border-hairline relative mx-auto mt-[10vh] flex max-h-[76vh] w-[min(640px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border shadow-[0_24px_64px_-12px_rgb(16_24_40/0.3)] touch:mt-3"
          initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.1 } }}>
          <div className="border-hairline flex items-center gap-3 border-b px-4">
            <Search className="text-ink-faint size-4 shrink-0" />
            <input autoFocus value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown}
              role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={items[current] ? `palette-${current}` : undefined}
              aria-label="Search or jump to" placeholder={scope ? `Search ${scope.name.replace(/ (Ltd|Limited)$/, "")}, or jump to…` : "Search every client, or jump to…"}
              className="placeholder:text-ink-faint text-ink h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
            {searching ? <Loader2 aria-label="Searching" className="text-ink-faint size-4 shrink-0 animate-spin" /> : null}
            <kbd className="border-hairline text-ink-faint hidden rounded border px-1.5 font-sans text-[11px] leading-[18px] sm:block">Esc</kbd>
          </div>
          <ul id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
            {sections.map(section => <li key={section} role="presentation" className="pb-1">
              <p aria-hidden className="ll-eyebrow px-2.5 pt-2 pb-1">{section}</p>
              <ul role="group" aria-label={section}>{items.map((item, index) => item.section !== section ? null :
                <li key={item.key} id={`palette-${index}`} role="option" aria-selected={index === current} onMouseMove={() => { if (index !== current) setActive(index); }} onClick={() => pick(item)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 touch:py-3", index === current ? "bg-brand-50" : "")}>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", index === current ? "bg-surface text-brand shadow-xs" : "bg-surface-sunken text-ink-muted")}><item.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block truncate text-[13.5px] font-medium">{item.label}</span>
                    {item.detail ? <span className="text-ink-faint block truncate text-[12px]">{item.detail}</span> : null}
                  </span>
                  {index === current ? <CornerDownLeft aria-hidden className="text-ink-faint size-3.5 shrink-0" /> : null}
                </li>)}</ul>
            </li>)}
            {!items.length ? <li role="presentation" className="text-ink-muted flex items-center gap-2 px-3 py-6 text-[13px]">
              {searching ? <><Loader2 className="size-4 animate-spin" />Searching…</> : <><UserRound className="text-ink-faint size-4" />Nothing found for “{term}”. Try a name, a number, or what you want to do.</>}
            </li> : null}
          </ul>
          <p className="border-hairline text-ink-faint flex gap-4 border-t px-4 py-2 text-[12px] touch:hidden"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></p>
        </motion.div>
      </div> : null}
    </AnimatePresence>, document.body)}
  </>;
}
