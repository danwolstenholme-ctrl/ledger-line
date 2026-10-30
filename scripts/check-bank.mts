/**
 * Bank statements, checked line by line: the CSV, CAMT.053, MT940 and OFX
 * readers with their opening and closing balances, the lines they leave out
 * (other currencies, pending payments, holds) and the account a file is for;
 * several statements set against each other in date order; and invoices
 * raised from money received (the VAT worked back from a payment, to the
 * cent, payers' names read as customers, and money in that isn't a sale).
 * All the files here are made up, laid out as each bank documents its own.
 *
 *   npm run check:bank
 */
import { detectCsvLayout, formatFromName, ibanOf, otherAccount, parseAmount, parseStatementFile, readCsv, statementChain } from "../src/lib/domain/bank-statements";
import { fromPerson, nameKey, namedAsCompany, notASale, payerName, paymentDescription, raisedFromPayment, splitGross, tidyName } from "../src/lib/domain/bank-invoicing";

const checks: [string, unknown, unknown][] = [];
const expect = (what: string, got: unknown, wanted: unknown) => checks.push([what, got, wanted]);
const money = (value: number) => `€${value.toFixed(2)}`;
const amounts = (parsed: { lines: { amount: number }[] }) => parsed.lines.map(line => line.amount);

// A CSV listed newest first, as many banks do: the opening balance is the earliest line's, before its own amount.
const csv = parseStatementFile(`Date,Description,Amount,Balance
03/04/2026,SEPA CREDIT FROM ACME LTD,1190.00,2190.00
02/04/2026,CARD PAYMENT STATIONERY,-10.00,1000.00
01/04/2026,BANK CHARGES,-5.00,1010.00
`);
expect("A CSV is read as CSV", csv.format, "csv");
expect("A CSV's three lines are read", csv.lines.length, 3);
expect("A CSV newest first closes on its latest line", csv.closingBalance, 2190);
expect("A CSV newest first opens before its earliest line", csv.openingBalance, 1015);
expect("Money out is negative", csv.lines.find(line => line.description === "BANK CHARGES")?.amount, -5);

// One day, newest first: the order comes from the balances, as the dates are all the same.
const oneDay = parseStatementFile("Date,Description,Amount,Balance\n05/05/2026,TAXI,-20.00,9000.00\n05/05/2026,COFFEE,-10.00,9020.00\n05/05/2026,SALE,30.00,9030.00\n");
expect("A one-day CSV newest first opens and closes where its balances say", [oneDay.openingBalance, oneDay.closingBalance], [9000, 9000]);
// A balance only on each day's last line: what the statement opened on can't be known.
const daily = parseStatementFile("Date,Description,Amount,Balance\n01/05/2026,SALE,10.00,\n01/05/2026,FEE,-2.00,1008.00\n02/05/2026,SALE,5.00,1013.00\n");
expect("A CSV with a balance once a day gives no opening balance, and its closing one", [daily.openingBalance, daily.closingBalance], [null, 1013]);
// A bank id twice in one file keeps both lines.
const twice = parseStatementFile("Date,Description,Amount,Transaction ID\n01/05/2026,PAYOUT,-100.00,T-9\n01/05/2026,PAYOUT FEE,-1.50,T-9\n");
expect("A CSV id that comes twice can't tell its lines apart: both are kept, by their own keys", [twice.lines.length, twice.lines.every(line => !line.external_id.startsWith("T-9"))], [2, true]);

