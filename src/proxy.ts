import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { AUTH_MODE, DEMO_COOKIE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isPublicPath } from "@/lib/auth/config";

/**
 * Before each request: tag a request under /c/{slug} with the company it is
 * about, refresh a Supabase session's cookies, and send anyone not signed in
 * to sign in, except at the front door, where a visitor sees what Ledgerline
 * is (public/home.html) and someone signed in their dashboard. This is the
 * optimistic check only; who someone is, is verified where their data is
 * read (lib/auth/session, lib/db).
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const slug = /^\/c\/([a-z0-9-]+)/.exec(path)?.[1];
  const refreshed: { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }[] = [];
  let signedIn: boolean;

  if (AUTH_MODE === "supabase") {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) { for (const cookie of list) { request.cookies.set(cookie.name, cookie.value); refreshed.push(cookie); } },
      },
    });
    // Refreshes the session if it has expired, and checks it.
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } else {
    signedIn = request.cookies.get(DEMO_COOKIE)?.value !== "out";
  }

  if (!signedIn && !isPublicPath(path)) {
    if (request.method !== "GET" && request.method !== "HEAD") return new NextResponse("Sign in first.", { status: 401 });
    if (path === "/") {
      const front = NextResponse.rewrite(new URL("/home.html", request.url));
      for (const cookie of refreshed) front.cookies.set(cookie.name, cookie.value, cookie.options);
      return front;
    }
    const to = new URL("/sign-in", request.url);
    if (path !== "/") to.searchParams.set("next", `${path}${request.nextUrl.search}`);
    const response = NextResponse.redirect(to);
    for (const cookie of refreshed) response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  }

  const headers = new Headers(request.headers);
  headers.delete("x-ledgerline-org");
  if (slug) headers.set("x-ledgerline-org", slug);
  // The refreshed session travels on to the page as well as back to the browser.
  if (refreshed.length) headers.set("cookie", request.cookies.toString());
  const response = NextResponse.next({ request: { headers } });
  for (const cookie of refreshed) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
