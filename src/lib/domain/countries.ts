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

/** For people: nationality and where they live. The invoicing list, and more, including every EU high-risk third country. */
export const PERSON_COUNTRIES: readonly (readonly [string, string])[] = [
  ...COUNTRIES,
  ...[["AF", "Afghanistan"], ["DZ", "Algeria"], ["AO", "Angola"], ["AM", "Armenia"], ["AU", "Australia"], ["BY", "Belarus"], ["BO", "Bolivia"], ["BR", "Brazil"],
  ["VG", "British Virgin Islands"], ["CM", "Cameroon"], ["CA", "Canada"], ["CN", "China"], ["CI", "Côte d’Ivoire"], ["CD", "Democratic Republic of the Congo"],
  ["EG", "Egypt"], ["GE", "Georgia"], ["HT", "Haiti"], ["IS", "Iceland"], ["IN", "India"], ["IR", "Iran"], ["JO", "Jordan"], ["KZ", "Kazakhstan"], ["KE", "Kenya"],
  ["LA", "Laos"], ["LI", "Liechtenstein"], ["MC", "Monaco"], ["MM", "Myanmar"], ["NA", "Namibia"], ["NP", "Nepal"], ["KP", "North Korea"], ["PK", "Pakistan"],
  ["PH", "Philippines"], ["RU", "Russia"], ["RS", "Serbia"], ["SC", "Seychelles"], ["ZA", "South Africa"], ["SS", "South Sudan"], ["LK", "Sri Lanka"], ["SY", "Syria"],
  ["TT", "Trinidad and Tobago"], ["TR", "Türkiye"], ["UA", "Ukraine"], ["VU", "Vanuatu"], ["VE", "Venezuela"], ["VN", "Vietnam"], ["YE", "Yemen"],
  ] as [string, string][],
].sort((a, b) => a[0] === "CY" ? -1 : b[0] === "CY" ? 1 : a[1].localeCompare(b[1]));

export const personCountry = (code: string | null | undefined) => PERSON_COUNTRIES.find(([key]) => key === code)?.[1] ?? code ?? "";
