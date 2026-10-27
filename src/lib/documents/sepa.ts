import "server-only";

import { compactIban, validBic, validIban } from "@/lib/domain/iban";

/**
 * A SEPA credit transfer file (ISO 20022 pain.001.001.03): several supplier
 * payments in one upload to the company's online banking, which sends them
 * all on the day asked for. Only payments to a valid IBAN go in it.
 */

export type SepaPayment = { endToEndId: string; amount: number; name: string; iban: string; bic: string | null; remittance: string };

// SEPA's Latin character set: letters, digits, space and / - ? : ( ) . , ' +. Anything else is written as its nearest or dropped.
const ACCENTS: Record<string, string> = { "&": "+", "é": "e", "è": "e", "ê": "e", "ë": "e", "á": "a", "à": "a", "â": "a", "ä": "a", "ö": "o", "ó": "o", "ô": "o", "ü": "u", "ú": "u", "ç": "c", "ñ": "n", "ß": "ss", "æ": "ae", "ø": "o", "å": "a" };
function sepaText(value: string, max: number) {
  const plain = [...value].map(char => ACCENTS[char] ?? ACCENTS[char.toLowerCase()]?.toUpperCase() ?? char).join("");
  return plain.replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "-";
}
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;");
const text = (value: string, max: number) => escapeXml(sepaText(value, max));
const id = (value: string) => value.replace(/[^A-Za-z0-9/\-?:().,'+]/g, "").slice(0, 35) || "NOTPROVIDED";
const cents = (value: number) => Math.round(value * 100);
const amount = (value: number) => (cents(value) / 100).toFixed(2);

/** `salaries`: a payroll's net pay, marked as salaries (category purpose SALA), which banks book as one line and keep private. */
export function sepaCreditTransfer(input: {
  messageId: string; createdAt: string; executionDate: string;
  debtor: { name: string; iban: string; bic: string | null }; payments: SepaPayment[]; salaries?: boolean;
}) {
  const payments = input.payments.filter(payment => validIban(payment.iban) && cents(payment.amount) > 0);
  if (!validIban(input.debtor.iban)) throw new Error("The company's bank account has no valid IBAN.");
  if (!payments.length) throw new Error("No payment has an IBAN to pay to.");
  const total = amount(payments.reduce((sum, payment) => sum + cents(payment.amount), 0) / 100);
  const agent = (bic: string | null) => bic && validBic(bic) ? `<FinInstnId><BIC>${bic.replace(/\s+/g, "").toUpperCase()}</BIC></FinInstnId>` : "<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>";
  const transfers = payments.map(payment => [
    "<CdtTrfTxInf>",
    `<PmtId><EndToEndId>${id(payment.endToEndId)}</EndToEndId></PmtId>`,
    `<Amt><InstdAmt Ccy="EUR">${amount(payment.amount)}</InstdAmt></Amt>`,
    payment.bic && validBic(payment.bic) ? `<CdtrAgt>${agent(payment.bic)}</CdtrAgt>` : "",
    `<Cdtr><Nm>${text(payment.name, 70)}</Nm></Cdtr>`,
    `<CdtrAcct><Id><IBAN>${compactIban(payment.iban)}</IBAN></Id></CdtrAcct>`,
    `<RmtInf><Ustrd>${text(payment.remittance, 140)}</Ustrd></RmtInf>`,
    "</CdtTrfTxInf>",
  ].filter(Boolean).join(""));
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    "<CstmrCdtTrfInitn>",
    `<GrpHdr><MsgId>${id(input.messageId)}</MsgId><CreDtTm>${input.createdAt.slice(0, 19)}</CreDtTm><NbOfTxs>${payments.length}</NbOfTxs><CtrlSum>${total}</CtrlSum><InitgPty><Nm>${text(input.debtor.name, 70)}</Nm></InitgPty></GrpHdr>`,
    "<PmtInf>",
    `<PmtInfId>${id(`${input.messageId}-1`)}</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${payments.length}</NbOfTxs><CtrlSum>${total}</CtrlSum>`,
    `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl>${input.salaries ? "<CtgyPurp><Cd>SALA</Cd></CtgyPurp>" : ""}</PmtTpInf>`,
    `<ReqdExctnDt>${input.executionDate}</ReqdExctnDt>`,
    `<Dbtr><Nm>${text(input.debtor.name, 70)}</Nm></Dbtr>`,
    `<DbtrAcct><Id><IBAN>${compactIban(input.debtor.iban)}</IBAN></Id></DbtrAcct>`,
    `<DbtrAgt>${agent(input.debtor.bic)}</DbtrAgt>`,
    "<ChrgBr>SLEV</ChrgBr>",
    ...transfers,
    "</PmtInf>",
    "</CstmrCdtTrfInitn>",
    "</Document>",
  ].join("\n") + "\n";
}
