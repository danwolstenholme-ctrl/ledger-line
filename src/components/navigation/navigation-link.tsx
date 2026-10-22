"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { useNavigation } from "@/components/navigation/navigation-provider";
import { booksHref, slugFromPath } from "@/lib/domain/paths";

/** Next's Link, with links to the books resolved inside the company being viewed. */
export default function NavigationLink({ href, onNavigate, ...props }: ComponentProps<typeof NextLink>) {
  const navigation = useNavigation();
  const slug = slugFromPath(usePathname() ?? "");
  const target = typeof href === "string" ? booksHref(href, slug) : href;
  return <NextLink {...props} href={target} onNavigate={event => {
    let prevented = false;
    onNavigate?.({ preventDefault: () => { prevented = true; event.preventDefault(); } });
    if (prevented || !navigation || typeof target !== "string") return;
    event.preventDefault();
    navigation.navigate(target, { scroll: props.scroll, replace: props.replace });
  }} />;
}
