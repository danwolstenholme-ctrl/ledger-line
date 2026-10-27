import "server-only";

import { one, sql } from "@/lib/db";
import { checkVatNumber } from "@/lib/domain/eu-vat";
import { answerView, latestChecks, viesAvailability, type VatCheckRow } from "@/lib/vies";

/**
 * Every VAT number the practice zero-rates against: each company's customers
 * in other EU states and its suppliers there under the reverse charge, with
 * the last time VIES confirmed each one. And the checks made, latest first.
 */
export async function getVatNumbers() {
  const [practice, parties, recent, availability] = await Promise.all([
    one<{ id: string }>("select id from organisations where is_practice"),
    sql<{ id: string; kind: "customer" | "supplier"; name: string; vat_number: string; country: string; organisation_id: string; slug: string; company: string }>(`
      select c.id, 'customer' as kind, c.name, c.vat_number, c.country, o.id as organisation_id, o.slug, o.name as company
        from customers c join organisations o on o.id = c.organisation_id where c.is_active and c.eu_business and c.vat_number is not null
      union all
      select s.id, 'supplier', s.name, s.vat_number, s.country, o.id, o.slug, o.name
        from suppliers s join organisations o on o.id = s.organisation_id where s.is_active and s.reverse_charge and s.vat_number is not null and s.country <> 'CY'
      order by 8, 3`),
    sql<VatCheckRow>(`select c.*, o.name as requester_name from vat_checks c join organisations o on o.id = c.organisation_id order by c.checked_at desc limit 12`),
    viesAvailability(),
  ]);
  const checks = await latestChecks(parties.map(party => { const shape = checkVatNumber(party.vat_number, party.country); return shape.ok ? shape.display : ""; }));
  const rows = parties.map(party => {
    const shape = checkVatNumber(party.vat_number, party.country);
    const kept = shape.ok ? answerView(checks.get(shape.display), party.name) : null;
    const state = !shape.ok ? "malformed" : !kept ? "unchecked" : !kept.valid ? "invalid" : kept.stale ? "stale" : kept.match === "differs" ? "differs" : "valid";
    return { ...party, shape, kept, state } as const;
  });
  return {
    rows, recent, availability, practiceId: practice?.id ?? "",
    counts: { total: rows.length, attention: rows.filter(row => row.state !== "valid").length },
  };
}
