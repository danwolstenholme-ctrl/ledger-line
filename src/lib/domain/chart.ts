/**
 * The chart of accounts every company starts with: the balance sheet, other
 * income and the everyday expenses of a Cyprus company. A company adds its
 * own sales and cost of sales accounts. Client-safe.
 */
export type ChartAccount = { code: string; name: string; type: string; role?: string; description?: string };

export const STANDARD_CHART: ChartAccount[] = [
  { code: "610", name: "Accounts receivable", type: "current_asset", role: "receivable", description: "What customers owe on issued invoices" },
  { code: "620", name: "Prepayments", type: "current_asset" },
  { code: "630", name: "Stock", type: "current_asset" },
  { code: "720", name: "Computer equipment", type: "fixed_asset" },
  { code: "730", name: "Motor vehicles", type: "fixed_asset" },
  { code: "740", name: "Plant, machinery and fittings", type: "fixed_asset" },
  { code: "800", name: "Accounts payable", type: "current_liability", role: "payable", description: "What the company owes on unpaid bills" },
  { code: "820", name: "VAT", type: "current_liability", role: "vat", description: "VAT on sales less VAT on purchases" },
  { code: "825", name: "Social insurance and GESY payable", type: "current_liability" },
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
  { code: "477", name: "Salaries and wages", type: "expense" },
  { code: "478", name: "Social insurance, GESY and employer funds", type: "expense" },
  { code: "485", name: "Software and IT", type: "expense" },
  { code: "489", name: "Telephone and internet", type: "expense" },
  { code: "493", name: "Travel", type: "expense" },
];

/** What a company opened from onboarding adds: a bank account to start with, and sales. */
export const OPENING_ACCOUNTS: ChartAccount[] = [
  { code: "090", name: "Bank account", type: "bank" },
  { code: "200", name: "Sales", type: "revenue", role: "sales", description: "Sales of goods and services" },
];
