import "server-only";

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { getPayslipDocuments } from "@/lib/data/payroll";
import { CY_RATES, employerCost } from "@/lib/domain/payroll-cy";
import { formatIban } from "@/lib/domain/iban";
import { formatAmount, formatDate } from "@/lib/format";
import "./pdf";

/**
 * A month's payslips as one PDF, a page for each employee: what they earned,
 * what was withheld and why, what they are paid and where, the year to date,
 * and, for their information, what the employer paid on top.
 */

type PayslipData = NonNullable<Awaited<ReturnType<typeof getPayslipDocuments>>>;

const INK = "#1d2433", MUTED = "#5b6474", FAINT = "#8a93a3", LINE = "#d9dde5", WASH = "#f3f5f9", STAMP = "#a33a3a";
const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 9.5, color: INK, paddingTop: 42, paddingBottom: 64, paddingHorizontal: 48 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  company: { fontSize: 15, fontWeight: 500 },
  right: { width: 220, textAlign: "right", color: MUTED, fontSize: 8.5, lineHeight: 1.4 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28, paddingBottom: 8, borderBottomWidth: 1.5 },
  title: { fontSize: 18, fontWeight: 500, letterSpacing: 1.2 },
  stamp: { fontSize: 10, fontWeight: 500, color: STAMP, letterSpacing: 1 },
  label: { color: FAINT, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  parties: { flexDirection: "row", gap: 24, marginTop: 16 },
  name: { fontSize: 11, fontWeight: 500, marginBottom: 2 },
  small: { fontSize: 8.5, color: MUTED, lineHeight: 1.45 },
  net: { width: 190, padding: 10, backgroundColor: WASH, borderRadius: 3 },
  netAmount: { fontSize: 16, fontWeight: 500, marginTop: 1 },
  columns: { flexDirection: "row", gap: 20, marginTop: 20 },
  column: { flex: 1 },
  headRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 8, backgroundColor: WASH },
  head: { color: MUTED, fontSize: 7.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 0.75, borderBottomColor: LINE },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 8, fontWeight: 500 },
  note: { marginTop: 18, fontSize: 8, color: MUTED, lineHeight: 1.45 },
  footer: { position: "absolute", left: 48, right: 48, bottom: 28, paddingTop: 8, borderTopWidth: 0.75, borderTopColor: LINE, flexDirection: "row", justifyContent: "space-between", color: FAINT, fontSize: 7.5 },
});

/** `rows`: label and amount; a line of nothing is left out where `optional` names it. */
function Rows({ title, rows, total, optional = [] }: { title: string; rows: [string, number][]; total?: [string, number]; optional?: string[] }) {
  return <View style={styles.column}>
    <View style={styles.headRow}><Text style={styles.head}>{title}</Text><Text style={styles.head}>Amount</Text></View>
    {rows.filter(([label, value]) => value !== 0 || !optional.includes(label)).map(([label, value]) => <View key={label} style={styles.row}><Text>{label}</Text><Text>{formatAmount(value)}</Text></View>)}
    {total ? <View style={styles.total}><Text>{total[0]}</Text><Text>{formatAmount(total[1])}</Text></View> : null}
  </View>;
}

