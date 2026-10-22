"use client";

import type { ComponentProps } from "react";
import { useNavigationRouter } from "@/components/navigation/navigation-provider";

/** GET searches share client navigation feedback; mutations keep their forms. */
export function NavigationForm({ action, onSubmit, ...props }: Omit<ComponentProps<"form">, "action"> & { action: string }) {
  const router = useNavigationRouter();
  return <form {...props} action={action} onSubmit={event => {
    onSubmit?.(event);
    if (event.defaultPrevented) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | HTMLInputElement | null;
    const target = submitter?.formTarget || form.target;
    if (target && target !== "_self") return;
    const method = submitter?.hasAttribute("formmethod") ? submitter.formMethod : form.method;
    if (method.toLowerCase() !== "get") return;
    const actionUrl = submitter?.hasAttribute("formaction") ? submitter.formAction : form.action;
    const url = new URL(actionUrl, window.location.href);
    if (url.origin !== window.location.origin) return;
    const fields = new FormData(form, submitter);
    url.search = "";
    for (const [key, value] of fields) if (typeof value === "string") url.searchParams.append(key, value);
    event.preventDefault();
    router.push(`${url.pathname}${url.search}${url.hash}`);
  }} />;
}
