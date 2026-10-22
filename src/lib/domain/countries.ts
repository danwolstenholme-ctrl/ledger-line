/** Countries a Cyprus company invoices most, and which of them are in the EU. Client-safe. */
export const COUNTRIES = [
  ["CY", "Cyprus"], ["GR", "Greece"], ["DE", "Germany"], ["NL", "Netherlands"], ["FR", "France"], ["IT", "Italy"], ["AT", "Austria"], ["BE", "Belgium"],
  ["IE", "Ireland"], ["ES", "Spain"], ["PT", "Portugal"], ["SE", "Sweden"], ["DK", "Denmark"], ["FI", "Finland"], ["PL", "Poland"], ["MT", "Malta"],
  ["BG", "Bulgaria"], ["RO", "Romania"], ["HU", "Hungary"], ["CZ", "Czechia"], ["SK", "Slovakia"], ["SI", "Slovenia"], ["HR", "Croatia"], ["EE", "Estonia"],
  ["LV", "Latvia"], ["LT", "Lithuania"], ["LU", "Luxembourg"], ["GB", "United Kingdom"], ["US", "United States"], ["IL", "Israel"], ["AE", "United Arab Emirates"],
  ["LB", "Lebanon"], ["CH", "Switzerland"], ["NO", "Norway"],
] as const;

export const EU_COUNTRIES = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

export function countryName(code: string | null | undefined) {
  return COUNTRIES.find(([key]) => key === code)?.[1] ?? code ?? "";
}
