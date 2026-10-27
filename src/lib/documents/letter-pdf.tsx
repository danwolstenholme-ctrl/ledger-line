import "server-only";

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { one } from "@/lib/db";
import { letterDate, type Letter } from "@/lib/domain/onboarding";
import { makePdf } from "./pdf-fonts";

/**
 * The engagement letter as a PDF: the practice's letterhead, the letter word
 * for word as it was sent, and, once signed, the signature and its record:
 * who, when, from where, and the fingerprint of the text they agreed to.
 */

const INK = "#1d2433", MUTED = "#5b6474", FAINT = "#8a93a3", LINE = "#d9dde5", WASH = "#f3f5f9";
const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 9.5, color: INK, paddingTop: 42, paddingBottom: 64, paddingHorizontal: 54 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 14, borderBottomWidth: 1.5 },
  firm: { fontSize: 16, fontWeight: 500 },
  right: { width: 220, textAlign: "right", color: MUTED },
  p: { fontSize: 9.5, lineHeight: 1.45, marginBottom: 6 },
  title: { fontSize: 13, fontWeight: 500, marginTop: 20, marginBottom: 10 },
  heading: { fontSize: 10, fontWeight: 500, marginTop: 10, marginBottom: 4 },
  bullet: { flexDirection: "row", marginBottom: 4, paddingLeft: 4 },
  dot: { width: 10, fontSize: 9.5, lineHeight: 1.45 },
  signatures: { flexDirection: "row", gap: 24, marginTop: 22 },
  box: { flex: 1, borderTopWidth: 0.75, borderTopColor: LINE, paddingTop: 8 },
  label: { color: FAINT, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  signed: { fontSize: 15, fontWeight: 500, fontStyle: "normal", marginBottom: 2 },
  record: { marginTop: 20, padding: 10, backgroundColor: WASH, borderRadius: 3 },
  mono: { fontSize: 7.5, color: MUTED, lineHeight: 1.4 },
  footer: { position: "absolute", left: 54, right: 54, bottom: 28, paddingTop: 8, borderTopWidth: 0.75, borderTopColor: LINE, flexDirection: "row", justifyContent: "space-between", color: FAINT, fontSize: 7.5 },
});

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Nicosia" });

type LetterPdfData = {
  letter: Letter; accent: string; practice: { name: string; address: string | null; email: string | null; he: string | null };
  sentAt: string | null; hash: string | null;
  signed: { name: string; position: string | null; at: string; ip: string | null; agent: string | null; hash: string | null } | null;
};