// Airwallex's Balance Activity Report as its documentation lays it out (version 1.2): Amount is positive both ways, so
// money in and out come from Credit and Debit Net Amount (after the fee); Account Balance, not Available Balance;
// an authorisation hold, and the dollar side of a conversion, are left out of a euro account.
const AIRWALLEX = `Time,Type,Financial Transaction Type,Transaction Id,Description,Wallet Currency,Target Currency,Target Amount,Conversion Rate,Mature Date,Amount,Fee,Debit Net Amount,Credit Net Amount,Available Balance,Account Balance,Created At,Request Id,Reference,Note
2026-10-01T09:12:44+03:00,DEPOSIT,DEPOSIT,awx-1,Deposit from HARBOUR CAFE LTD,EUR,,,,,1190.00,0.00,,1190.00,6190.00,6190.00,2026-10-01T09:12:44+03:00,,INV-2026-0041,
2026-10-02T14:03:10+03:00,CARD,CARD_PURCHASE,awx-2,STATIONERY PLUS NICOSIA,EUR,,,,,25.40,0.00,25.40,,6164.60,6164.60,2026-10-02T14:03:10+03:00,,,
2026-10-02T18:40:00+03:00,CARD,ISSUING_AUTHORISATION_HOLD,awx-3,TAXI NICOSIA,EUR,,,,,30.00,0.00,30.00,,6134.60,6164.60,2026-10-02T18:40:00+03:00,,,
2026-10-03T10:00:00+03:00,CONVERSION,CONVERSION_SELL,awx-4,Conversion EUR to USD,EUR,USD,108.00,1.08,,100.00,0.00,100.00,,6034.60,6064.60,2026-10-03T10:00:00+03:00,,,
2026-10-03T10:00:00+03:00,CONVERSION,CONVERSION_BUY,awx-5,Conversion EUR to USD,USD,EUR,100.00,1.08,,108.00,0.00,,108.00,108.00,108.00,2026-10-03T10:00:00+03:00,,,
2026-10-05T11:20:00+03:00,PAYOUT,PAYOUT,awx-6,Payout to OFFICE RENT LTD,EUR,,,,,800.00,2.00,802.00,,5232.60,5262.60,2026-10-05T11:20:00+03:00,,October rent,
`;
const airwallex = parseStatementFile(AIRWALLEX, { currency: "EUR" });
expect("Airwallex: money in and out from its net columns, the hold and the dollars left out", amounts(airwallex), [1190, -25.4, -100, -802]);
expect("Airwallex: the account balance, not the available one", [airwallex.openingBalance, airwallex.closingBalance], [5000, 5262.6]);
expect("Airwallex: dated by Time, keyed by Transaction Id, with its reference", [airwallex.lines[0].date, airwallex.lines[3].external_id, airwallex.lines[3].reference], ["2026-10-01", "awx-6", "October rent"]);
expect("Airwallex: what was left out is said", airwallex.problems, ["1 line still pending, declined or on hold left out.", "1 line in USD left out: these books are kept in EUR."]);
const layout = detectCsvLayout(AIRWALLEX);
const unsigned = readCsv(AIRWALLEX, { ...layout, columns: { ...layout.columns, amount: layout.headers.indexOf("Amount"), debit: undefined, credit: undefined } }, { currency: "EUR" });
expect("Read with its unsigned Amount, the balances say money out looks like money in", unsigned.problems.some(problem => problem.includes("look the wrong way round")), true);
expect("Only the books' currency in a statement all in dollars", parseStatementFile(AIRWALLEX.split("\n").filter((line, index) => index === 0 || line.split(",")[5] === "USD").join("\n"), { currency: "EUR" }).problems,
  ["This statement is in USD, and these books are kept in EUR: none of it can be imported here."]);

// Other banks' headings.
const revolut = parseStatementFile(`Date started (UTC),Date completed (UTC),ID,Type,State,Description,Reference,Payer,Orig currency,Orig amount,Payment currency,Amount,Total amount,Fee,Balance
2026-10-01 08:00:00,2026-10-01 08:00:05,r-1,TRANSFER,COMPLETED,Payment from Harbour Cafe Ltd,INV-41,,EUR,1190.00,EUR,1190.00,1190.00,0.00,6190.00
2026-10-02 12:00:00,,r-2,CARD_PAYMENT,PENDING,Stationery Plus,,Dan,EUR,-25.40,EUR,-25.40,-25.40,0.00,
2026-10-02 13:00:00,2026-10-02 13:00:01,r-3,CARD_PAYMENT,DECLINED,Taxi,,Dan,EUR,-30.00,EUR,-30.00,-30.00,0.00,
2026-10-04 09:00:00,2026-10-04 09:00:02,r-4,TRANSFER,COMPLETED,To Office Rent Ltd,October rent,,EUR,-800.00,EUR,-800.00,-802.00,-2.00,5388.00
`, { currency: "EUR" });
expect("A State column: pending and declined payments left out, the total with its fee read", amounts(revolut), [1190, -802]);
expect("Date completed is the date; the file opens and closes on its balances", [revolut.lines[1].date, revolut.openingBalance, revolut.closingBalance], ["2026-10-04", 5000, 5388]);
const wise = parseStatementFile(`TransferWise ID,Date,Amount,Currency,Description,Payment Reference,Running Balance,Payer Name,Payee Name,Merchant
TRANSFER-1,01-10-2026,950.00,GBP,Received money from BRIGHT LANE BAKERY with reference WW-1043,WW-1043,1950.00,BRIGHT LANE BAKERY,,
TRANSFER-2,02-10-2026,-45.00,GBP,Card transaction of 45.00 GBP issued by Figma,,1905.00,,,Figma
TRANSFER-3,03-10-2026,-600.00,GBP,Sent money to Studio Rent Ltd,Rent,1305.00,,Studio Rent Ltd,
`, { currency: "GBP" });
expect("Wise: the payer for money in, the payee or merchant for money out", wise.lines.map(line => line.counterparty), ["BRIGHT LANE BAKERY", "Figma", "Studio Rent Ltd"]);
expect("Wise: its own id and the payer's reference", [wise.lines[0].external_id, wise.lines[0].reference], ["TRANSFER-1", "WW-1043"]);
const starling = parseStatementFile("Date,Counter Party,Reference,Type,Amount (GBP),Balance (GBP),Spending Category,Notes\n01/10/2026,Bright Lane Bakery,WW-1044,FASTER PAYMENT,120.00,1120.00,INCOME,\n02/10/2026,Figma,FIGMA,CARD,-45.00,1075.00,SOFTWARE,\n");
expect("Starling: a currency after a heading, and its Counter Party", [amounts(starling), starling.lines[0].counterparty, starling.openingBalance], [[120, -45], "Bright Lane Bakery", 1000]);
const lloyds = parseStatementFile("Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance\n01/10/2026,FPI,30-00-00,12345678,BRIGHT LANE BAKERY,,120.00,1120.00\n02/10/2026,DEB,30-00-00,12345678,FIGMA,45.00,,1075.00\n");
expect("Lloyds: Transaction Description, and Debit and Credit Amount", [amounts(lloyds), lloyds.lines[1].description], [[120, -45], "FIGMA"]);