function Payslips({ org, run, slips }: PayslipData) {
  const accent = /^#[0-9a-f]{6}$/i.test(org.invoice_accent) ? org.invoice_accent : INK;
  const month = new Date(`${run.period}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const registered = [org.tic ? `TIC ${org.tic}` : null, org.he_number ? (/^HE/i.test(org.he_number) ? org.he_number : `HE ${org.he_number}`) : null].filter(Boolean).join(" · ");
  return <Document title={`Payslips ${month}`} author={org.name}>
    {slips.map(slip => <Page key={slip.id} size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={[styles.company, { color: accent }]}>{org.name}</Text>
        <View style={styles.right}>
          {(org.address ?? "").split(/\n|,\s*/).filter(Boolean).map((line, index) => <Text key={index}>{line}</Text>)}
          {registered ? <Text>{registered}</Text> : null}
        </View>
      </View>
      <View style={[styles.titleRow, { borderBottomColor: accent }]}>
        <Text style={[styles.title, { color: accent }]}>PAYSLIP</Text>
        {run.status === "draft" ? <Text style={styles.stamp}>DRAFT, NOT YET APPROVED</Text> : <Text style={{ fontSize: 10, fontWeight: 500 }}>{month}</Text>}
      </View>
      <View style={styles.parties}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Employee</Text>
          <Text style={styles.name}>{slip.name}</Text>
          {slip.job_title ? <Text style={styles.small}>{slip.job_title}</Text> : null}
          <Text style={styles.small}>{[slip.tic ? `TIC ${slip.tic}` : null, slip.social_insurance_no ? `Social insurance ${slip.social_insurance_no}` : null].filter(Boolean).join(" · ") || " "}</Text>
          <Text style={styles.small}>Pay period {formatDate(run.period)} to {formatDate(new Date(Date.UTC(Number(run.period.slice(0, 4)), Number(run.period.slice(5, 7)), 0)).toISOString().slice(0, 10))} · paid {formatDate(run.pay_date)}</Text>
        </View>
        <View style={styles.net}>
          <Text style={styles.label}>Net pay</Text>
          <Text style={styles.netAmount}>{formatAmount(slip.net)}</Text>
          <Text style={[styles.small, { marginTop: 3 }]}>{slip.iban ? `To ${formatIban(slip.iban).replace(/^(\S+ \S+).*(\S{4})$/, "$1 … $2")}` : "Paid as agreed"}</Text>
        </View>
      </View>
      <View style={styles.columns}>
        <Rows title="Earnings" rows={[["Salary", slip.salary], ["Overtime, bonus and other pay", slip.otherPay], ["13th salary", slip.thirteenth]]} total={["Gross pay", slip.gross]}
          optional={["Overtime, bonus and other pay", "13th salary"]} />
        <Rows title="Withheld" rows={[[`Social insurance (${CY_RATES.si}%)`, slip.si_employee], [`GESY (${CY_RATES.gesyEmployee}%)`, slip.gesy_employee], ["Income tax", slip.paye]]}
          total={["Total withheld", Math.round((slip.si_employee + slip.gesy_employee + slip.paye) * 100) / 100]} />
      </View>
      <View style={styles.columns}>
        <Rows title={`The year to date, ${run.period.slice(0, 4)}`} rows={[["Gross pay", slip.ytd.gross], ["Social insurance", slip.ytd.si], ["GESY", slip.ytd.gesy], ["Income tax", slip.ytd.tax]]} />
        <Rows title="Paid by the employer, on top" rows={[[`Social insurance (${CY_RATES.si}%)`, slip.si_employer], [`GESY (${CY_RATES.gesyEmployer}%)`, slip.gesy_employer],
          [`Social Cohesion Fund (${CY_RATES.socialCohesion}%)`, slip.social_cohesion], [`Redundancy Fund (${CY_RATES.redundancy}%)`, slip.redundancy], [`Human Resource Development (${CY_RATES.training}%)`, slip.training]]}
          total={["Total", employerCost(slip)]} />
      </View>
      <Text style={styles.note}>Social insurance is on earnings up to the month’s maximum insurable earnings; this month {formatAmount(slip.insurable)} of the pay was insurable. Income tax is the year’s tax on the year’s pay, less what has been withheld before, after social insurance and GESY and the deductions declared on form TD59.</Text>
      <View style={styles.footer} fixed>
        <Text>{org.name} · payslip for {month}</Text>
        <Text>{slip.name}</Text>
      </View>
    </Page>)}
  </Document>;
}

export async function renderPayslips(data: PayslipData): Promise<Buffer> {
  return renderToBuffer(<Payslips {...data} />);
}
