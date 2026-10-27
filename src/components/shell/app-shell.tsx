"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "@/components/navigation/navigation-link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Banknote, BarChart3, FolderCheck, Bell, BookOpen, BriefcaseBusiness, CalendarClock, CalendarDays, ClipboardCheck, Coins, Timer, Check, ChevronDown, ChevronRight, ChevronsUpDown, FilePen, FileText, Home, Inbox, Landmark,
  LayoutDashboard, ListChecks, NotebookPen, Package, PanelLeft, Percent, Receipt, ScanText, Search, Settings, ShieldCheck, SlidersHorizontal, Truck, Upload, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { slugFromPath } from "@/lib/domain/paths";
import { NavigationContent, NavigationProvider } from "@/components/navigation/navigation-provider";
import { LedgerlineMark } from "@/components/brand/ledgerline-mark";
import { MenuPanel, Motion, NavigationProgress } from "@/components/motion/motion";
import { TimerControl, type TimerRunning } from "@/components/work/timer-control";
import { UserMenu } from "@/components/shell/user-menu";
import { loadCompanies, useCompanies, useCurrentCompany, type CompanyEntry } from "@/components/shell/companies";
import { matchOf, plain, readRecent, rememberCompany, sameSection } from "@/components/shell/finding";
import { CommandPalette, type PaletteEntry } from "@/components/shell/command-palette";
import { MobileBar, type MobileTab } from "@/components/shell/mobile-bar";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { Toaster } from "@/components/common/toaster";
import { useI18n } from "@/components/common/locale";
import { i18nFor, type Translate } from "@/lib/i18n";
import type { ShellCompany } from "@/lib/data/shell";
import { motion } from "motion/react";

export type ShellPractice = { name: string; initials: string; brand_color: string; tagline: string | null };
/** The company being looked at, as its menu needs it (lib/data/shell). The list of every company is fetched when wanted (./companies). */
export type ShellClient = ShellCompany;
/** The person signed in. `role`: their role at the practice, or what they are to their company. `demo`: the laptop demo's sign-in. */
export type ShellUser = { name: string; initials: string; email: string; role: string; demo: boolean };

/** `also`: other paths that belong to this item, as credit notes belong to Invoices. */
type NavItem = { href: string; label: string; icon: LucideIcon; title: string; badge?: number; also?: string[] };
type NavGroup = { label: string | null; items: NavItem[]; more?: boolean };

/**
 * The application shell: fixed left navigation, a sticky top bar, scrolling
 * content. One company at a time: the switcher at the top of the menu changes
 * it, and the menu below is that company's: its customers and their work
 * first (CRM), then money, then reports and tax, with the accountant's pages
 * under More.
 */
/** `member`: one of the practice's people. A client company's own people get their company's menu only: none of the practice's pages. */
type ShellProps = { practice: ShellPractice; initialCompany: ShellCompany | null; companyCount: number; user: ShellUser; member: boolean; toReview: number; timer: TimerRunning | null; children: ReactNode };

export function AppShell(props: ShellProps) {
  return <NavigationProvider><Motion><NavigationProgress /><WorkspaceShell {...props} /></Motion></NavigationProvider>;
}

export function PracticeMark({ practice, size = "md" }: { practice: Pick<ShellPractice, "initials" | "name" | "tagline">; size?: "md" | "lg" }) {
  return <span className="flex min-w-0 items-center gap-3">
    <span className={cn("bg-brand grid shrink-0 place-items-center rounded-lg font-semibold tracking-tight text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)]", size === "lg" ? "size-11 text-[16px]" : "size-9 text-[13.5px]")}>{practice.initials}</span>
    <span className="bg-hairline-strong h-9 w-px shrink-0" />
    <span className="min-w-0">
      <span className={cn("text-ink-muted block leading-tight", size === "lg" ? "text-[16px]" : "text-[13px]")}>{practice.name}</span>
      {practice.tagline ? <span className="text-ink-faint block truncate text-[11px] leading-tight">{practice.tagline}</span> : null}
    </span>
  </span>;
}

