"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Users } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { signOut } from "@/lib/actions/auth";
import { MenuPanel } from "@/components/motion/motion";
import type { ShellUser } from "@/components/shell/app-shell";

/** Who is signed in, and signing out. In the laptop demo, signing in as someone else, to see Ledgerline as they do. */
export function UserMenu({ user }: { user: ShellUser }) {
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
  return <div ref={ref} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={`${user.name}: account`}
      className="hover:bg-muted flex items-center gap-2 rounded-md py-1 pr-1.5 pl-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span className="bg-brand grid size-7 place-items-center rounded-full text-[10.5px] font-semibold text-white">{user.initials}</span>
      <span className="hidden text-left leading-tight sm:block"><span className="text-ink block text-[12.5px] font-medium">{user.name}</span><span className="text-ink-faint block text-[11px]">{user.role}</span></span>
      <ChevronDown className="text-ink-faint hidden size-3.5 sm:block" />
    </button>
    <MenuPanel open={open} role="menu" className="bg-surface border-hairline absolute top-full right-0 z-40 mt-1 w-64 overflow-hidden rounded-md border shadow-lg">
      <div className="border-hairline border-b px-3 py-2.5">
        <p className="text-ink truncate text-[12.5px] font-medium">{user.name}</p>
        <p className="text-ink-faint truncate text-[11.5px]">{user.email}</p>
      </div>
      {user.demo ? <Link href="/sign-in" role="menuitem" onClick={() => setOpen(false)} className="text-ink hover:bg-muted flex items-center gap-2 px-3 py-2 text-[12.5px]"><Users className="size-3.5" />Sign in as someone else</Link> : null}
      <form action={signOut}><button type="submit" role="menuitem" className="text-ink hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]"><LogOut className="size-3.5" />Sign out</button></form>
    </MenuPanel>
  </div>;
}
