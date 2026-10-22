import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared layout primitives.
 *
 * The rule these encode: one bordered surface per region. A panel may contain
 * rows, a header and a footer separated by hairlines, but never another
 * bordered box. Hierarchy comes from type, weight and space.
 */

const PAGE_WIDTHS = { full: "", "6xl": "max-w-6xl", "5xl": "max-w-5xl", "4xl": "max-w-4xl", "3xl": "max-w-3xl" } as const;
export type PageWidth = keyof typeof PAGE_WIDTHS;

/**
 * Standard page gutter. Every screen uses this so nothing drifts: each page
 * starts at the same left edge, and a narrower one (a form, a statement)
 * simply stops sooner on the right.
 */
export function PageBody({
  children,
  className,
  width = "full",
}: {
  children: ReactNode;
  className?: string;
  width?: PageWidth;
}) {
  return (
    <div className="mx-auto w-full max-w-[1440px] p-3 sm:p-5">
      <div className={cn("min-w-0", PAGE_WIDTHS[width], className)}>{children}</div>
    </div>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("ll-panel", className)}>{children}</section>;
}

export function PanelHeader({
  title,
  count,
  hint,
  action,
}: {
  title: string;
  count?: number;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <header className="border-hairline flex min-h-10 items-center gap-3 border-b px-4 py-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="text-ink text-[13px] font-semibold tracking-[0.01em]">
          {title}
        </h2>
        {typeof count === "number" ? (
          <span
            data-numeric
            className="text-ink-faint text-[11.5px] tabular-nums"
          >
            {count}
          </span>
        ) : null}
      </div>
      {hint ? (
        <p className="text-ink-faint hidden truncate text-[11.5px] sm:block">
          {hint}
        </p>
      ) : null}
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </header>
  );
}

/**
 * Empty states say what would appear here and, where there is one, what the
 * reader should do about it. "No data" on its own is a dead end.
 */
export function EmptyState({
  title,
  body,
  className,
}: {
  /** Kept for existing callers; an empty state is a line of text, not an illustration. */
  icon?: ReactNode;
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-3.5", className)}>
      <p className="text-ink text-[12.5px] font-medium">{title}</p>
      {body ? (
        <p className="text-ink-muted mt-0.5 max-w-[70ch] text-[12px] leading-relaxed">{body}</p>
      ) : null}
    </div>
  );
}

/**
 * Shown when a query fails. Distinguishing "nothing to show" from "we could
 * not load this" matters on a screen people use to decide what to work on.
 */
export function LoadError({ what }: { what: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-critical text-[12.5px] font-medium">
        Could not load {what}
      </p>
      <p className="text-ink-muted mt-0.5 text-[12px]">
        Refresh the page. If it keeps happening, contact your administrator.
      </p>
    </div>
  );
}
