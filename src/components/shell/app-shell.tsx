"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "@/components/navigation/navigation-link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgeCheck, BarChart3, FolderCheck, Bell, BookOpen, BriefcaseBusiness, CalendarClock, ClipboardCheck, Coins, Timer, Check, ChevronDown, ChevronRight, ChevronsUpDown, FilePen, FileText, Home, Inbox, Landmark,
  LayoutDashboard, ListChecks, NotebookPen, Package, PanelLeft, Percent, Receipt, ScanText, Search, Settings, ShieldCheck, Truck, Users, X, type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { slugFromPath } from "@/lib/domain/paths";
import { NavigationContent, NavigationProvider } from "@/components/navigation/navigation-provider";
import { LedgerlineMark } from "@/components/brand/ledgerline-mark";
import { MenuPanel, Motion, NavigationProgress } from "@/components/motion/motion";
import { TimerControl, type TimerRunning } from "@/components/work/timer-control";
import { UserMenu } from "@/components/shell/user-menu";
import { motion } from "motion/react";

export type ShellPractice = { name: string; initials: string; brand_color: string; tagline: string | null };
export type ShellClient = { id: string; slug: string; name: string; industry: string; practice: boolean; toReview: number };
/** The person signed in. `role`: their role at the practice, or what they are to their company. `demo`: the laptop demo's sign-in. */
export type ShellUser = { name: string; initials: string; email: string; role: string; demo: boolean };

/** `also`: other paths that belong to this item, as credit notes belong to Invoices. */
type NavItem = { href: string; label: string; icon: LucideIcon; title: string; badge?: number; also?: string[] };
type NavGroup = { label: string | null; items: NavItem[]; more?: boolean };

/**
 * The application shell: fixed left navigation, a sticky top bar, scrolling
 * content. One company at a time: the switcher at the top of the menu changes
 * it, and the menu below is that company's, grouped by what the owner does
 * (sell, buy, bank, keep in touch) with the accountant's pages under More.
 */
/** `member`: one of the practice's people. A client company's own people get their company's menu only: none of the practice's pages. */
type ShellProps = { practice: ShellPractice; clients: ShellClient[]; user: ShellUser; member: boolean; toReview: number; timer: TimerRunning | null; children: ReactNode };

export function AppShell(props: ShellProps) {
  return <NavigationProvider><Motion><NavigationProgress /><WorkspaceShell {...props} /></Motion></NavigationProvider>;
}

export function PracticeMark({ practice, size = "md" }: { practice: Pick<ShellPractice, "initials" | "name" | "tagline">; size?: "md" | "lg" }) {
  return <span className="flex min-w-0 items-center gap-3">
    <span className={cn("bg-brand grid shrink-0 place-items-center rounded-[2px] font-semibold tracking-tight text-white", size === "lg" ? "size-11 text-[16px]" : "size-10 text-[14px]")}>{practice.initials}</span>
    <span className="bg-hairline-strong h-9 w-px shrink-0" />
    <span className="min-w-0">
      <span className={cn("text-ink-muted block leading-tight", size === "lg" ? "text-[16px]" : "text-[12.5px]")}>{practice.name}</span>
      {practice.tagline ? <span className="text-ink-faint block truncate text-[10.5px] leading-tight">{practice.tagline}</span> : null}
    </span>
  </span>;
}

const shortName = (name: string) => name.replace(/ (Ltd|Limited)$/, "");