const shortName = (name: string) => name.replace(/ (Ltd|Limited)$/, "");

/** `t`: the menu's words in the language of the person reading it; a company's own names for things are looked up as they are. */
function companyNav(base: string, client: ShellClient, t: Translate): NavGroup[] {
  const has = (module: string) => client.nav.modules.includes(module);
  return [
    { label: null, items: [{ href: base, label: t("Home"), icon: Home, title: t("Home") }] },
    // Customers first: who they are, what was quoted and invoiced, what is to do, and when.
    // In the company's own words, and only the parts it uses.
    { label: t("CRM"), items: [
      ...(has("pipeline") ? [{ href: `${base}/crm/pipeline`, label: t(client.nav.deals), icon: Inbox, title: t(client.nav.deals) }] : []),
      { href: `${base}/customers`, label: t(client.nav.customers), icon: Users, title: t(client.nav.customers) },
      ...(has("quotes") ? [{ href: `${base}/quotes`, label: t("Quotes"), icon: FilePen, title: t("Quotes") }] : []),
      { href: `${base}/sales`, label: t("Invoices"), icon: FileText, title: t("Invoices"), also: [`${base}/credit-notes`, `${base}/repeating`] },
      ...(has("products") ? [{ href: `${base}/items`, label: t("Products"), icon: Package, title: t("Products and services") }] : []),
      ...(has("jobs") ? [{ href: `${base}/crm/jobs`, label: t(client.nav.jobs), icon: BriefcaseBusiness, title: t(client.nav.jobs) }] : []),
      ...(has("tasks") ? [{ href: `${base}/crm/tasks`, label: t("Tasks"), icon: ListChecks, title: t("Tasks") }] : []),
      { href: `${base}/calendar`, label: t("Calendar"), icon: CalendarDays, title: t("Calendar") },
    ] },
    { label: t("Money"), items: [
      { href: `${base}/bank`, label: t("Bank"), icon: Landmark, title: t("Bank") },
      { href: `${base}/capture`, label: t("Upload receipts"), icon: ScanText, title: t("Upload receipts"), badge: client.toReview },
      { href: `${base}/bills`, label: t("Bills"), icon: Receipt, title: t("Bills"), also: [`${base}/supplier-credits`] },
      { href: `${base}/suppliers`, label: t("Suppliers"), icon: Truck, title: t("Suppliers") },
      // Cyprus payroll: a UK company's wages are coded from the bank until UK payroll is built.
      ...(client.country === "CY" && has("payroll") && client.payroll ? [{ href: `${base}/payroll`, label: t("Payroll"), icon: Banknote, title: t("Payroll") }] : []),
    ] },
    { label: t("Reports & tax"), items: [
      { href: `${base}/reports`, label: t("Reports"), icon: BarChart3, title: t("Reports") },
      { href: `${base}/reports/vat`, label: t("VAT returns"), icon: Percent, title: t("VAT returns") },
      { href: `${base}/deadlines`, label: t("Deadlines"), icon: CalendarClock, title: t("Deadlines") },
      { href: `${base}/year-end`, label: t("Year end"), icon: ClipboardCheck, title: t("Year end and audit") },
    ] },
    { label: t("More"), more: true, items: [
      { href: `${base}/chart`, label: t("Chart of accounts"), icon: BookOpen, title: t("Chart of accounts") },
      { href: `${base}/journals`, label: t("Journals"), icon: NotebookPen, title: t("Journals") },
      { href: `${base}/audit`, label: t("Audit trail"), icon: ShieldCheck, title: t("Audit trail") },
      { href: `${base}/settings`, label: t("Company settings"), icon: Settings, title: t("Company settings") },
      { href: `${base}/settings/workspace`, label: t("Customise"), icon: SlidersHorizontal, title: t("How the company works") },
      { href: `${base}/settings/people`, label: t("People"), icon: Users, title: t("People") },
    ] },
  ];
}

const subscribeNothing = () => () => undefined;

