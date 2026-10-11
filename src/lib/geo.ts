// Pays → régions du monde, sans géolocalisation plus fine que le pays (décision de
// produit : pays et région seulement, jamais la ville). La région se déduit du code
// pays par ce tableau ; le filtre « région » de l'admin est résolu ici en liste de pays
// et transmis tel quel aux fonctions SQL (p_countries).
//
// Découpage : continents et sous-régions de la nomenclature M49 des Nations unies,
// plus deux regroupements qui comptent pour Vynl : l'Union européenne (27 États) et la
// Suisse. Un pays hors tableau (ex. un code que le fournisseur invente) tombe dans
// « Unknown » plutôt que d'être classé au hasard.

type Continent = "Africa" | "Americas" | "Asia" | "Europe" | "Oceania" | "Antarctica";

// Une ligne par sous-région : [continent, sous-région, codes ISO 3166-1 alpha-2].
const SUBREGIONS: [Continent, string, string][] = [
  ["Africa", "Northern Africa", "DZ EG EH LY MA SD TN"],
  ["Africa", "Eastern Africa", "BI DJ ER ET IO KE KM MG MU MW MZ RE RW SC SO SS TF TZ UG YT ZM ZW"],
  ["Africa", "Middle Africa", "AO CD CF CG CM GA GQ ST TD"],
  ["Africa", "Southern Africa", "BW LS NA SZ ZA"],
  ["Africa", "Western Africa", "BF BJ CI CV GH GM GN GW LR ML MR NE NG SH SL SN TG"],
  [
    "Americas",
    "Caribbean",
    "AG AI AW BB BL BQ BS CU CW DM DO GD GP HT JM KN KY LC MF MQ MS PR SX TC TT VC VG VI",
  ],
  ["Americas", "Central America", "BZ CR GT HN MX NI PA SV"],
  ["Americas", "South America", "AR BO BR BV CL CO EC FK GF GS GY PE PY SR UY VE"],
  ["Americas", "Northern America", "BM CA GL PM US"],
  ["Asia", "Central Asia", "KG KZ TJ TM UZ"],
  ["Asia", "Eastern Asia", "CN HK JP KP KR MN MO TW"],
  ["Asia", "South-eastern Asia", "BN ID KH LA MM MY PH SG TH TL VN"],
  ["Asia", "Southern Asia", "AF BD BT IN IR LK MV NP PK"],
  ["Asia", "Western Asia", "AE AM AZ BH CY GE IL IQ JO KW LB OM PS QA SA SY TR YE"],
  ["Europe", "Eastern Europe", "BG BY CZ HU MD PL RO RU SK UA"],
  ["Europe", "Northern Europe", "AX DK EE FI FO GB GG IE IM IS JE LT LV NO SE SJ"],
  ["Europe", "Southern Europe", "AD AL BA ES GI GR HR IT ME MK MT PT RS SI SM VA XK"],
  ["Europe", "Western Europe", "AT BE CH DE FR LI LU MC NL"],
  ["Oceania", "Australia and New Zealand", "AU CC CX HM NF NZ"],
  ["Oceania", "Melanesia", "FJ NC PG SB VU"],
  ["Oceania", "Micronesia", "FM GU KI MH MP NR PW UM"],
  ["Oceania", "Polynesia", "AS CK NU PF PN TK TO TV WF WS"],
  ["Antarctica", "Antarctica", "AQ"],
];

// Union européenne, 27 États membres.
const EU_MEMBERS =
  "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split(" ");

interface CountryInfo {
  continent: Continent;
  subregion: string;
}

const COUNTRIES = new Map<string, CountryInfo>();
for (const [continent, subregion, codes] of SUBREGIONS) {
  for (const code of codes.split(" ")) COUNTRIES.set(code, { continent, subregion });
}

export const EU_COUNTRIES: readonly string[] = EU_MEMBERS;
export const ALL_COUNTRY_CODES: readonly string[] = [...COUNTRIES.keys()];

const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

// « CH » → « Switzerland ». « unknown » (pays non déterminé) et tout code inconnu restent lisibles.
export function countryName(code: string): string {
  if (code === "unknown") return "Unknown";
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function regionOf(code: string): { continent: string; subregion: string } {
  return COUNTRIES.get(code) ?? { continent: "Unknown", subregion: "Unknown" };
}

export function isEuMember(code: string): boolean {
  return EU_MEMBERS.includes(code);
}

// --- Filtre « région » de l'admin ---

export interface RegionOption {
  id: string;
  label: string;
  group: "Markets" | "Continents" | "Subregions";
}

const CONTINENT_IDS: [string, Continent][] = [
  ["africa", "Africa"],
  ["americas", "Americas"],
  ["asia", "Asia"],
  ["europe", "Europe"],
  ["oceania", "Oceania"],
];

const slug = (value: string) => value.toLowerCase().replace(/[^a-z]+/g, "-");

export const REGION_OPTIONS: RegionOption[] = [
  { id: "eu", label: "European Union", group: "Markets" },
  { id: "ch", label: "Switzerland", group: "Markets" },
  ...CONTINENT_IDS.map(([id, label]): RegionOption => ({ id, label, group: "Continents" })),
  ...SUBREGIONS.filter(([continent]) => continent !== "Antarctica").map(
    ([, subregion]): RegionOption => ({ id: slug(subregion), label: subregion, group: "Subregions" })
  ),
];

// Les pays d'une région, ou null si l'identifiant est inconnu (ou « toutes les régions »).
export function countriesInRegion(id: string): string[] | null {
  if (id === "eu") return [...EU_MEMBERS];
  if (id === "ch") return ["CH"];

  const continent = CONTINENT_IDS.find(([continentId]) => continentId === id);
  if (continent) return ALL_COUNTRY_CODES.filter((code) => COUNTRIES.get(code)?.continent === continent[1]);

  const sub = SUBREGIONS.find(([, subregion]) => slug(subregion) === id);
  if (sub) return ALL_COUNTRY_CODES.filter((code) => COUNTRIES.get(code)?.subregion === sub[1]);

  return null;
}

export function regionLabel(id: string): string | null {
  return REGION_OPTIONS.find((option) => option.id === id)?.label ?? null;
}
