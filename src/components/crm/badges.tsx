import { Flag } from "lucide-react";

import type { Outcome } from "@/lib/domain/business-types";
import { stageSwatch } from "@/lib/domain/crm";
import { cn } from "@/lib/utils";

/** A record's stage as a chip, in the company's own words, its swatch how far along the board it is. */
export function StageBadge({ name, outcome, position, openCount, className }: { name: string; outcome: Outcome; position: number; openCount: number; className?: string }) {
  return <span className={cn("border-hairline bg-surface text-ink inline-flex shrink-0 items-center gap-1.5 rounded border px-1.5 py-px text-[11px] leading-[18px] font-medium whitespace-nowrap", className)}>
    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: stageSwatch(outcome, position, openCount) }} />{name}
  </span>;
}

export function PriorityFlag({ priority }: { priority: string }) {
  if (priority === "normal") return null;
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-[18px] font-medium",
    priority === "urgent" ? "border-critical-line bg-critical-soft text-critical" : "border-caution-line bg-caution-soft text-caution")}>
    <Flag className="size-3" />{priority === "urgent" ? "Urgent" : "High"}
  </span>;
}

export function LinkChip({ kind, label }: { kind: string | null; label: string | null }) {
  if (!kind || !label) return null;
  return <span className="border-hairline text-ink inline-flex max-w-[22rem] shrink-0 items-center gap-1.5 truncate rounded border px-1.5 py-px text-[11.5px] leading-[18px]">
    <span className="text-ink-faint text-[10px] font-semibold tracking-[0.06em] uppercase">{kind}</span><span className="truncate">{label}</span>
  </span>;
}

export function dueTone(due: string | null, today: string) {
  return !due ? "text-ink-faint" : due < today ? "text-critical font-medium" : due === today ? "text-ink font-medium" : "text-ink-muted";
}