/**
 * Which company's books: a search over every client by name, Greek name,
 * registration or VAT number, the last few opened first. Built for a
 * practice with a hundred clients: type a few letters and press Enter. The
 * command palette (⌘K, Ctrl+K) finds companies too, from any page.
 */
function CompanySwitcher({ current, count, pathname, onNavigate, member }: { current: ShellClient | null; count: number; pathname: string; onNavigate: () => void; member: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const clients = useCompanies(open) ?? [];
  // Fetched once the page is idle, so the first open is instant however many clients there are.
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
    const handle = idle ? idle(() => void loadCompanies()) : window.setTimeout(() => void loadCompanies(), 1500);
    return () => { if (!idle) window.clearTimeout(handle); };
  }, []);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const shortcut = useSyncExternalStore(subscribeNothing, () => /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K", () => null);
  const show = () => { setRecent(readRecent()); setActive(0); setOpen(true); };
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [open]);
  // The company being looked at goes to the front of this browser's recent list.
  useEffect(() => { if (current && !current.practice) rememberCompany(current.slug); }, [current]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const companies = clients.filter(entry => !entry.practice);
  const firm = clients.find(entry => entry.practice);
  const query = plain(filter.trim());
  // What was typed: names that start with it first, then the rest A to Z.
  const matches = query ? companies.map(entry => ({ entry, via: matchOf(entry, query) })).filter(row => row.via !== null)
    .sort((a, b) => Number(!plain(a.entry.name).startsWith(query)) - Number(!plain(b.entry.name).startsWith(query)) || a.entry.name.localeCompare(b.entry.name)) : [];
  const recentEntries = query ? [] : recent.map(slug => companies.find(entry => entry.slug === slug)).filter((entry): entry is CompanyEntry => Boolean(entry) && entry?.slug !== current?.slug).slice(0, 5);
  const options = query ? matches.map(row => row.entry) : [...recentEntries, ...companies];
  const done = () => { setOpen(false); setFilter(""); onNavigate(); };
  const go = (entry: CompanyEntry) => { router.push(sameSection(pathname, entry.slug)); done(); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(index + 1, options.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    else if (event.key === "Enter" && options[active]) { event.preventDefault(); go(options[active]); }
    // Typed before the list arrived: wait for it, then open the first match.
    else if (event.key === "Enter" && !clients.length && query) {
      event.preventDefault();
      void loadCompanies().then(list => { const first = list.find(entry => !entry.practice && matchOf(entry, query) !== null); if (first) go(first); });
    }
  };
  const row = (entry: CompanyEntry, index: number, via: string | null) => <li key={`${index}-${entry.slug}`}>
    <Link href={sameSection(pathname, entry.slug)} onClick={done} data-index={index} onMouseEnter={() => setActive(index)}
      className={cn("flex items-center gap-2 px-2.5 py-1.5 text-[13px] touch:py-3", index === active ? "bg-muted" : "", entry.slug === current?.slug ? "text-brand font-medium" : "text-ink")}>
      <span className="min-w-0 flex-1 truncate">{entry.name}{via ? <span className="text-ink-faint ml-1.5 text-[12px]">{via}</span> : null}</span>
      {entry.toReview ? <span className="bg-brand rounded px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular-nums" title={t("Documents to review")}>{entry.toReview}</span> : null}
      {entry.slug === current?.slug ? <Check className="size-3.5" /> : null}
    </Link>
  </li>;
  const heading = (text: string) => <li aria-hidden className="text-ink-faint px-2.5 pt-2 pb-0.5 text-[11px] font-semibold tracking-[0.08em] uppercase">{text}</li>;

  return <div ref={ref} className="relative">
    <button type="button" onClick={() => open ? setOpen(false) : show()} aria-expanded={open} aria-haspopup="true"
      className="border-hairline-strong hover:bg-muted bg-surface flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 touch:py-3">
      <span className={cn("grid size-7 shrink-0 place-items-center rounded text-[11.5px] font-semibold", current ? "bg-brand-50 text-brand" : "bg-surface-sunken text-ink-muted")}>
        {current ? current.name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() : <LayoutDashboard className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink block truncate text-[13px] leading-tight font-semibold">{current ? shortName(current.name) : t("All clients")}</span>
        <span className="text-ink-faint block truncate text-[11.5px] leading-tight">{current ? current.industry : t.n(count, "{count} company", "{count} companies")}</span>
      </span>
      <ChevronsUpDown className="text-ink-faint size-3.5 shrink-0" />
    </button>
    <MenuPanel open={open} role="dialog" className="bg-surface border-hairline absolute top-full left-0 z-10 mt-1 w-[21rem] max-w-[calc(100vw-1.25rem)] overflow-hidden rounded-md border shadow-lg">
      <div className="border-hairline flex items-center gap-2 border-b px-2.5 py-2">
        <Search className="text-ink-faint size-3.5 shrink-0" />
        <input autoFocus value={filter} onChange={event => { setFilter(event.target.value); setActive(0); }} onKeyDown={onKeyDown}
          placeholder={t("Name, HE or VAT number…")} aria-label={t("Find a company")} aria-describedby="switcher-hint"
          className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
      </div>
      <ul ref={listRef} className="max-h-[min(60vh,32rem)] overflow-y-auto py-1">
        {!query && member ? <li><Link href="/" onClick={done} className="text-ink-muted hover:bg-muted flex items-center gap-2 px-2.5 py-1.5 text-[13px] touch:py-3"><LayoutDashboard className="size-3.5" />{t("Practice dashboard")}</Link></li> : null}
        {!query && firm && member ? <li className="border-hairline mb-1 border-b pb-1"><Link href={sameSection(pathname, firm.slug)} onClick={done} className={cn("hover:bg-muted flex items-center gap-2 px-2.5 py-1.5 text-[13px] touch:py-3", firm.slug === current?.slug ? "text-brand font-medium" : "text-ink-muted")}>
          <BookOpen className="size-3.5" /><span className="min-w-0 flex-1 truncate">{t("Your firm’s own books")}</span>{firm.slug === current?.slug ? <Check className="size-3.5" /> : null}</Link></li> : null}
        {recentEntries.length ? <>{heading(t("Recent"))}{recentEntries.map((entry, index) => row(entry, index, null))}</> : null}
        {!query && !clients.length ? <li className="text-ink-faint px-2.5 py-1.5 text-[12.5px]">{t("Finding your companies…")}</li> : null}
        {!query && clients.length ? <>{heading(t("All {count}", { count: companies.length }))}{companies.map((entry, index) => row(entry, recentEntries.length + index, null))}</> : null}
        {query ? matches.map((match, index) => row(match.entry, index, match.via || null)) : null}
        {query && !matches.length ? <li className="text-ink-faint px-2.5 py-1.5 text-[12.5px]">{t("No company by that name or number.")}</li> : null}
      </ul>
      <p id="switcher-hint" className="border-hairline text-ink-faint border-t px-2.5 py-1.5 text-[11.5px] touch:hidden">{t("↑ ↓ to choose, Enter to open")}{shortcut ? ` · ${t("{shortcut} finds anything", { shortcut })}` : ""}</p>
    </MenuPanel>
  </div>;
}

function WorkspaceShell({ practice, initialCompany, companyCount, user, member, toReview, timer, children }: ShellProps) {
  const pathname = usePathname() ?? "/";
  const slug = slugFromPath(pathname);
  const client = useCurrentCompany(initialCompany, slug);
  const base = client && slug ? `/c/${slug}` : "";
  const { t, locale } = useI18n();
  const groupsIn = (t: Translate): NavGroup[] => client ? companyNav(base, client, t) : member ? [{ label: null, items: [
    { href: "/", label: t("Dashboard"), icon: LayoutDashboard, title: t("Practice dashboard") },
    { href: "/deadlines", label: t("Deadlines"), icon: CalendarClock, title: t("Deadlines") },
    { href: "/calendar", label: t("Calendar"), icon: CalendarDays, title: t("Calendar") },
    { href: "/time", label: t("Time"), icon: Timer, title: t("Time") },
    { href: "/fees", label: t("Fees"), icon: Coins, title: t("Fees") },
    { href: "/clients", label: t("Client files"), icon: FolderCheck, title: t("Client files") },
    { href: "/vat-numbers", label: t("VAT numbers"), icon: BadgeCheck, title: t("VAT numbers") },
    { href: "/capture", label: t("Capture"), icon: ScanText, title: t("Capture"), badge: toReview },
    { href: "/settings", label: t("Practice settings"), icon: Settings, title: t("Practice settings") },
  ] }] : [];
  const groups = groupsIn(t);
  const items = groups.flatMap(group => group.items);
  // The longest matching href wins, so /c/x/reports/vat is VAT returns and /c/x/sales/new is Invoices.
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const current = [...items].sort((a, b) => b.href.length - a.href.length)
    .find(item => item.href === "/" ? pathname === "/" : pathname === item.href || (item.href !== base && under(item.href)) || (item.also ?? []).some(under))
    ?? (pathname === "/compare" ? { href: "/compare", label: t("Compared"), icon: LayoutDashboard, title: t("Ledgerline compared") } : undefined);
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
  const close = () => setOpen(false);
  // The command palette's offers: what is done next here, then every page of this menu.
  const has = (module: string) => Boolean(client?.nav.modules.includes(module));
  // "New patient": in Greek, with the word's own gender ("Νέος ασθενής", "Νέα κράτηση"); a name the company made up, plainly.
  const newOf = (noun: string) => { const phrase = `New ${noun.toLowerCase()}`; return t.has(phrase) ? t(phrase) : t("New: {name}", { name: noun }); };
  const actions: PaletteEntry[] = client ? [
    { id: "invoice", label: t("New invoice"), href: `${base}/sales/new`, icon: FileText, keywords: t.also("raise bill customer sale") },
    { id: "bill", label: t("Record a bill"), href: `${base}/bills/new`, icon: Receipt, keywords: t.also("supplier expense purchase cost") },
    { id: "receipt", label: t("Upload receipts"), href: `${base}/capture`, icon: ScanText, keywords: t.also("scan photo document capture read") },
    ...(has("quotes") ? [{ id: "quote", label: t("New quote"), href: `${base}/quotes/new`, icon: FilePen, keywords: t.also("estimate proposal offer") }] : []),
    { id: "in", label: t("Money in"), href: `${base}/bank/new?kind=receive`, icon: ArrowDownLeft, keywords: t.also("receive received deposit") },
    { id: "out", label: t("Money out"), href: `${base}/bank/new?kind=spend`, icon: ArrowUpRight, keywords: t.also("spend spent pay paid expense") },
    { id: "customer", label: newOf(client.nav.customer), href: `${base}/customers/new`, icon: Users, keywords: t.also("customer client contact add") },
    ...(has("pipeline") ? [{ id: "deal", label: newOf(client.nav.deal), href: `${base}/crm/pipeline/new`, icon: Inbox, keywords: t.also("lead enquiry deal opportunity") }] : []),
    ...(has("jobs") ? [{ id: "job", label: newOf(client.nav.job), href: `${base}/crm/jobs/new`, icon: BriefcaseBusiness, keywords: t.also("job project order work") }] : []),
    { id: "supplier", label: t("New supplier"), href: `${base}/suppliers/new`, icon: Truck, keywords: t.also("vendor add") },
    ...(has("products") ? [{ id: "product", label: t("New product"), href: `${base}/items/new`, icon: Package, keywords: t.also("item service price") }] : []),
    ...(client.country === "CY" && has("payroll") && client.payroll ? [{ id: "payroll", label: t("Run payroll"), href: `${base}/payroll`, icon: Banknote, keywords: t.also("salaries payslips social insurance gesy") }] : []),
    { id: "vat", label: t("VAT return"), href: `${base}/reports/vat`, icon: Percent, keywords: t.also("vat4 tax tfa return file") },
    { id: "statement", label: t("Import a bank statement"), href: `${base}/bank`, icon: Landmark, keywords: t.also("statement csv reconcile match bank") },
  ] : member ? [
    { id: "take-on", label: t("Take on a client"), href: "/clients/new", icon: UserPlus, keywords: t.also("onboard new client engagement letter") },
    { id: "import", label: t("Bring clients over"), href: "/clients/import", icon: Upload, keywords: t.also("import spreadsheet csv list") },
    { id: "owners", label: t("Invite owners"), href: "/clients/owners", icon: Users, keywords: t.also("owners invitation join") },
    { id: "capture", label: t("Capture documents"), href: "/capture", icon: ScanText, keywords: t.also("upload receipts scan") },
    { id: "vies", label: t("Check a VAT number"), href: "/vat-numbers", icon: BadgeCheck, keywords: t.also("vies vat number") },
  ] : [];
  // On a phone: four places at the thumb, and + for what is done on the move.
  const mobileTabs: [MobileTab, MobileTab, MobileTab] = client
    ? [{ href: base, label: t("Home"), icon: Home }, { href: `${base}/sales`, label: t("Invoices"), icon: FileText, also: [`${base}/credit-notes`, `${base}/repeating`] }, { href: `${base}/bank`, label: t("Bank"), icon: Landmark }]
    : [{ href: "/", label: t("Dashboard"), icon: LayoutDashboard }, { href: "/deadlines", label: t("Deadlines"), icon: CalendarClock }, { href: "/clients", label: t("Clients"), icon: FolderCheck }];
  const quickAdd = actions.filter(entry => ["invoice", "quote", "bill", "in", "out", "customer", "take-on", "import", "owners", "vies"].includes(entry.id));
  const snap = client ? { companyId: client.id, reviewHref: `${base}/capture` } : member ? { reviewHref: "/capture" } : null;
  const english = locale === "el" ? new Map(groupsIn(i18nFor("en").t).flatMap(group => group.items.map(entry => [entry.href, entry.title]))) : null;
  const pages: PaletteEntry[] = [...groups.flatMap(group => group.items.map(entry => ({ id: entry.href, label: entry.title, detail: group.label ?? undefined, href: entry.href, icon: entry.icon, keywords: english?.get(entry.href) }))),
    ...(client && member ? [{ id: "practice", label: t("Practice dashboard"), detail: practice.name, href: "/", icon: LayoutDashboard }] : [])];
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const item = (active: boolean) => cn("group relative flex items-center gap-2.5 rounded-md py-[5px] pr-2.5 pl-2.5 text-[13px] transition-colors touch:gap-3 touch:py-3 touch:text-[15px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active ? "text-brand font-medium" : "text-ink-muted hover:bg-muted hover:text-ink");
  const link = (entry: NavItem) => {
    const active = current?.href === entry.href;
    return <li key={entry.href}><Link href={entry.href} onClick={close} aria-current={active ? "page" : undefined} className={item(active)}>
      {active ? <motion.span layoutId="nav-active" aria-hidden className="bg-accent absolute inset-0 rounded-md">
        <span className="bg-brand absolute top-[calc(50%-8px)] -left-2.5 h-4 w-[2px] rounded-r" />
      </motion.span> : null}
      <entry.icon className={cn("relative size-[14px] shrink-0 touch:size-[18px]", active ? "text-brand" : "text-ink-faint group-hover:text-ink-muted")} />
      <span className="relative truncate">{entry.label}</span>
      {entry.badge ? <span className="bg-brand relative ml-auto rounded px-1.5 text-[11px] leading-[18px] font-semibold text-white tabular-nums">{entry.badge}</span> : null}
    </Link></li>;
  };

  return <div className="flex min-h-dvh">
    <aside aria-label={t("Main navigation")} className={cn("bg-sidebar border-hairline fixed inset-y-0 left-0 z-50 flex w-[224px] flex-col border-r print:hidden",
      "transition-transform duration-200 ease-out lg:translate-x-0", open ? "translate-x-0 shadow-xl" : "-translate-x-full lg:shadow-none")}>
      <div className="border-hairline flex h-14 shrink-0 items-center justify-between border-b pr-3 pl-4">
        <Link href="/" onClick={close} className="min-w-0 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={t("{name} dashboard", { name: practice.name })}><PracticeMark practice={practice} /></Link>
        <button type="button" onClick={close} className="hover:bg-muted text-ink-muted grid size-7 shrink-0 place-items-center rounded-md lg:hidden touch:size-11" aria-label={t("Close navigation")}><X className="size-4" /></button>
      </div>
      <div className="px-2.5 pt-3"><CompanySwitcher current={client} count={companyCount} pathname={pathname} onNavigate={close} member={member} /></div>
      <nav ref={navRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-3">
        {groups.map((group, index) => {
          if (group.more) {
            const expanded = moreOpen || moreActive;
            return <div key={group.label} className="border-hairline mt-3 border-t pt-2">
              <button type="button" onClick={() => setMoreOpen(value => !value)} aria-expanded={expanded} className="text-ink-faint hover:text-ink-muted flex w-full items-center gap-1 px-2.5 py-1 text-[11.5px] font-semibold tracking-[0.08em] uppercase">
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
        <Link href="/compare" onClick={close} className="text-ink-faint hover:text-ink inline-flex items-center gap-1.5 text-[11.5px]">{t("Powered by")} <LedgerlineMark className="size-3.5" title="" /><span className="text-ink-muted font-semibold">Ledgerline</span></Link>
      </div>
    </aside>
    {open ? <button type="button" aria-label={t("Close navigation")} onClick={close} className="bg-brand-deep/25 fixed inset-0 z-40 lg:hidden" /> : null}
    <div className="flex min-w-0 flex-1 flex-col lg:pl-[224px] print:pl-0">
      <header className="bg-surface/90 border-hairline sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-3 backdrop-blur-md sm:px-5 print:hidden">
        {/* A phone opens the menu from the bar at the foot of the screen. */}
        <button type="button" onClick={() => setOpen(true)} className={cn("hover:bg-muted text-ink-muted -ml-1 grid size-8 shrink-0 place-items-center rounded-md lg:hidden touch:size-11", (client || member) && "max-sm:hidden")} aria-label={t("Open navigation")}><PanelLeft className="size-4" /></button>
        <nav aria-label={t("Breadcrumb")} className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1 text-[13px] leading-tight">
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
        {member ? <TimerControl running={timer} currentSlug={slug} /> : null}
        <CommandPalette actions={actions} pages={pages} pathname={pathname} scope={client && slug ? { slug, name: client.name } : null}
          labels={{ customer: t(client?.nav.customers ?? "Customers"), supplier: t("Suppliers"), invoice: t("Invoices"), bill: t("Bills"), quote: t("Quotes"), product: t("Products"),
            deal: t(client?.nav.deals ?? "Enquiries"), job: t(client?.nav.jobs ?? "Jobs"), employee: t("Employees") }} />
        <Link href={client ? `${base}/capture` : "/capture"} aria-label={toReview ? t.n(toReview, "{count} document to review", "{count} documents to review") : t("Documents")} className="text-ink-muted hover:bg-muted relative grid size-8 place-items-center rounded-md">
          <Bell className="size-4" />{toReview ? <span className="bg-critical absolute top-1.5 right-1.5 size-1.5 rounded-full" /> : null}
        </Link>
        <span className="bg-hairline mx-0.5 hidden h-6 w-px sm:block" />
        <UserMenu user={client?.role ? { ...user, role: client.role } : user} />
      </header>
      <OfflineBanner />
      <main className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0 print:pb-0"><NavigationContent scope="page" label={t("Loading…")} variant="page">{children}</NavigationContent></main>
    </div>
    {client || member ? <MobileBar tabs={mobileTabs} actions={quickAdd} snap={snap} pathname={pathname} onMenu={() => setOpen(true)} /> : null}
    <Toaster />
  </div>;
}
