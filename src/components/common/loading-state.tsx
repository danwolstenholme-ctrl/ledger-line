import { Loader2 } from "lucide-react";
import { PageBody } from "@/components/common/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type LoadingVariant = "page" | "panel" | "list" | "message";

export function LoadingSpinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("size-3.5 animate-spin motion-reduce:animate-none", className)} />;
}

/** The same status, pulse and reduced-motion behavior in every workspace. */
export function LoadingState({ label = "Loading…", variant = "panel", className }: {
  label?: string;
  variant?: LoadingVariant;
  className?: string;
}) {
  return <div data-slot="loading-state" className={cn("min-w-0 space-y-4", className)}>
    <p role="status" className="text-ink-muted flex items-center gap-2 text-[13px]">
      <LoadingSpinner />{label}
    </p>
    <div aria-hidden className="min-w-0 space-y-4">
      {variant === "page" ? <div className="space-y-2 pb-2"><Skeleton className="h-6 w-48 max-w-full" /><Skeleton className="h-3 w-72 max-w-full" /></div> : null}
      {variant === "message" ? <>
        <div className="space-y-3 border-b border-hairline pb-5"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
        <div className="space-y-3">{["w-full", "w-11/12", "w-full", "w-3/4", "w-5/6"].map((width, index) => <Skeleton key={index} className={cn("h-3", width)} />)}</div>
      </> : variant === "list" || variant === "page" ? <>
        <Skeleton className="h-10 w-full" />
        <div className="divide-hairline divide-y rounded-lg border border-hairline bg-surface">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-3 p-4"><Skeleton className="size-8 shrink-0" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
      </> : <><Skeleton className="h-10 w-full" /><Skeleton className="h-48 w-full" /></>}
    </div>
  </div>;
}

export function PageLoading({ label = "Loading workspace…" }: { label?: string }) {
  return <PageBody><LoadingState label={label} variant="page" /></PageBody>;
}
