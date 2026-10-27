"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

import Link from "@/components/navigation/navigation-link";
import { useNavigation } from "@/components/navigation/navigation-provider";
import { cn } from "@/lib/utils";

/**
 * Ledgerline's motion, in one place. The rule: movement explains a change
 * (where the highlight went, that a page is coming, that a menu opened) and is
 * over before it is noticed. Nothing waits on an animation, and anyone who
 * has asked their system for less motion gets none.
 */

export const SPRING = { type: "spring", stiffness: 560, damping: 42, mass: 0.6 } as const;
export const EASE = [0.2, 0.7, 0.2, 1] as const;

export function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={SPRING}>{children}</MotionConfig>;
}

/** A slim bar in the brand colour while the next page is on its way. Quick pages never show it. */
export function NavigationProgress() {
  const busy = Boolean(useNavigation()?.request);
  return <AnimatePresence>
    {busy ? <motion.div key="progress" aria-hidden className="bg-brand pointer-events-none fixed inset-x-0 top-0 z-[70] h-[2px] origin-left"
      initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: 0.82, transition: { delay: 0.12, duration: 2.4, ease: [0.1, 0.6, 0.2, 1] } }}
      exit={{ scaleX: 1, opacity: 0, transition: { scaleX: { duration: 0.18, ease: EASE }, opacity: { delay: 0.12, duration: 0.2 } } }} /> : null}
  </AnimatePresence>;
}

// The first page arrives with the HTML, already drawn; only pages reached by a click ease in.
let navigatedOnce = false;
export function PageEnter({ children }: { children: ReactNode }) {
  const [animate] = useState(() => navigatedOnce);
  useEffect(() => { navigatedOnce = true; }, []);
  return <motion.div initial={animate ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }}>{children}</motion.div>;
}

/** A row of filter links whose highlight slides to the one chosen. */
export function SlidingTabs({ label, options }: { label: string; options: { label: string; href: string; active: boolean }[] }) {
  return <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">{options.map(option => <Link key={option.label} href={option.href} aria-current={option.active ? "page" : undefined}
    className={cn("focus-visible:ring-ring/40 relative inline-flex min-h-7 items-center rounded-md px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-[3px] touch:min-h-11 touch:px-3.5 touch:text-[14px]", option.active ? "text-brand font-medium" : "text-ink-muted hover:bg-muted hover:text-ink")}>
    {option.active ? <motion.span layoutId={`tabs-${label}`} className="bg-accent absolute inset-0 rounded-md" /> : null}
    <span className="relative">{option.label}</span>
  </Link>)}</nav>;
}

/** A menu that opens with a short spring from the button that opened it. */
export function MenuPanel({ open, className, children, role = "menu" }: { open: boolean; className?: string; children: ReactNode; role?: string }) {
  return <AnimatePresence>
    {open ? <motion.div role={role} className={className} style={{ transformOrigin: "top" }}
      initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -2, scale: 0.99, transition: { duration: 0.12 } }}>
      {children}
    </motion.div> : null}
  </AnimatePresence>;
}
