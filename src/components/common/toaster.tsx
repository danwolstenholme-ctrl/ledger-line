"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2, TriangleAlert, X } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { cn } from "@/lib/utils";
import { useI18n } from "@/components/common/locale";

/**
 * Short notes about something that happened away from where the person is
 * looking, such as a receipt being read: a line, a detail, and where to see
 * it. One that is still working stays until it is done; the rest go after a
 * few seconds, or when closed.
 */

export type Toast = { id: number; title: string; detail?: string; tone?: "neutral" | "positive" | "critical"; busy?: boolean; href?: string; hrefLabel?: string };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, number>();
const emit = () => listeners.forEach(listener => listener());

function schedule(id: number, ms: number) {
  window.clearTimeout(timers.get(id));
  timers.set(id, window.setTimeout(() => dismissToast(id), ms));
}

export function toast(input: Omit<Toast, "id">, ms = 7000): number {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { ...input, id }];
  emit();
  if (!input.busy) schedule(id, ms);
  return id;
}

export function updateToast(id: number, patch: Partial<Omit<Toast, "id">>, ms = 9000) {
  toasts = toasts.map(item => item.id === id ? { ...item, ...patch } : item);
  emit();
  if (!toasts.find(item => item.id === id)?.busy) schedule(id, ms);
}

export function dismissToast(id: number) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter(item => item.id !== id);
  emit();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const none: Toast[] = [];

export function Toaster() {
  const { t } = useI18n();
  const list = useSyncExternalStore(subscribe, () => toasts, () => none);
  return <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[75] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end print:hidden">
    <AnimatePresence initial={false}>
      {list.map(item => <motion.div key={item.id} role="status" layout
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
        className="bg-surface border-hairline pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-3.5 py-3 shadow-[0_12px_32px_-8px_rgb(16_24_40/0.25)]">
        <span className={cn("mt-px grid size-6 shrink-0 place-items-center rounded-full", item.busy ? "bg-brand-50 text-brand" : item.tone === "critical" ? "bg-critical-soft text-critical" : item.tone === "positive" ? "bg-positive-soft text-positive" : "bg-surface-sunken text-ink-muted")}>
          {item.busy ? <Loader2 className="size-3.5 animate-spin" /> : item.tone === "critical" ? <TriangleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("text-ink block text-[13.5px] font-medium", item.busy && "ll-ai-sheen")}>{item.title}</span>
          {item.detail ? <span className="text-ink-muted block text-[12.5px] leading-snug">{item.detail}</span> : null}
          {item.href ? <Link href={item.href} onClick={() => dismissToast(item.id)} className="text-brand mt-1 inline-block text-[13px] font-medium hover:underline">{item.hrefLabel ?? t("Open")}</Link> : null}
        </span>
        <button type="button" onClick={() => dismissToast(item.id)} aria-label={t("Close")} className="text-ink-faint hover:text-ink -mt-0.5 -mr-1 grid size-7 shrink-0 place-items-center rounded-md"><X className="size-3.5" /></button>
      </motion.div>)}
    </AnimatePresence>
  </div>;
}
