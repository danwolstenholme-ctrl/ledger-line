import Link from "@/components/navigation/navigation-link";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CopyLinkButton } from "@/components/common/copy-link-button";
import { SlidingTabs } from "@/components/motion/motion";
import { T } from "@/components/common/locale";

export const recordButton = "active:scale-[0.98] transition-[background-color,transform] focus-visible:ring-ring/40 inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white touch:min-h-11 touch:px-4 touch:text-[15px] outline-none hover:bg-brand-dark focus-visible:ring-[3px]";
export const recordOutlineButton = "active:scale-[0.98] transition-[background-color,transform] focus-visible:ring-ring/40 border-hairline-strong text-ink hover:bg-muted inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium outline-none focus-visible:ring-[3px] touch:min-h-11 touch:px-4 touch:text-[15px]";

/**
 * The page's own heading, the same on every screen: an optional way back, the
 * title (the page's only h1), a line saying what it is, and its actions.
 */
export function RecordHeader({ title, description, back, action, eyebrow, copyLink = false }: { title: ReactNode; description?: ReactNode; back?: { href: string; label: string }; action?: ReactNode; eyebrow?: ReactNode; copyLink?: boolean }) {
  return <header className="space-y-1.5">
    {back ? <Link href={back.href} className="text-ink-muted hover:text-brand inline-flex items-center gap-1 text-[12.5px] touch:min-h-10 touch:text-[14px] print:hidden"><ArrowLeft className="size-3" />{back.label}</Link> : null}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-48">
        {eyebrow ? <p className="ll-eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="text-ink text-[22px] leading-tight font-semibold tracking-[-0.02em] break-words touch:text-[21px]">{title}</h1>
        {description ? <p className="text-ink-muted mt-1.5 max-w-[80ch] text-[13.5px] leading-relaxed">{description}</p> : null}
      </div>
      {action || copyLink ? <div className="flex max-w-full flex-wrap items-center gap-2 print:hidden">{action}{copyLink ? <CopyLinkButton /> : null}</div> : null}
    </div>
  </header>;
}
export function CreateRecordLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className={recordButton}><Plus className="size-4" />{children}</Link>;
}
export function RecordSection({ title, children, action, hint }: { title: string; children: ReactNode; action?: ReactNode; hint?: string }) {
  return <section className="ll-panel min-w-0 overflow-hidden"><header className="border-hairline flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2"><div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5"><h2 className="text-ink text-[14px] font-semibold tracking-[-0.005em]">{title}</h2>{hint ? <p className="text-ink-faint text-[12px] leading-snug">{hint}</p> : null}</div>{action}</header>{children}</section>;
}
export function RecordDetail({ label, value }: { label: string; value: ReactNode }) {
  return <div className="grid gap-0.5 py-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-4"><dt className="text-ink-muted text-[12.5px]">{label}</dt><dd className="text-ink min-w-0 text-[13px] leading-relaxed break-words">{value || <span className="text-ink-faint"><T text="Not recorded" /></span>}</dd></div>;
}
export function RecordEmpty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="px-4 py-3.5"><p className="text-ink text-[13px] font-medium">{title}</p><div className="text-ink-muted mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed">{children}</div></div>;
}
export function RecordFailure({ what }: { what: string }) {
  return <div role="alert" className="border-critical-line bg-critical-soft rounded-lg border px-4 py-3"><p className="text-critical text-[13.5px] font-medium"><T text="We couldn’t load {what}." vars={{ what }} /></p><p className="text-ink-muted mt-0.5 text-[12.5px]"><T text="Refresh to try again. Your saved records have not changed." /></p></div>;
}
export function RecordBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "caution" | "critical" }) {
  return <span className={cn("inline-flex items-center rounded border px-1.5 py-px text-[11.5px] leading-[18px] font-medium whitespace-nowrap", tone === "positive" ? "border-positive-line bg-positive-soft text-positive" : tone === "caution" ? "border-caution-line bg-caution-soft text-caution" : tone === "critical" ? "border-critical-line bg-critical-soft text-critical" : "border-hairline bg-surface-sunken text-ink-muted")}>{children}</span>;
}
export function RecordPagination({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1 && page === 1) return null;
  return <nav aria-label="Results pages" className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-[12.5px]"><p className="text-ink-muted"><T text="Page {page} of {pages} · {total} records" vars={{ page, pages, total }} /></p><div className="flex items-center gap-4">{page > 1 ? <Link className="text-brand touch:inline-flex touch:min-h-10 touch:items-center" href={`${href}${href.includes("?") ? "&" : "?"}page=${page - 1}`}><T text="Previous" /></Link> : null}{page < pages ? <Link className="text-brand inline-flex items-center gap-1 touch:min-h-10" href={`${href}${href.includes("?") ? "&" : "?"}page=${page + 1}`}><T text="Next" /><ArrowRight className="size-3.5" /></Link> : null}</div></nav>;
}
export function RecordDisclosure({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details open={open || undefined} className="border-hairline border-t"><summary className="text-brand cursor-pointer px-4 py-2 text-[13px] font-medium touch:py-3.5 touch:text-[14px]">{title}</summary><div className="px-4 pt-1 pb-4">{children}</div></details>;
}

export function RecordFilterLinks({ label, options }: { label: string; options: { label: string; href: string; active: boolean }[] }) {
  return <SlidingTabs label={label} options={options} />;
}
