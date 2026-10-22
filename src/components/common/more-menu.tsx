"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, FileCode, FileMinus, Repeat, type LucideIcon } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { recordOutlineButton } from "@/components/records/record-layout";
import { MenuPanel } from "@/components/motion/motion";

const ICONS = { copy: Copy, credit: FileMinus, repeat: Repeat, xml: FileCode } satisfies Record<string, LucideIcon>;
/** `download`: a file to save, not a page to go to. */
export type MoreMenuItem = { href: string; label: string; hint?: string; icon: keyof typeof ICONS; download?: boolean };

/** The less frequent actions on a record, behind one button so the header keeps to what is done most. */
export function MoreMenu({ items, label = "More" }: { items: MoreMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); };
  }, [open]);
  if (!items.length) return null;
  return <div ref={ref} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={`${label} actions`} className={recordOutlineButton}>{label}<ChevronDown className="size-3.5" /></button>
    <MenuPanel open={open} className="bg-surface border-hairline absolute top-full right-0 z-20 mt-1 w-64 overflow-hidden rounded-md border py-1 shadow-lg">
      {items.map(item => {
        const Icon = ICONS[item.icon];
        const body = <><Icon className="text-ink-muted mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0"><span className="text-ink block text-[12.5px] font-medium">{item.label}</span>{item.hint ? <span className="text-ink-faint block text-[11.5px] leading-snug">{item.hint}</span> : null}</span></>;
        const style = "hover:bg-muted flex items-start gap-2.5 px-3 py-2 touch:py-3";
        return item.download ? <a key={item.href} role="menuitem" href={item.href} download onClick={() => setOpen(false)} className={style}>{body}</a>
          : <Link key={item.href} role="menuitem" href={item.href} onClick={() => setOpen(false)} className={style}>{body}</Link>;
      })}
    </MenuPanel>
  </div>;
}
