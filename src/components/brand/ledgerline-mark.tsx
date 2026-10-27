import { cn } from "@/lib/utils";

/**
 * Ledgerline's own mark: a ledger line with an entry sitting on it, over the
 * line beneath. Always Ledgerline teal: it is the "Powered by" brand, not the
 * practice's, which every other accent in the app follows.
 */
export function LedgerlineMark({ className, title = "Ledgerline" }: { className?: string; title?: string }) {
  return <svg viewBox="0 0 32 32" role="img" aria-label={title} className={cn("size-5 shrink-0", className)}>
    <rect width="32" height="32" rx="7" fill="#0d6e6e" />
    <path d="M7.5 21h17" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M7.5 14.5h9" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="21.5" cy="14.5" r="3.3" fill="#fff" />
  </svg>;
}

/** The mark beside the word, "Ledger" in ink and "line" in teal. */
export function LedgerlineLockup({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  return <span className={cn("inline-flex items-center gap-1.5", className)}>
    <LedgerlineMark className={size === "lg" ? "size-7" : size === "sm" ? "size-3.5" : "size-5"} title="" />
    <span className={cn("leading-none font-semibold tracking-[-0.01em]", size === "lg" ? "text-[20px]" : size === "sm" ? "text-[11.5px]" : "text-[14px]")}>
      <span className="text-ink">Ledger</span><span style={{ color: "#0d6e6e" }}>line</span>
    </span>
  </span>;
}
