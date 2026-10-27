import Link from "@/components/navigation/navigation-link";
import { cn } from "@/lib/utils";

/**
 * The places one company's books are kept from. Links resolve inside the
 * company being viewed (see booksHref). Server-safe: hrefs only.
 */
export const ACCOUNTS_SECTIONS = [
  { href: "/accounts", label: "Overview" },
  { href: "/invoices", label: "Sales" },
  { href: "/accounts/bills", label: "Purchases" },
  { href: "/accounts/bank", label: "Bank" },
  { href: "/accounts/reports", label: "Reports" },
  { href: "/accounts/chart", label: "Chart of accounts" },
  { href: "/accounts/audit", label: "Audit trail" },
  { href: "/accounts/settings", label: "Settings" },
] as const;

/** Bills and the suppliers who send them, under Purchases. */
export const PURCHASES_SECTIONS = [
  { href: "/accounts/bills", label: "Bills" },
  { href: "/accounts/suppliers", label: "Suppliers" },
] as const;

/**
 * The tab row the books pages were written with. The sidebar now names every
 * section, so a second row of the same links is only clutter: this renders
 * nothing and stays so the pages that place it need no change.
 */
export function AccountsNav(props: { current: (typeof ACCOUNTS_SECTIONS)[number]["href"] }) {
  void props;
  return null;
}

/** The second row under a tab that has more than one place in it. */
export function SubNav({ label, sections, current }: { label: string; sections: readonly { href: string; label: string }[]; current: string }) {
  return <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
    {sections.map(section => <Link key={section.href} href={section.href} aria-current={current === section.href ? "page" : undefined}
      className={cn("focus-visible:ring-ring/40 inline-flex min-h-7 items-center rounded-md px-2.5 py-1 text-[13px] outline-none focus-visible:ring-[3px] touch:min-h-11 touch:px-3.5 touch:text-[14px]",
        current === section.href ? "bg-accent text-brand font-medium" : "text-ink-muted hover:bg-muted hover:text-ink")}>
      {section.label}
    </Link>)}
  </nav>;
}

/** Bills and Suppliers each have their own place in the sidebar. */
export function PurchasesNav(props: { current: (typeof PURCHASES_SECTIONS)[number]["href"] }) {
  void props;
  return null;
}