function companyNav(base: string, client: ShellClient): NavGroup[] {
  return [
    { label: null, items: [{ href: base, label: "Home", icon: Home, title: "Home" }] },
    { label: "Sales", items: [
      { href: `${base}/sales`, label: "Invoices", icon: FileText, title: "Invoices", also: [`${base}/credit-notes`, `${base}/repeating`] },
      { href: `${base}/quotes`, label: "Quotes", icon: FilePen, title: "Quotes" },
      { href: `${base}/customers`, label: "Customers", icon: Users, title: "Customers" },
      { href: `${base}/items`, label: "Products", icon: Package, title: "Products and services" },
    ] },
    { label: "Purchases", items: [
      { href: `${base}/bills`, label: "Bills", icon: Receipt, title: "Bills", also: [`${base}/supplier-credits`] },
      { href: `${base}/suppliers`, label: "Suppliers", icon: Truck, title: "Suppliers" },
    ] },
    { label: "Money", items: [
      { href: `${base}/bank`, label: "Bank", icon: Landmark, title: "Bank" },
      { href: `${base}/capture`, label: "Upload receipts", icon: ScanText, title: "Upload receipts", badge: client.toReview },
    ] },
    { label: "CRM", items: [
      { href: `${base}/crm/enquiries`, label: "Enquiries", icon: Inbox, title: "Enquiries" },
      { href: `${base}/crm/matters`, label: "Matters", icon: BriefcaseBusiness, title: "Matters" },
      { href: `${base}/crm/tasks`, label: "Tasks", icon: ListChecks, title: "Tasks" },
    ] },
    { label: "Reports", items: [
      { href: `${base}/reports`, label: "Reports", icon: BarChart3, title: "Reports" },
      { href: `${base}/reports/vat`, label: "VAT returns", icon: Percent, title: "VAT returns" },
      { href: `${base}/deadlines`, label: "Deadlines", icon: CalendarClock, title: "Deadlines" },
      { href: `${base}/year-end`, label: "Year end", icon: ClipboardCheck, title: "Year end and audit" },
    ] },
    { label: "More", more: true, items: [
      { href: `${base}/chart`, label: "Chart of accounts", icon: BookOpen, title: "Chart of accounts" },
      { href: `${base}/journals`, label: "Journals", icon: NotebookPen, title: "Journals" },
      { href: `${base}/audit`, label: "Audit trail", icon: ShieldCheck, title: "Audit trail" },
      { href: `${base}/settings`, label: "Company settings", icon: Settings, title: "Company settings" },
      { href: `${base}/settings/people`, label: "People", icon: Users, title: "People" },
    ] },
  ];
}

/** Where the same section is in another company: an invoice's page becomes the invoice list, and so on. */
function sameSection(pathname: string, slug: string) {
  const rest = pathname.replace(/^\/c\/[a-z0-9-]+/, "").split("/").filter(Boolean);
  const keep = rest[0] === "crm" || rest[0] === "reports" ? rest.slice(0, 2) : rest.slice(0, 1);
  const section = keep.filter(part => part !== "new" && !/^[0-9a-f-]{36}$/.test(part));
  return `/c/${slug}${section.length ? `/${section.join("/")}` : ""}`;
}