// CAMT.053, one statement or several.
const camt = parseStatementFile(`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>CY17002001280000001200527600</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">380.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="EUR">120.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-05-04</Dt></BookgDt><AcctSvcrRef>B-1</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Office Rent Ltd</Nm></Cdtr></RltdPties><RmtInf><Ustrd>May rent</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">40.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-05-05</Dt></BookgDt><AcctSvcrRef>B-2</AcctSvcrRef></Ntry>
</Stmt></BkToCstmrStmt></Document>`);
expect("A CAMT.053 statement's opening (OPBD) and closing (CLBD) balances", [camt.openingBalance, camt.closingBalance], [500, 380]);
expect("A CAMT.053 line keeps the bank's own id; a pending one is left out", [camt.lines.map(line => line.external_id), camt.problems], [["B-1"], ["1 entry not booked yet left out."]]);
expect("A CAMT.053 statement says the account it is for", camt.account, "CY17002001280000001200527600");
const prcd = parseStatementFile(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">75.50</Amt><CdtDbtInd>DBIT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-05-04</Dt></BookgDt></Ntry></Stmt></BkToCstmrStmt></Document>`);
expect("A CAMT.053 statement opening on the previous closing (PRCD), overdrawn", prcd.openingBalance, -75.5);
const statement = (day: string, opening: number, closing: number, amount: number, currency = "EUR") => `<Stmt><Acct><Id><IBAN>CY17002001280000001200527600</IBAN></Id><Ccy>${currency}</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="${currency}">${opening}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="${currency}">${closing}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="${currency}">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>${day}</Dt></BookgDt><AcctSvcrRef>${currency}-${day}</AcctSvcrRef></Ntry></Stmt>`;
const days = parseStatementFile(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>${statement("2026-05-01", 1000, 1100, 100)}${statement("2026-05-01", 40, 90, 50, "USD")}${statement("2026-05-02", 1100, 1150, 50)}</BkToCstmrStmt></Document>`, { currency: "EUR" });
expect("A CAMT.053 file a day a statement opens on the first and closes on the last", [days.openingBalance, days.closingBalance, amounts(days)], [1000, 1150, [100, 50]]);
expect("A CAMT.053 statement for a dollar account is left out of a euro one", days.problems, ["1 line in USD left out: these books are kept in EUR."]);

// MT940: a statement a day, as Airwallex and many banks send them; booking dates across New Year; both kinds of :86:.
const mt940 = parseStatementFile(`{1:F01BANKCY2NAXXX0000000000}{2:I940BANKCY2NXXXXN}{4:
:20:STMT-20261231
:25:CY17002001280000001200527600
:28C:00365/001
:60F:C261230EUR1000,00
:61:2612311231C1190,00NTRFINV-0041//BOC778812
:86:/TRTP/SEPA CREDIT TRANSFER/NAME/HARBOUR CAFE LTD/REMI/USTD//INV-0041 coffee machine/EREF/E2E-41
:61:2612310102D25,40NCHGNONREF//BOC778813
:86:?00CARD PAYMENT?20STATIONERY PLUS?21NICOSIA?32STATIONERY PLUS LTD
:61:261231RC10,00NMSCNONREF
:86:Reversal of a card refund
:62F:C261231EUR2154,60
-}`, { currency: "EUR" });
expect("MT940: credit, debit, and a reversed credit as money out", amounts(mt940), [1190, -25.4, -10]);
expect("MT940: the booking date, in the next year when it crosses New Year", mt940.lines.map(line => line.date), ["2026-12-31", "2027-01-02", "2026-12-31"]);
expect("MT940: its opening and closing balances, and the account", [mt940.openingBalance, mt940.closingBalance, mt940.account], [1000, 2154.6, "CY17002001280000001200527600"]);
expect("MT940: SWIFT's /NAME/ and /REMI/, and ?32 and ?20 subfields", [mt940.lines[0].counterparty, mt940.lines[0].description, mt940.lines[1].counterparty, mt940.lines[1].description],
  ["HARBOUR CAFE LTD", "INV-0041 coffee machine", "STATIONERY PLUS LTD", "STATIONERY PLUS NICOSIA"]);
expect("MT940: the bank's reference keys a line; without one, the line's own key", [mt940.lines[0].external_id, mt940.lines[2].external_id.startsWith("2026-12-31|-10.00|reversal")], ["2026-12-31|1190.00|BOC778812", true]);

const ofx = parseStatementFile(`OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>12345678</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260601<TRNAMT>250.00<FITID>F1<NAME>M&amp;S Catering</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1250.00</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`, { currency: "EUR" });
expect("An OFX statement's closing balance, and no opening balance to give", [ofx.closingBalance, ofx.openingBalance], [1250, null]);
expect("OFX: entities decoded, and the account number", [ofx.lines[0].counterparty, ofx.account], ["M&S Catering", "12345678"]);
expect("OFX in another currency is left out", parseStatementFile("OFXHEADER:100\n<OFX><CURDEF>USD<STMTTRN><DTPOSTED>20260601<TRNAMT>5.00<FITID>X</STMTTRN></OFX>", { currency: "EUR" }).lines.length, 0);

// Which account a file is for.
expect("A statement for another IBAN is surely another account's", otherAccount("CY21002001950000357001234567", "CY17002001280000001200527600"), { account: "CY21002001950000357001234567", sure: true });
expect("This account's IBAN, however it is spaced", otherAccount("CY17 0020 0128 0000 0012 0052 7600", "CY17002001280000001200527600"), null);
expect("An account number inside this account's IBAN is this account", otherAccount("1200527600", "CY17002001280000001200527600"), null);
expect("An account number not in it is a doubt", otherAccount("BANKCODE/9988776655", "CY17002001280000001200527600"), { account: "BANKCODE/9988776655", sure: false });
expect("What kind of file a statement imported was, from its name", ["may.csv", "may.XML", "may.sta", "may.qfx", "may.txt"].map(formatFromName), ["csv", "camt", "mt940", "ofx", null]);

// Several statements, out of order as they were chosen: each against the one before it in date order.
const chain = statementChain([
  { key: "may", first: "2026-05-01", last: "2026-05-31", opening: 900, closing: 1000 },
  { key: "april", first: "2026-04-01", last: "2026-04-30", opening: 800, closing: 900 },
  { key: "july", first: "2026-07-02", last: "2026-07-31", opening: 1300, closing: 1400 },
], { last: "2026-03-31", closing: 800 }, money);
const tones = (notes: Map<string, { tone: string }[]>, key: string) => (notes.get(key) ?? []).map(note => note.tone).join(",");
expect("April follows on from the last statement imported", tones(chain, "april"), "positive");
expect("May follows on from April", tones(chain, "may"), "positive");
expect("July does not follow on: June is missing", tones(chain, "july"), "critical");
const overlap = statementChain([
  { key: "may", first: "2026-05-01", last: "2026-05-31", opening: 900, closing: 1000, format: "csv" },
  { key: "late-may", first: "2026-05-29", last: "2026-06-30", opening: 960, closing: 1100, format: "csv" },
], null, money);
expect("A statement overlapping the one before is noted, and not called a gap as well", tones(overlap, "late-may"), "caution");
const formats = statementChain([
  { key: "may", first: "2026-05-01", last: "2026-05-31", opening: 900, closing: 1000, format: "camt" },
  { key: "late-may", first: "2026-05-29", last: "2026-06-30", opening: 960, closing: 1100, format: "csv" },
], null, money);
expect("Overlapping files of different kinds would bring the shared days in twice", formats.get("late-may")?.[0]?.text.includes("would come in twice"), true);
const gap = statementChain([{ key: "march", first: "2026-03-02", last: "2026-03-30", opening: null, closing: null }, { key: "may", first: "2026-05-04", last: "2026-05-29", opening: null, closing: null }], null, money);
expect("Without balances, a month with nothing is a statement missing", tones(gap, "may"), "caution");
const history = statementChain([
  { key: "2025", first: "2025-01-01", last: "2025-01-31", opening: 5, closing: 6 },
  { key: "april", first: "2026-04-01", last: "2026-04-30", opening: 800, closing: 900 },
], { last: "2026-03-31", closing: 800 }, money);
expect("History older than what is imported follows on from nothing, and the next month still from the import", [tones(history, "2025"), tones(history, "april")], ["", "positive"]);
const inside = statementChain([
  { key: "october", first: "2026-10-01", last: "2026-10-31", opening: 1000, closing: 2000 },
  { key: "part", first: "2026-10-10", last: "2026-10-20", opening: 1400, closing: 1500 },
  { key: "november", first: "2026-11-01", last: "2026-11-30", opening: 2000, closing: 2100 },
], null, money);
expect("After a statement inside another, the next follows the one that ended last", [inside.get("part")?.[0]?.text.startsWith("Overlaps the statement before by 11 days"), tones(inside, "november")], [true, "positive"]);

// The VAT inside a payment, worked back from its total: net and VAT always add up to the payment.
const splits: [number, number, number, number][] = [[119, 19, 100, 19], [10, 19, 8.4, 1.6], [0.05, 19, 0.04, 0.01], [100, 20, 83.33, 16.67], [1, 5, 0.95, 0.05], [250, 0, 250, 0], [1234.56, 9, 1132.62, 101.94]];
for (const [gross, rate, net, vat] of splits) expect(`${gross} with VAT at ${rate}% is ${net} + ${vat}`, splitGross(gross, rate), { net, vat });
let bad = 0;
for (let cents = 1; cents <= 200_000; cents += 7) for (const rate of [19, 9, 5, 3, 20]) {
  const { net, vat } = splitGross(cents / 100, rate);
  if (Math.round(net * 100) + Math.round(vat * 100) !== cents || Math.abs(vat - net * rate / 100) > 0.01) bad += 1;
}
expect("Every amount to €2,000, at every rate: net and VAT add up to the payment, the VAT within a cent of its rate", bad, 0);

// Payers' names as customers.
expect("ACME TRADING LTD and Acme Trading Limited are one customer", nameKey("ACME TRADING LTD."), nameKey("Acme Trading Limited"));
expect("A Greek name without its accents and ΛΤΔ", nameKey("Κυπριακή Τράπεζα ΛΤΔ"), nameKey("ΚΥΠΡΙΑΚΗ ΤΡΑΠΕΖΑ"));
expect("The payer the bank names", payerName({ counterparty: "NICOSIA FINE FOODS LTD", description: "INV 102" }), "Nicosia Fine Foods Ltd");
const payers: [string, string][] = [
  ["SEPA CREDIT FROM HARBOUR CAFE", "Harbour Cafe"], ["TRANSFER FROM BLUE HORIZON SHIPPING LTD INV-2025-0118", "Blue Horizon Shipping Ltd"],
  ["TRANSFER FROM BLUE HORIZON SHIPPING LTD PART PAYMENT INV-2025-0140", "Blue Horizon Shipping Ltd"], ["FASTER PAYMENTS RECEIPT ACME LTD INV 1043", "Acme Ltd"],
  ["ACME LTD INV1043 BGC", "Acme Ltd"], ["Money added from ACME LTD", "Acme Ltd"], ["Deposit from ACME LTD", "Acme Ltd"], ["SEPA CT ACME LTD", "Acme Ltd"],
  ["TRANSFER FROM BANK STREET CAFE", "Bank Street Cafe"], ["INSTANT PRINT LTD", "Instant Print Ltd"], ["Received money from ACME LTD with reference INV-1043", "Acme Ltd"],
  ["ΜΕΤΑΦΟΡΑ ΑΠΟ ΑΝΔΡΕΑΣ ΓΕΩΡΓΙΟΥ", "ΑΝΔΡΕΑΣ ΓΕΩΡΓΙΟΥ"],
];
for (const [description, payer] of payers) expect(`The payer in '${description}'`, payerName({ counterparty: null, description }), payer);
expect("Names in capitals made readable, but not Greek, and not letters", ["ACME TRADING LTD", "KPMG", "JCC PAYMENT SYSTEMS LTD", "ΚΥΠΡΙΑΚΗ ΤΡΑΠΕΖΑ"].map(tidyName),
  ["Acme Trading Ltd", "KPMG", "JCC Payment Systems Ltd", "ΚΥΠΡΙΑΚΗ ΤΡΑΠΕΖΑ"]);
expect("A name in mixed case is left as it is", tidyName("McKenzie & Sons"), "McKenzie & Sons");
expect("An invoice says what the payer's reference says", paymentDescription({ counterparty: "Harbour Cafe", reference: "March retainer", description: "SEPA CREDIT" }), "March retainer");
expect("A description that is only the bank's words and the payer leaves it to the accountant", paymentDescription({ counterparty: null, reference: null, description: "TRANSFER FROM BLUE DOOR STUDIO LTD" }), "");
expect("An invoice number of the payer's is no description", paymentDescription({ counterparty: null, reference: "INV-0041", description: "SEPA CREDIT FROM MESA VERDE TAVERNA" }), "");
expect("What the description says beyond the payer's name", paymentDescription({ counterparty: "BLUE DOOR STUDIO LTD", reference: null, description: "BLUE DOOR STUDIO LTD WEBSITE HOSTING" }), "WEBSITE HOSTING");

// Money in that isn't a sale.
const notSale = (description: string, counterparty: string | null = null) => {
  const line = { description, reference: null, counterparty };
  return notASale(line, payerName(line), "Troodos Gold Ltd");
};
const others: [string, string | null, string][] = [
  ["CREDIT INTEREST", null, "interest"], ["ΠΙΣΤΩΤΙΚΟΣ ΤΟΚΟΣ", null, "interest"], ["LOAN DISBURSEMENT 4471", null, "a loan"], ["DIRECTOR LOAN", "Andreas Georgiou", "a loan"],
  ["VAT REFUND Q2", "Tax Department", "a refund"], ["SETTLEMENT 29/10", "JCC Payment Systems Ltd", "card or online takings"], ["ONLINE SHOP PAYOUT WEB SALES", null, "card or online takings"],
  ["DIVIDEND MESOGEIOS HOTELS LTD", null, "a dividend"], ["TRANSFER FROM SAVINGS ACCOUNT 357012345678", null, "own accounts"], ["ΚΑΤΑΘΕΣΗ ΜΕΤΡΗΤΩΝ", null, "a cash deposit"],
  ["TRANSFER FROM 357-01-123456-01", null, "not a customer"], ["TRANSFER FROM TROODOS GOLD LTD", null, "the company itself"],
];
for (const [description, counterparty, kind] of others) expect(`'${description}' isn't a sale: ${kind}`, notSale(description, counterparty)?.toLowerCase().includes(kind.toLowerCase()), true);
expect("A customer's payment is a sale", [notSale("SEPA CREDIT FROM HARBOUR CAFE"), notSale("TRANSFER FROM BLUE DOOR STUDIO LTD WEBSITE")], [null, null]);
expect("An invoice raised from a payment says so; one numbered like it by hand doesn't", [raisedFromPayment("Recorded on 30 Oct 2026 from the payment received on 25 Oct 2026."), raisedFromPayment("Thanks for your business."), raisedFromPayment(null)], [true, false, false]);

// After the second review: payer names in more banks' words, and real names that aren't the words they contain.
const morePayers: [string, string][] = [
  ["SEPA PAYMENT FROM ACME LTD", "Acme Ltd"], ["INWARD SEPA PAYMENT FROM BLUE DOOR LTD", "Blue Door Ltd"], ["SEPA CREDIT FROM SMART PAYMENT SOLUTIONS LTD", "Smart Payment Solutions Ltd"],
  ["TRANSFER FROM FIRST REFERENCE LABS LTD", "First Reference Labs Ltd"], ["Payment from Harbour Cafe Ltd", "Harbour Cafe Ltd"], ["STANDING ORDER FROM A GEORGIOU", "A Georgiou"],
  ["CREDIT FROM ACME LTD", "Acme Ltd"], ["BANK GIRO CREDIT REF ACME LTD", "Acme Ltd"], ["SEPA CREDIT FROM HARBOUR CAFE PAYMENT", "Harbour Cafe"],
];
for (const [description, payer] of morePayers) expect(`The payer in '${description}'`, payerName({ counterparty: null, description }), payer);
const sales: [string, string | null][] = [["GRANT THORNTON (CYPRUS) LTD INV 1043", null], ["FINAL SETTLEMENT INV 1043", "ACME TRADING LTD"], ["MERCHANT NAVY SUPPLIES LTD", null],
  ["STRIPE DESIGN STUDIO", null], ["SEPA CREDIT", "SQUARE MEAL LTD"], ["SAVINGS & CO ESTATE AGENTS", null], ["DIRECTOR FEES Q3 2026", "NORTHWIND HOLDINGS LTD"]];
for (const [description, counterparty] of sales) expect(`'${description}' is a customer's payment, not a non-sale`, notSale(description, counterparty), null);
expect("Stripe's own payouts are card takings", notSale("STRIPE PAYMENTS UK LTD")?.includes("card or online takings"), true);
expect("A director by initial and surname, or whole name; not a company of theirs", [fromPerson("A GEORGIOU", "Andreas Georgiou"), fromPerson("ANDREAS GEORGIOU", "Andreas Georgiou"), fromPerson("GEORGIOU HOLDINGS LTD", "Andreas Georgiou")], [true, true, false]);
expect("John Smith Ltd is a company, John Smith isn't", [namedAsCompany("John Smith Ltd"), namedAsCompany("John Smith")], [true, false]);
expect("A bank's own code in the reference is no description", ["FT26302ABCD", "BOC/26/778812/OUT"].map(reference => paymentDescription({ counterparty: "Acme Ltd", reference, description: "SEPA CREDIT" })), ["", ""]);

// CSVs that misled the readers.
const excel = (month: string) => parseStatementFile(`Date,Description,Amount,Transaction ID\n01/${month}/2026,RENT FROM TENANT,800.00,2.05901E+20\n02/${month}/2026,SALE,100.00,2.05901E+20\n`);
expect("Excel's shortened ids don't key lines: October's and November's keep apart", excel("10").lines.map(line => line.external_id).some(id => excel("11").lines.some(other => other.external_id === id)), false);
expect("A CSV in euros by its headings alone, into books in pounds, is left out", parseStatementFile("Date,Counter Party,Reference,Type,Amount (EUR),Balance (EUR)\n01/10/2026,Atelier Nova,R-1,CREDIT,1000.00,6000.00\n", { currency: "GBP" }).problems,
  ["This statement is in EUR, and these books are kept in GBP: none of it can be imported here."]);
const untold = parseStatementFile("Date,Description,Amount,Balance\n01/10/2026,SALE,100.00,1100.00\n02/10/2026,,-35.00,1065.00\n03/10/2026,FEE,-5.00,1060.00\n");
expect("A line with no words is kept, as a bank transaction", [untold.lines.length, untold.lines[1].description, untold.problems], [3, "Bank transaction", []]);
expect("A negative under Money in is money out", amounts(parseStatementFile("Date,Description,Debit,Credit,Balance\n01/10/2026,SALE,,200.00,1200.00\n02/10/2026,SALE RETURNED,,-100.00,1100.00\n")), [200, -100]);
expect("DR and CR written onto the amount, and a currency after it", [parseAmount("12.50DR"), parseAmount("100.00CR"), parseAmount("12.50 GBP"), parseAmount("EUR 7.00")], [-12.5, 100, 12.5, 7]);
const mixed = parseStatementFile("Date,Description,Amount,Balance\n03/10/2026,SALE,200.00,1320.00\n03/10/2026,FEE,-5.00,1315.00\n02/10/2026,SALE,50.00,1130.00\n02/10/2026,FEE,-10.00,1120.00\n01/10/2026,SALE,100.00,1100.00\n01/10/2026,FEE,-20.00,1080.00\n");
expect("Days newest first, each day's lines oldest first: it opens and closes where the balances say", [mixed.openingBalance, mixed.closingBalance], [1000, 1315]);
const gapped = parseStatementFile("Date,Description,Amount,Balance\n01/10/2026,SALE,100.00,1100.00\n02/10/2026,SALE,abc,1150.00\n03/10/2026,FEE,-20.00,1130.00\n");
expect("Lines that don't add up to the balances say so", gapped.problems.some(problem => problem.includes("a line may be missing or read wrong")), true);

// Statement files with more than one account, or in an order of their own.
const block = (iban: string, day: string, opening: number, closing: number, amount: number, from = `${day}T00:00:00`) => `<Stmt><FrToDt><FrDtTm>${from}</FrDtTm></FrToDt><Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${opening}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${closing}</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>${day}</Dt></BookgDt><AcctSvcrRef>${iban.slice(-4)}-${day}</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>M&#252;ller &amp; Co</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt>`;
const camtFile = (blocks: string) => `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>${blocks}</BkToCstmrStmt></Document>`;
const THIS = "CY17002001280000001200527600", OTHER = "CY21002001950000357001234567";
const backwards = parseStatementFile(camtFile(block(THIS, "2026-05-02", 1100, 1150, 50) + block(THIS, "2026-05-01", 1000, 1100, 100)), { currency: "EUR", iban: THIS });
expect("CAMT.053 statements listed newest first open on the earliest and close on the latest", [backwards.openingBalance, backwards.closingBalance], [1000, 1150]);
expect("CAMT.053: numeric entities decoded", backwards.lines[0].description, "Müller & Co");
for (const [what, blocks] of [["this account's first", block(THIS, "2026-05-01", 1000, 1100, 100) + block(OTHER, "2026-05-01", 50000, 70000, 20000)], ["the other account's first", block(OTHER, "2026-05-01", 50000, 70000, 20000) + block(THIS, "2026-05-01", 1000, 1100, 100)]] as const) {
  const both = parseStatementFile(camtFile(blocks), { currency: "EUR", iban: THIS });
  expect(`A CAMT.053 file with two accounts' statements, ${what}: this one's lines, the other's left out`, [amounts(both), both.openingBalance, both.closingBalance, both.problems], [[100], 1000, 1100, ["1 line for another account in the same file left out."]]);
}
const mtTwo = parseStatementFile(`:20:A\n:25:${THIS}EUR\n:28C:1/1\n:60F:C261001EUR1000,00\n:61:2610011001C100,00NTRFNONREF//R1\n:86:Sale\n:62F:C261001EUR1100,00\n-\n:20:B\n:25:${OTHER}\n:28C:1/1\n:60F:C261001EUR50000,00\n:61:2610011001C20000,00NTRFNONREF//R2\n:86:Other\n:62F:C261001EUR70000,00\n-`, { currency: "EUR", iban: THIS });
expect("MT940: an IBAN with its currency after it is this account's; another account's statement is left out", [amounts(mtTwo), mtTwo.account, mtTwo.problems], [[100], THIS, ["1 line for another account in the same file left out."]]);
expect("MT940 for a day with nothing on it is still MT940", parseStatementFile(":20:A\n:25:CY17002001280000001200527600\n:28C:1/1\n:60F:C261001EUR1000,00\n:62F:C261001EUR1000,00\n-").format, "mt940");
const ofxTwo = parseStatementFile(`OFXHEADER:100
<OFX><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>1200527600</BANKACCTFROM><BANKTRANLIST><DTEND>20261031
<STMTTRN><DTPOSTED>20261005<TRNAMT>-12,50<FITID>E1<NAME>Stationery</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>987.50<DTASOF>20261031</LEDGERBAL></STMTRS>
<STMTRS><CURDEF>USD<BANKACCTFROM><ACCTID>9988776655</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20261005<TRNAMT>20000.00<FITID>U1<NAME>Big</STMTTRN></BANKTRANLIST></STMTRS></OFX>`, { currency: "EUR", iban: THIS });
expect("OFX: each account's statement on its own, a decimal comma read, the dollar one left out", [amounts(ofxTwo), ofxTwo.closingBalance, ofxTwo.problems], [[-12.5], 987.5, ["1 line in USD left out: these books are kept in EUR."]]);
expect("OFX: a balance as of after the statement's end isn't its closing", parseStatementFile("OFXHEADER:100\n<OFX><STMTRS><CURDEF>EUR<BANKTRANLIST><DTEND>20260930<STMTTRN><DTPOSTED>20260920<TRNAMT>5.00<FITID>X</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>50.00<DTASOF>20261015</LEDGERBAL></STMTRS></OFX>").closingBalance, null);
const pieces = parseStatementFile(":20:A\n:25:CY17002001280000001200527600\n:28C:1/1\n:60F:C261001EUR1000,00\n:61:2610011001C10,00NTRFNONREF\n:86:?00CREDIT?20PAYMENT FOR THE COFFEE MACH?21INE SERVICE?32ACME LTD\n:62F:C261001EUR1010,00\n-");
expect("MT940: a remittance cut into pieces of 27 is joined as it was cut", pieces.lines[0].description, "PAYMENT FOR THE COFFEE MACHINE SERVICE");
expect("An IBAN with its currency after it", [ibanOf(`${THIS}EUR`), ibanOf("CY17 0020 0128 0000 0012 0052 7600"), ibanOf("1200527600")], [THIS, THIS, null]);

const failed = checks.filter(([, got, wanted]) => JSON.stringify(got) !== JSON.stringify(wanted));
for (const [what, got, wanted] of checks) console.log(`  ${failed.some(([name]) => name === what) ? "FAIL" : "ok  "}  ${what}${failed.some(([name]) => name === what) ? `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}` : ""}`);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed.`);
if (failed.length) process.exit(1);
