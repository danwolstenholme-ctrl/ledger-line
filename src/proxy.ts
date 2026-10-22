import { NextResponse, type NextRequest } from "next/server";

/** Tag each request under /c/{slug} with the company it is about, for the data layer and server actions. */
export function proxy(request: NextRequest) {
  const slug = /^\/c\/([a-z0-9-]+)/.exec(request.nextUrl.pathname)?.[1];
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-ledgerline-org");
  if (slug) requestHeaders.set("x-ledgerline-org", slug);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
