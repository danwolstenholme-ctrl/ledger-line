import "server-only";

import { toCsv } from "@/lib/domain/billing";

/** A report as a CSV download: a byte-order mark so Excel reads the euro sign, and never cached. */
export function csvResponse(name: string, header: readonly string[], rows: string[][]) {
  return new Response(`﻿${toCsv(header, rows)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ledgerline-${name}.csv"`,
      "cache-control": "no-store",
    },
  });
}

export function unavailable(what: string) {
  return new Response(`The ${what} could not be read. Try again.`, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function searchParams(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}
