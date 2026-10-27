"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Camera, ImageUp, Menu, Plus, X, type LucideIcon } from "lucide-react";
import Link from "@/components/navigation/navigation-link";

import { cn } from "@/lib/utils";
import { readFile, storeFiles } from "@/components/capture/send-files";
import { toast, updateToast } from "@/components/common/toaster";
import type { PaletteEntry } from "@/components/shell/command-palette";
import { useI18n } from "@/components/common/locale";

export type MobileTab = { href: string; label: string; icon: LucideIcon; badge?: number; also?: string[] };

/**
 * A phone's way round: four places at the thumb, and + in the middle for what
 * is done on the move: a receipt photographed and read while you carry on, an
 * invoice, money in or out. Desks and tablets keep the menu at the side.
 * `snap`: where photographed documents go (a company's receipts, or the
 * practice's inbox, which works out whose they are).
 */
export function MobileBar({ tabs, actions, snap, pathname, onMenu }: {
  tabs: [MobileTab, MobileTab, MobileTab]; actions: PaletteEntry[]; snap: { companyId?: string; reviewHref: string } | null; pathname: string; onMenu: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const here = (tab: MobileTab) => [tab.href, ...(tab.also ?? [])].some(href => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  // The longest match wins, so a company's Home is not also its Invoices.
  const current = [...tabs].filter(here).sort((a, b) => b.href.length - a.href.length)[0];

  const send = async (files: File[]) => {
    if (!snap || !files.length) return;
    setOpen(false);
    const id = toast({ title: files.length === 1 ? t("Reading it…") : t("Reading {count} documents…", { count: files.length }), detail: t("Claude is reading it. Carry on: it will be here when it’s done."), busy: true });
    const stored = await storeFiles(files, snap.companyId);
    if (!stored.ok) { updateToast(id, { busy: false, tone: "critical", title: t("Not uploaded"), detail: t.message(stored.error) }); return; }
    const results = await Promise.all(stored.files.map(file => file.id ? readFile(file.id) : Promise.resolve({ ok: false, error: file.error ?? "Not uploaded.", count: 0 })));
    const found = results.reduce((sum, result) => sum + (result.ok ? result.count ?? 0 : 0), 0);
    const failed = results.find(result => !result.ok);
    router.refresh();
    updateToast(id, found
      ? { busy: false, tone: "positive", title: found === 1 ? t("Read, and drafted as a bill") : t("{count} bills drafted", { count: found }), detail: t("Check it, then post it to the books."), href: snap.reviewHref, hrefLabel: t("Review") }
      : { busy: false, tone: "critical", title: t("It couldn’t be read"), detail: failed?.error ? t.message(failed.error) : t("Nothing on it looked like an invoice or a receipt."), href: snap.reviewHref, hrefLabel: t("Open receipts") });
  };
  const picker = (camera: boolean) => <input type="file" className="sr-only" accept={camera ? "image/*" : "image/*,application/pdf"} capture={camera ? "environment" : undefined}
    multiple={!camera} onChange={event => { void send([...(event.target.files ?? [])]); event.target.value = ""; }} />;

  const tab = (entry: MobileTab) => <li key={entry.href}>
    <Link href={entry.href} aria-current={entry === current ? "page" : undefined}
      className={cn("relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium", entry === current ? "text-brand" : "text-ink-muted")}>
      <span className="relative"><entry.icon className="size-[22px]" />
        {entry.badge ? <span className="bg-brand ring-surface absolute -top-1 -right-2 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white ring-2">{entry.badge}</span> : null}</span>
      {entry.label}
    </Link>
  </li>;

  return <>
    <nav aria-label={t("On the move")} className="bg-surface/95 border-hairline fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden print:hidden">
      <ul className="grid h-16 grid-cols-5">
        {tab(tabs[0])}{tab(tabs[1])}
        <li className="grid place-items-center">
          <button type="button" onClick={() => setOpen(true)} aria-label={t("Add")} aria-haspopup="dialog" aria-expanded={open}
            className="bg-brand ring-canvas grid size-13 -translate-y-3 place-items-center rounded-full text-white shadow-[0_8px_20px_-6px_var(--brand)] ring-4 active:scale-95">
            <Plus className="size-6" />
          </button>
        </li>
        {tab(tabs[2])}
        <li><button type="button" onClick={onMenu} className="text-ink-muted flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium"><Menu className="size-[22px]" />{t("Menu")}</button></li>
      </ul>
    </nav>
    <AnimatePresence>
      {open ? <div key="sheet" className="fixed inset-0 z-[70] sm:hidden">
        <motion.div aria-hidden className="bg-brand-deep/30 absolute inset-0" onClick={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <motion.div role="dialog" aria-modal="true" aria-label={t("Add")} className="bg-surface absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-2xl"
          initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%", transition: { duration: 0.2 } }} transition={{ type: "spring", damping: 34, stiffness: 380 }}
          drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} onDragEnd={(_, info) => { if (info.offset.y > 90) setOpen(false); }}>
          <div aria-hidden className="bg-hairline-strong mx-auto mt-2.5 h-1 w-10 rounded-full" />
          <div className="flex items-center justify-between px-5 pt-3 pb-2">
            <h2 className="text-ink text-[17px] font-semibold">{t("Add")}</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("Close")} className="text-ink-muted hover:bg-muted grid size-10 place-items-center rounded-full"><X className="size-5" /></button>
          </div>
          {snap ? <div className="grid grid-cols-2 gap-2.5 px-4 pb-3">
            <label className="bg-brand flex cursor-pointer flex-col gap-2 rounded-xl p-4 text-white active:scale-[0.98]">
              <Camera className="size-6" /><span className="text-[15px] font-semibold leading-tight">{t("Snap a receipt")}</span><span className="text-[12.5px] leading-snug text-white/80">{t("Claude reads it while you carry on")}</span>
              {picker(true)}
            </label>
            <label className="border-hairline bg-surface-sunken flex cursor-pointer flex-col gap-2 rounded-xl border p-4 active:scale-[0.98]">
              <ImageUp className="text-brand size-6" /><span className="text-ink text-[15px] font-semibold leading-tight">{t("Choose a file")}</span><span className="text-ink-muted text-[12.5px] leading-snug">{t("A photo or a PDF you already have")}</span>
              {picker(false)}
            </label>
          </div> : null}
          <ul className="px-2 pb-2">{actions.map(action => <li key={action.id}>
            <Link href={action.href} onClick={() => setOpen(false)} className="active:bg-muted flex items-center gap-3.5 rounded-xl px-3 py-3">
              <span className="bg-brand-50 text-brand grid size-10 shrink-0 place-items-center rounded-full"><action.icon className="size-5" /></span>
              <span className="text-ink text-[15px] font-medium">{action.label}</span>
            </Link>
          </li>)}</ul>
        </motion.div>
      </div> : null}
    </AnimatePresence>
  </>;
}
