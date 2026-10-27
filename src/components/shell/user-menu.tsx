"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, LogOut, Users } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { chooseLanguage } from "@/lib/actions/account";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n";
import { MenuPanel } from "@/components/motion/motion";
import { useI18n } from "@/components/common/locale";
import type { ShellUser } from "@/components/shell/app-shell";

/**
 * Who is signed in, the language they read Ledgerline in, and signing out.
 * In the laptop demo, signing in as someone else, to see Ledgerline as they do.
 */
export function UserMenu({ user }: { user: ShellUser }) {
  const { t, locale } = useI18n();
  const [switching, startSwitch] = useTransition();
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
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={t("{name}: account", { name: user.name })}
      className="hover:bg-muted flex items-center gap-2 rounded-md py-1 pr-1.5 pl-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span className="bg-brand grid size-7 place-items-center rounded-full text-[11px] font-semibold text-white">{user.initials}</span>
      <span className="hidden text-left leading-tight sm:block"><span className="text-ink block text-[13px] font-medium">{user.name}</span><span className="text-ink-faint block text-[11.5px]">{user.role}</span></span>
      <ChevronDown className="text-ink-faint hidden size-3.5 sm:block" />
    </button>
    <MenuPanel open={open} role="menu" className="bg-surface border-hairline absolute top-full right-0 z-40 mt-1 w-64 overflow-hidden rounded-md border shadow-lg">
      <div className="border-hairline border-b px-3 py-2.5">
        <p className="text-ink truncate text-[13px] font-medium">{user.name}</p>
        <p className="text-ink-faint truncate text-[12px]">{user.email}</p>
      </div>
      {/* Theirs alone, wherever they sign in: the menu, Home, invoices and receipts read in it. */}
      <div role="group" aria-label={t("Language")} className="border-hairline border-b px-3 py-2">
        <p className="text-ink-faint flex items-center gap-1.5 text-[11.5px]">{t("Language")}{switching ? <Loader2 aria-hidden className="size-3 animate-spin" /> : null}</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1">{LOCALES.map(code => <button key={code} type="button" role="menuitemradio" aria-checked={code === locale} lang={code === "el" ? "el" : "en"} disabled={switching}
          onClick={() => { if (code === locale) return; const form = new FormData(); form.set("locale", code); startSwitch(() => chooseLanguage(form)); }}
          className={cn("flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[12.5px] touch:py-2.5", code === locale ? "border-brand-200 bg-brand-50 text-brand font-medium" : "border-hairline text-ink hover:bg-muted")}>
          {code === locale ? <Check className="size-3.5" /> : null}{LOCALE_NAMES[code]}
        </button>)}</div>
      </div>
      {user.demo ? <Link href="/sign-in" role="menuitem" onClick={() => setOpen(false)} className="text-ink hover:bg-muted flex items-center gap-2 px-3 py-2 text-[13px]"><Users className="size-3.5" />{t("Sign in as someone else")}</Link> : null}
      <form action={signOut}><button type="submit" role="menuitem" className="text-ink hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]"><LogOut className="size-3.5" />{t("Sign out")}</button></form>
    </MenuPanel>
  </div>;
}
