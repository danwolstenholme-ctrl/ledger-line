/**
 * The chart of accounts a Cyprus company starts with: the balance sheet, other
 * income and the everyday expenses of a Cyprus company. A company adds its
 * own sales and cost of sales accounts. Client-safe.
 */
export type ChartAccount = { code: string; name: string; type: string; role?: string; description?: string; outsideVat?: boolean };

export const STANDARD_CHART: ChartAccount[] = [
  { code: "610", name: "Accounts receivable", type: "current_asset", role: "receivable", description: "What customers owe on issued invoices" },
  { code: "620", name: "Prepayments", type: "current_asset" },
  { code: "630", name: "Stock", type: "current_asset" },
  { code: "720", name: "Computer equipment", type: "fixed_asset" },
  { code: "730", name: "Motor vehicles", type: "fixed_asset" },
  { code: "740", name: "Plant, machinery and fittings", type: "fixed_asset" },
  { code: "800", name: "Accounts payable", type: "current_liability", role: "payable", description: "What the company owes on unpaid bills" },
  { code: "820", name: "VAT", type: "current_liability", role: "vat", description: "VAT on sales less VAT on purchases" },
  { code: "825", name: "Social insurance and GESY payable", type: "current_liability", outsideVat: true },
  { code: "826", name: "Income tax withheld (PAYE) payable", type: "current_liability", outsideVat: true },
  { code: "835", name: "Net salaries payable", type: "current_liability", outsideVat: true },
  { code: "830", name: "Accruals", type: "current_liability" },
  { code: "840", name: "Corporation tax payable", type: "current_liability" },
  { code: "850", name: "Directors' current account", type: "current_liability" },
  { code: "900", name: "Bank loan", type: "non_current_liability" },
  { code: "950", name: "Share capital", type: "equity" },
  { code: "960", name: "Retained earnings", type: "equity", role: "retained_earnings", description: "Profit kept from earlier years" },
  { code: "260", name: "Other income", type: "other_income" },
  { code: "270", name: "Interest income", type: "other_income" },
  { code: "400", name: "Advertising and marketing", type: "expense" },
  { code: "404", name: "Bank charges", type: "expense" },
  { code: "408", name: "Cleaning", type: "expense" },
  { code: "412", name: "Accounting and audit fees", type: "expense" },
  { code: "416", name: "Depreciation", type: "depreciation" },
  { code: "420", name: "Entertainment and meals", type: "expense" },
  { code: "425", name: "Postage and courier", type: "expense" },
  { code: "429", name: "General expenses", type: "expense" },
  { code: "433", name: "Insurance", type: "expense" },
  { code: "437", name: "Interest paid", type: "expense" },
  { code: "441", name: "Licences, levies and subscriptions", type: "expense" },
  { code: "445", name: "Electricity and water", type: "expense" },
  { code: "449", name: "Motor vehicle running costs and fuel", type: "expense" },
  { code: "453", name: "Office expenses and stationery", type: "expense" },
  { code: "469", name: "Rent", type: "expense" },
  { code: "473", name: "Repairs and maintenance", type: "expense" },
  { code: "477", name: "Salaries and wages", type: "expense", outsideVat: true },
  { code: "478", name: "Social insurance, GESY and employer funds", type: "expense", outsideVat: true },
  { code: "485", name: "Software and IT", type: "expense" },
  { code: "489", name: "Telephone and internet", type: "expense" },
  { code: "493", name: "Travel", type: "expense" },
];

/**
 * A UK company's: the same codes and roles, so every report and posting works the same, with UK names and the
 * accounts a UK company needs (PAYE and NIC, Corporation Tax, a directors' loan account, the flat rate's
 * surplus). Wages, PAYE and NIC, pensions, business rates, dividends and Corporation Tax are never on a VAT return.
 */
export const UK_CHART: ChartAccount[] = [
  { code: "610", name: "Trade debtors", type: "current_asset", role: "receivable", description: "What customers owe on issued invoices" },
  { code: "620", name: "Prepayments", type: "current_asset" },
  { code: "630", name: "Stock", type: "current_asset" },
  { code: "720", name: "Computer equipment", type: "fixed_asset" },
  { code: "730", name: "Motor vehicles", type: "fixed_asset" },
  { code: "740", name: "Plant, machinery and tools", type: "fixed_asset" },
  { code: "800", name: "Trade creditors", type: "current_liability", role: "payable", description: "What the company owes on unpaid bills" },
  { code: "820", name: "VAT", type: "current_liability", role: "vat", description: "VAT on sales less VAT reclaimed: what HMRC is owed" },
  { code: "825", name: "PAYE and NIC payable", type: "current_liability", outsideVat: true },
  { code: "826", name: "Pension contributions payable", type: "current_liability", outsideVat: true },
  { code: "830", name: "Accruals", type: "current_liability" },
  { code: "840", name: "Corporation Tax payable", type: "current_liability", outsideVat: true },
  { code: "850", name: "Directors' loan account", type: "current_liability", outsideVat: true },
  { code: "900", name: "Bank loan", type: "non_current_liability" },
  { code: "950", name: "Share capital", type: "equity" },
  { code: "960", name: "Retained earnings", type: "equity", role: "retained_earnings", description: "Profit kept from earlier years" },
  { code: "970", name: "Dividends", type: "equity", outsideVat: true },
  { code: "260", name: "Other income", type: "other_income" },
  { code: "265", name: "Flat Rate Scheme surplus", type: "other_income", description: "VAT charged to customers less the flat rate paid to HMRC" },
  { code: "270", name: "Bank interest received", type: "other_income" },
  { code: "400", name: "Advertising and marketing", type: "expense" },
  { code: "404", name: "Bank charges", type: "expense" },
  { code: "408", name: "Cleaning", type: "expense" },
  { code: "412", name: "Accountancy fees", type: "expense" },
  { code: "416", name: "Depreciation", type: "depreciation" },
  { code: "420", name: "Entertainment", type: "expense", description: "Business entertainment: its VAT is not reclaimable" },
  { code: "425", name: "Postage and courier", type: "expense" },
  { code: "429", name: "General expenses", type: "expense" },
  { code: "433", name: "Insurance", type: "expense", description: "Insurance is exempt from VAT" },
  { code: "437", name: "Interest paid", type: "expense" },
  { code: "441", name: "Subscriptions", type: "expense" },
  { code: "443", name: "Business rates", type: "expense", outsideVat: true },
  { code: "445", name: "Light, heat and power", type: "expense" },
  { code: "449", name: "Motor expenses and fuel", type: "expense" },
  { code: "453", name: "Printing and stationery", type: "expense" },
  { code: "469", name: "Rent", type: "expense" },
  { code: "473", name: "Repairs and maintenance", type: "expense" },
  { code: "477", name: "Wages and salaries", type: "expense", outsideVat: true },
  { code: "478", name: "Employer's National Insurance", type: "expense", outsideVat: true },
  { code: "479", name: "Pension costs", type: "expense", outsideVat: true },
  { code: "485", name: "Software and IT", type: "expense" },
  { code: "489", name: "Telephone and internet", type: "expense" },
  { code: "493", name: "Travel and subsistence", type: "expense" },
];

/** The chart a company starts with, for its country. */
export const chartFor = (country: string | null | undefined) => country === "GB" ? UK_CHART : STANDARD_CHART;

/** What a company opened from onboarding adds: a bank account to start with, and sales. */
export const OPENING_ACCOUNTS: ChartAccount[] = [
  { code: "090", name: "Bank account", type: "bank" },
  { code: "200", name: "Sales", type: "revenue", role: "sales", description: "Sales of goods and services" },
];
