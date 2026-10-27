"use client";

import { useOffline } from "next/offline";
import { WifiOff } from "lucide-react";

import { useI18n } from "@/components/common/locale";

/** When the connection drops: what is done meanwhile waits, and is sent as soon as it is back (next.config: experimental.useOffline). */
export function OfflineBanner() {
  const { t } = useI18n();
  if (!useOffline()) return null;
  return <p role="status" className="bg-caution-soft border-caution-line text-caution sticky top-14 z-20 flex items-center justify-center gap-2 border-b px-4 py-1.5 text-[13px] print:hidden">
    <WifiOff className="size-3.5 shrink-0" />{t("You’re offline. Anything you do now is sent as soon as the connection is back.")}
  </p>;
}
