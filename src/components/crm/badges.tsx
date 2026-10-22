import { Flag } from "lucide-react";

import { MATTER_STATUS, stageOf, stageSwatch } from "@/lib/domain/crm";
import { cn } from "@/lib/utils";

/** Pipeline status chip, square-ish. */
export function StageBadge({ stage, compact = false, className }: { stage: string; compact?: boolean; className?: string }) {
  const definition = stageOf(stage);
  return <span title={definition.meaning} className={cn("border-hairline bg-surface text-ink inline-flex shrink-0 items-center gap-1.5 rounded border px-1.5 py-px text-[11px] leading-[18px] font-medium whitespace-nowrap", className)}>
    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: stageSwatch(stage) }} />{compact ? definition.short : definition.label}
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

export function MatterStatus({ status }: { status: string }) {
  return <span className={cn("inline-flex rounded border px-1.5 py-px text-[11px] leading-[18px] font-medium",
    status === "active" ? "border-positive-line bg-positive-soft text-positive" : status === "completed" ? "border-hairline bg-surface-sunken text-ink-muted" : "border-caution-line bg-caution-soft text-caution")}>{MATTER_STATUS[status] ?? status}</span>;
}

export function dueTone(due: string | null, today: string) {
  return !due ? "text-ink-faint" : due < today ? "text-critical font-medium" : due === today ? "text-ink font-medium" : "text-ink-muted";
}