function CompanySwitcher({ clients, current, pathname, onNavigate, member }: { clients: ShellClient[]; current: ShellClient | undefined; pathname: string; onNavigate: () => void; member: boolean }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [open]);
  const shown = clients.filter(entry => !entry.practice && entry.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const firm = clients.find(entry => entry.practice);
  const done = () => { setOpen(false); setFilter(""); onNavigate(); };
  return <div ref={ref} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="true"
      className="border-hairline-strong hover:bg-muted bg-surface flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 touch:py-3">
      <span className={cn("grid size-7 shrink-0 place-items-center rounded text-[11px] font-semibold", current ? "bg-brand-50 text-brand" : "bg-surface-sunken text-ink-muted")}>
        {current ? current.name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() : <LayoutDashboard className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink block truncate text-[12.5px] leading-tight font-semibold">{current ? shortName(current.name) : "All clients"}</span>
        <span className="text-ink-faint block truncate text-[11px] leading-tight">{current ? current.industry : `${clients.filter(entry => !entry.practice).length} companies`}</span>
      </span>
      <ChevronsUpDown className="text-ink-faint size-3.5 shrink-0" />
    </button>
    <MenuPanel open={open} role="dialog" className="bg-surface border-hairline absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border shadow-lg">
      <div className="border-hairline flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="text-ink-faint size-3.5 shrink-0" />
        <input autoFocus value={filter} onChange={event => setFilter(event.target.value)} placeholder="Switch company…" aria-label="Find a company" className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
      </div>
      <ul className="max-h-[60vh] overflow-y-auto py-1">
        {member ? <li><Link href="/" onClick={done} className="text-ink-muted hover:bg-muted flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] touch:py-3"><LayoutDashboard className="size-3.5" />Practice dashboard</Link></li> : null}
        {firm && member ? <li className="border-hairline mb-1 border-b pb-1"><Link href={sameSection(pathname, firm.slug)} onClick={done} className={cn("hover:bg-muted flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] touch:py-3", firm.slug === current?.slug ? "text-brand font-medium" : "text-ink-muted")}>
          <BookOpen className="size-3.5" /><span className="min-w-0 flex-1 truncate">Your firm’s own books</span>{firm.slug === current?.slug ? <Check className="size-3.5" /> : null}</Link></li> : null}
        {shown.map(entry => <li key={entry.slug}>
          <Link href={sameSection(pathname, entry.slug)} onClick={done} className={cn("hover:bg-muted flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] touch:py-3", entry.slug === current?.slug ? "text-brand font-medium" : "text-ink")}>
            <span className="min-w-0 flex-1 truncate">{shortName(entry.name)}</span>
            {entry.toReview ? <span className="bg-brand rounded px-1.5 text-[10.5px] leading-[18px] font-semibold text-white tabular-nums" title="Documents to review">{entry.toReview}</span> : null}
            {entry.slug === current?.slug ? <Check className="size-3.5" /> : null}
          </Link>
        </li>)}
        {!shown.length ? <li className="text-ink-faint px-2.5 py-1.5 text-[12px]">No company by that name.</li> : null}
      </ul>
    </MenuPanel>
  </div>;
}

function WorkspaceShell({ practice, clients, user, member, toReview, timer, children }: ShellProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const slug = slugFromPath(pathname);
  const client = clients.find(item => item.slug === slug);
  const base = client ? `/c/${client.slug}` : "";
  const practiceGroups: NavGroup[] = [{ label: null, items: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, title: "Practice dashboard" },
    { href: "/deadlines", label: "Deadlines", icon: CalendarClock, title: "Deadlines" },
    { href: "/time", label: "Time", icon: Timer, title: "Time" },
    { href: "/fees", label: "Fees", icon: Coins, title: "Fees" },
    { href: "/clients", label: "Client files", icon: FolderCheck, title: "Client files" },
    { href: "/vat-numbers", label: "VAT numbers", icon: BadgeCheck, title: "VAT numbers" },
    { href: "/capture", label: "Capture", icon: ScanText, title: "Capture", badge: toReview },
    { href: "/settings", label: "Practice settings", icon: Settings, title: "Practice settings" },
  ] }];
  const groups = client ? companyNav(base, client) : member ? practiceGroups : [];
  const items = groups.flatMap(group => group.items);
  // The longest matching href wins, so /c/x/reports/vat is VAT returns and /c/x/sales/new is Invoices.
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const current = [...items].sort((a, b) => b.href.length - a.href.length)
    .find(item => item.href === "/" ? pathname === "/" : pathname === item.href || (item.href !== base && under(item.href)) || (item.also ?? []).some(under))
    ?? (pathname === "/compare" ? { href: "/compare", label: "Compared", icon: LayoutDashboard, title: "Ledgerline compared" } : undefined);
  const moreActive = groups.some(group => group.more && group.items.some(item => item.href === current?.href));
  // Where this page is: the practice, the company, the section. The page names itself below.
  const crumbs = [{ href: "/", label: practice.name },
    ...(client ? [{ href: base, label: shortName(client.name) }] : []),
    ...(current && current.href !== "/" && current.href !== base ? [{ href: current.href, label: client ? current.label : current.title }] : [])];
  const [moreOpen, setMoreOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  // On a short screen the menu scrolls: keep the page's own item in sight.
  useEffect(() => { navRef.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest" }); }, [pathname]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const item = (active: boolean) => cn("group relative flex items-center gap-2.5 rounded-md py-[5px] pr-2.5 pl-2.5 text-[12.5px] transition-colors touch:gap-3 touch:py-3 touch:text-[15px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active ? "text-brand font-medium" : "text-ink-muted hover:bg-muted hover:text-ink");
  const search = (event: React.FormEvent) => {
    event.preventDefault();
    const term = query.trim().toLowerCase();
    if (!term) return;
    if (client) { router.push(`${base}/customers?q=${encodeURIComponent(query.trim())}`); return; }
    const found = clients.find(entry => entry.name.toLowerCase().includes(term));
    if (found) router.push(`/c/${found.slug}`);
  };
  const link = (entry: NavItem) => {
    const active = current?.href === entry.href;
    return <li key={entry.href}><Link href={entry.href} onClick={close} aria-current={active ? "page" : undefined} className={item(active)}>
      {active ? <motion.span layoutId="nav-active" aria-hidden className="bg-accent absolute inset-0 rounded-md">
        <span className="bg-brand absolute top-[calc(50%-8px)] -left-2.5 h-4 w-[2px] rounded-r" />
      </motion.span> : null}
      <entry.icon className={cn("relative size-[14px] shrink-0 touch:size-[18px]", active ? "text-brand" : "text-ink-faint group-hover:text-ink-muted")} />
      <span className="relative truncate">{entry.label}</span>
      {entry.badge ? <span className="bg-brand relative ml-auto rounded px-1.5 text-[10.5px] leading-[18px] font-semibold text-white tabular-nums">{entry.badge}</span> : null}
    </Link></li>;
  };

  return <div className="flex min-h-dvh">
    <aside aria-label="Main navigation" className={cn("bg-sidebar border-hairline fixed inset-y-0 left-0 z-50 flex w-[224px] flex-col border-r print:hidden",
      "transition-transform duration-200 ease-out lg:translate-x-0", open ? "translate-x-0 shadow-xl" : "-translate-x-full lg:shadow-none")}>
      <div className="border-hairline flex h-16 shrink-0 items-center justify-between border-b pr-3 pl-4">
        <Link href="/" onClick={close} className="min-w-0 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={`${practice.name} dashboard`}><PracticeMark practice={practice} /></Link>
        <button type="button" onClick={close} className="hover:bg-muted text-ink-muted grid size-7 shrink-0 place-items-center rounded-md lg:hidden touch:size-11" aria-label="Close navigation"><X className="size-4" /></button>
      </div>
      <div className="px-2.5 pt-3"><CompanySwitcher clients={clients} current={client} pathname={pathname} onNavigate={close} member={member} /></div>
      <nav ref={navRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-3">
        {groups.map((group, index) => {
          if (group.more) {
            const expanded = moreOpen || moreActive;
            return <div key={group.label} className="border-hairline mt-3 border-t pt-2">
              <button type="button" onClick={() => setMoreOpen(value => !value)} aria-expanded={expanded} className="text-ink-faint hover:text-ink-muted flex w-full items-center gap-1 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase">
                {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}{group.label}
              </button>
              {expanded ? <ul className="mt-0.5 space-y-0.5">{group.items.map(link)}</ul> : null}
            </div>;
          }
          return <div key={group.label ?? index} className={cn(group.label && "mt-3")}>
            {group.label ? <p className="ll-eyebrow mb-1 px-2.5">{group.label}</p> : null}
            <ul className="space-y-0.5">{group.items.map(link)}</ul>
          </div>;
        })}
      </nav>
      <div className="border-hairline border-t px-4 py-2.5">
        <Link href="/compare" onClick={close} className="text-ink-faint hover:text-ink inline-flex items-center gap-1.5 text-[11px]">Powered by <LedgerlineMark className="size-3.5" title="" /><span className="text-ink-muted font-semibold">Ledgerline</span></Link>
      </div>
    </aside>
    {open ? <button type="button" aria-label="Close navigation" onClick={close} className="bg-brand-deep/25 fixed inset-0 z-40 lg:hidden" /> : null}
    <div className="flex min-w-0 flex-1 flex-col lg:pl-[224px] print:pl-0">
      <header className="bg-surface border-hairline sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:px-5 print:hidden">
        <button type="button" onClick={() => setOpen(true)} className="hover:bg-muted text-ink-muted -ml-1 grid size-8 shrink-0 place-items-center rounded-md lg:hidden touch:size-11" aria-label="Open navigation"><PanelLeft className="size-4" /></button>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1 text-[12.5px] leading-tight">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return <li key={crumb.href} className={cn("flex min-w-0 items-center gap-1", index === 0 && crumbs.length > 1 && "hidden sm:flex", last ? "shrink" : "shrink-[2]")}>
                {index > 0 ? <ChevronRight aria-hidden className={cn("text-ink-faint size-3.5 shrink-0", index === 1 && "hidden sm:block")} /> : null}
                {last && pathname === crumb.href ? <span aria-current="page" className="text-ink truncate font-medium">{crumb.label}</span>
                  : <Link href={crumb.href} className={cn("hover:text-ink truncate rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", last ? "text-ink font-medium" : "text-ink-muted")}>{crumb.label}</Link>}
              </li>;
            })}
          </ol>
        </nav>
        {member ? <TimerControl running={timer} currentSlug={slug} companies={clients.map(entry => ({ id: entry.id, name: entry.name, slug: entry.slug, practice: entry.practice }))} /> : null}
        <form onSubmit={search} className="border-hairline-strong bg-surface hidden h-8 w-[220px] items-center gap-2 rounded-md border px-2.5 md:flex xl:w-[260px]">
          <Search className="text-ink-faint size-3.5 shrink-0" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={client ? "Search customers" : "Search clients"} aria-label="Search" className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
        </form>
        <Link href={client ? `${base}/capture` : "/capture"} aria-label={toReview ? `${toReview} documents to review` : "Documents"} className="text-ink-muted hover:bg-muted relative grid size-8 place-items-center rounded-md">
          <Bell className="size-4" />{toReview ? <span className="bg-critical absolute top-1.5 right-1.5 size-1.5 rounded-full" /> : null}
        </Link>
        <span className="bg-hairline mx-0.5 hidden h-6 w-px sm:block" />
        <UserMenu user={user} />
      </header>
      <main className="min-w-0 flex-1"><NavigationContent scope="page" label="Loading…" variant="page">{children}</NavigationContent></main>
    </div>
  </div>;
}
