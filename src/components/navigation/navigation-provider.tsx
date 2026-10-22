"use client";

import { createContext, useCallback, useContext, useMemo, useOptimistic, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadingState, PageLoading, type LoadingVariant } from "@/components/common/loading-state";
import { booksHref, slugFromPath } from "@/lib/domain/paths";
import { cn } from "@/lib/utils";

type NavigateOptions = { scroll?: boolean; replace?: boolean };
type NavigationRequest = { href: string; scope: string; label: string };
type NavigationContextValue = { request: NavigationRequest | null; navigate: (href: string, options?: NavigateOptions) => void };
const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [request, setRequest] = useOptimistic<NavigationRequest | null>(null);
  const navigate = useCallback((href: string, options: NavigateOptions = {}) => {
    const from = new URL(`${pathname}?${searchParams}`, window.location.origin);
    const to = new URL(booksHref(href, slugFromPath(pathname)), window.location.href);
    if (to.origin !== from.origin || !["http:", "https:"].includes(to.protocol)) return;
    const destination = `${to.pathname}${to.search}${to.hash}`;
    startTransition(() => {
      if (from.pathname !== to.pathname || from.search !== to.search) setRequest({ href: destination, scope: from.pathname === to.pathname ? "same-page" : "page", label: "Loading…" });
      if (options.replace) router.replace(destination, { scroll: options.scroll });
      else router.push(destination, { scroll: options.scroll });
    });
  }, [pathname, router, searchParams, setRequest]);
  const value = useMemo(() => ({ request: pending ? request : null, navigate }), [navigate, pending, request]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() { return useContext(NavigationContext); }

export function useNavigationRouter() {
  const router = useRouter();
  const navigation = useNavigation();
  const navigate = navigation?.navigate;
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: { scroll?: boolean }) => navigate ? navigate(href, options) : router.push(href, options),
    replace: (href: string, options?: { scroll?: boolean }) => navigate ? navigate(href, { ...options, replace: true }) : router.replace(href, options),
  }), [navigate, router]);
}

export function NavigationContent({ scope, label, variant = "panel", regionLabel, className, children }: {
  scope: string | string[]; label: string; variant?: LoadingVariant; regionLabel?: string; className?: string; children: ReactNode;
}) {
  const navigation = useNavigation();
  const request = navigation?.request;
  const busy = !!request && (Array.isArray(scope) ? scope.includes(request.scope) : scope === request.scope);
  return <section aria-label={regionLabel} aria-busy={busy} className={cn("min-w-0", className)}>
    {busy ? variant === "page" ? <PageLoading label={request.label} /> : <LoadingState label={label} variant={variant} className="p-4" /> : null}
    <div hidden={busy} className={busy ? undefined : "contents"}>{children}</div>
  </section>;
}