function EngagementLetter({ letter, accent, practice, sentAt, hash, signed }: LetterPdfData) {
  return <Document title={letter.title} author={practice.name}>
    <Page size="A4" style={styles.page}>
      <View style={[styles.header, { borderBottomColor: accent }]}>
        <Text style={[styles.firm, { color: accent }]}>{practice.name}</Text>
        <View style={styles.right}>
          {(practice.address ?? "").split(/,\s*|\n/).filter(Boolean).map((line, index) => <Text key={index} style={{ fontSize: 8.5, lineHeight: 1.4 }}>{line}</Text>)}
          {practice.email ? <Text style={{ fontSize: 8.5, lineHeight: 1.4 }}>{practice.email}</Text> : null}
        </View>
      </View>
      <Text style={[styles.p, { marginTop: 18, color: MUTED }]}>{letterDate(letter.date)}</Text>
      <Text style={[styles.p, { color: MUTED }]}>Private and confidential</Text>
      <Text style={[styles.p, { fontWeight: 500 }]}>{letter.to.company}</Text>
      {letter.to.attention ? <Text style={styles.p}>For the attention of {letter.to.attention}</Text> : null}
      {letter.to.address ? <Text style={styles.p}>{letter.to.address}</Text> : null}
      <Text style={styles.title}>{letter.title}</Text>
      {letter.sections.map((section, index) => <View key={index} wrap>
        {section.heading ? <Text style={styles.heading} minPresenceAhead={40}>{section.heading}</Text> : null}
        {section.paragraphs.map((text, at) => <Text key={at} style={styles.p}>{text}</Text>)}
        {(section.bullets ?? []).map((text, at) => <View key={at} style={styles.bullet}><Text style={styles.dot}>•</Text><Text style={[styles.p, { flex: 1, marginBottom: 0 }]}>{text}</Text></View>)}
      </View>)}
      <Text style={[styles.p, { marginTop: 12 }]}>Yours sincerely,</Text>
      <Text style={styles.p}>{letter.signOff}</Text>
      <View style={styles.signatures} wrap={false}>
        <View style={styles.box}>
          <Text style={styles.label}>Agreed for and on behalf of {letter.to.company}</Text>
          {signed ? <>
            <Text style={[styles.signed, { color: accent }]}>{signed.name}</Text>
            <Text style={styles.p}>{signed.position ?? "Director"} · signed electronically {when(signed.at)}</Text>
          </> : <>
            <Text style={[styles.p, { marginTop: 18 }]}>Signed ______________________________</Text>
            <Text style={styles.p}>Name ________________  Position ____________  Date __________</Text>
          </>}
        </View>
      </View>
      {signed ? <View style={styles.record} wrap={false}>
        <Text style={styles.label}>Signature record</Text>
        <Text style={styles.mono}>Sent by {practice.name}{sentAt ? ` on ${when(sentAt)}` : ""}. Signed by {signed.name}{signed.position ? `, ${signed.position}` : ""}, on {when(signed.at)} (Cyprus time), from {signed.ip ?? "an unrecorded address"}.</Text>
        <Text style={styles.mono}>Letter fingerprint (SHA-256 of its text): {signed.hash ?? hash}</Text>
        <Text style={styles.mono}>The fingerprint was taken when the letter was sent and checked when it was signed: any change to a word of it would change the fingerprint.</Text>
      </View> : null}
      <View style={styles.footer} fixed>
        <Text>{[practice.name, practice.he ? `Registered in Cyprus, ${practice.he}` : null].filter(Boolean).join(" · ")}</Text>
        <Text render={({ pageNumber, totalPages }) => `Engagement letter · ${letter.to.company} · page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  </Document>;
}

/** The letter of one client file as a PDF response: as sent (or as it would be sent), and signed if it is. */
export async function letterPdfResponse(fileId: string, inline: boolean, draft?: Letter) {
  const row = await one<{ company_name: string; letter_text: string | null; letter_hash: string | null; letter_sent_at: string | null; signed_at: string | null; signed_name: string | null;
    signed_position: string | null; signed_ip: string | null; signed_agent: string | null; signed_hash: string | null; brand_color: string; practice_name: string | null; address: string | null; email: string | null; he: string | null }>(
    `select f.company_name, f.letter_text, f.letter_hash, f.letter_sent_at, f.signed_at, f.signed_name, f.signed_position, f.signed_ip, f.signed_agent, f.signed_hash, p.brand_color,
       o.name as practice_name, o.address, o.contact_email as email, o.he_number as he
     from client_files f join practices p on p.id = f.practice_id left join organisations o on o.practice_id = p.id and o.is_practice where f.id = $1`, [fileId]);
  const letter: Letter | null = row?.letter_text ? JSON.parse(row.letter_text) : draft ?? null;
  if (!row || !letter) return new Response("There is no letter for this client yet.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const bytes = await makePdf(() => renderToBuffer(<EngagementLetter letter={letter} accent={/^#[0-9a-f]{6}$/i.test(row.brand_color) ? row.brand_color : INK}
    practice={{ name: row.practice_name ?? "", address: row.address, email: row.email, he: row.he }} sentAt={row.letter_sent_at} hash={row.letter_hash}
    signed={row.signed_at && row.signed_name ? { name: row.signed_name, position: row.signed_position, at: row.signed_at, ip: row.signed_ip, agent: row.signed_agent, hash: row.signed_hash } : null} />));
  const name = `Engagement letter ${row.company_name.replace(/[^A-Za-z0-9 ._-]+/g, "-")}${row.signed_at ? " (signed)" : ""}.pdf`;
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "cache-control": "private, no-store" } });
}
