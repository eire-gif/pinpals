/**
 * Countries and their administrative regions, for the Courses directory and
 * for every "where are you" field on the site.
 *
 * ============ Why five countries ============
 *
 * Northern Ireland is listed separately from Ireland. This cuts against how
 * the sport is organised on this island — Golf Ireland governs all 32
 * counties, and a Royal Portrush member and a Lahinch member hold the same
 * membership — and it means the Ireland page covers 26 counties where the
 * old all-island club list covered 32. It is still the right call for a
 * directory that offers "the UK, by country": a golfer in Belfast who opens
 * the Courses menu and finds no Northern Ireland has been failed worse than
 * one who finds it listed apart from Ireland. The two pages cross-link.
 *
 * Ireland is first rather than alphabetical — it is where the site's members
 * are today — and the four UK countries follow.
 *
 * ============ Why the region vocabularies differ ============
 *
 * There is no single administrative unit shared across these five countries,
 * so each gets the one people actually use for an address:
 *
 *   Ireland          26 traditional counties (the Republic's)
 *   Northern Ireland  6 traditional counties, spelled as the site has always
 *                     spelled them (see the note on Derry below)
 *   England          48 ceremonial counties — not the 300-odd local
 *                     authorities, which nobody gives as their location
 *   Scotland         32 council areas — Scotland has no current county
 *                     tier, and council areas are what postal addresses use
 *   Wales            22 principal areas
 *
 * A region is therefore only meaningful alongside its country: "Down" and
 * "Durham" are both valid, in different lists. Nothing should offer a flat
 * region dropdown — always pick the country first, then narrow.
 */

export const COUNTRIES = [
  { code: "ireland", name: "Ireland" },
  { code: "northern-ireland", name: "Northern Ireland" },
  { code: "england", name: "England" },
  { code: "scotland", name: "Scotland" },
  { code: "wales", name: "Wales" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code) as readonly CountryCode[];

const IRELAND_REGIONS = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry",
  "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth",
  "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
] as const;

// "Derry" rather than "Londonderry" or "Derry/Londonderry": it is the
// spelling this site has used since its first migration, six existing
// members' profiles and every seeded club were entered against it, and
// changing it now would be a data migration in service of nothing.
const NORTHERN_IRELAND_REGIONS = [
  "Antrim", "Armagh", "Derry", "Down", "Fermanagh", "Tyrone",
] as const;

const ENGLAND_REGIONS = [
  "Bedfordshire", "Berkshire", "Bristol", "Buckinghamshire", "Cambridgeshire",
  "Cheshire", "City of London", "Cornwall", "Cumbria", "Derbyshire", "Devon",
  "Dorset", "Durham", "East Riding of Yorkshire", "East Sussex", "Essex",
  "Gloucestershire", "Greater London", "Greater Manchester", "Hampshire",
  "Herefordshire", "Hertfordshire", "Isle of Wight", "Kent", "Lancashire",
  "Leicestershire", "Lincolnshire", "Merseyside", "Norfolk", "North Yorkshire",
  "Northamptonshire", "Northumberland", "Nottinghamshire", "Oxfordshire",
  "Rutland", "Shropshire", "Somerset", "South Yorkshire", "Staffordshire",
  "Suffolk", "Surrey", "Tyne and Wear", "Warwickshire", "West Midlands",
  "West Sussex", "West Yorkshire", "Wiltshire", "Worcestershire",
] as const;

const SCOTLAND_REGIONS = [
  "Aberdeen City", "Aberdeenshire", "Angus", "Argyll and Bute",
  "City of Edinburgh", "Clackmannanshire", "Dumfries and Galloway",
  "Dundee City", "East Ayrshire", "East Dunbartonshire", "East Lothian",
  "East Renfrewshire", "Falkirk", "Fife", "Glasgow City", "Highland",
  "Inverclyde", "Midlothian", "Moray", "Na h-Eileanan Siar", "North Ayrshire",
  "North Lanarkshire", "Orkney Islands", "Perth and Kinross", "Renfrewshire",
  "Scottish Borders", "Shetland Islands", "South Ayrshire", "South Lanarkshire",
  "Stirling", "West Dunbartonshire", "West Lothian",
] as const;

const WALES_REGIONS = [
  "Blaenau Gwent", "Bridgend", "Caerphilly", "Cardiff", "Carmarthenshire",
  "Ceredigion", "Conwy", "Denbighshire", "Flintshire", "Gwynedd",
  "Isle of Anglesey", "Merthyr Tydfil", "Monmouthshire", "Neath Port Talbot",
  "Newport", "Pembrokeshire", "Powys", "Rhondda Cynon Taf", "Swansea",
  "Torfaen", "Vale of Glamorgan", "Wrexham",
] as const;

export const REGIONS_BY_COUNTRY: Record<CountryCode, readonly string[]> = {
  ireland: IRELAND_REGIONS,
  "northern-ireland": NORTHERN_IRELAND_REGIONS,
  england: ENGLAND_REGIONS,
  scotland: SCOTLAND_REGIONS,
  wales: WALES_REGIONS,
};

/**
 * Every region name across all five countries, de-duplicated and sorted.
 *
 * For validating a value whose country isn't known — a legacy `county` saved
 * before countries existed, or a query string a user typed. Don't render it
 * as a flat dropdown: 174 mixed-vocabulary options with no country headings
 * is not a usable control. Use REGION_GROUPS (and the RegionSelect component
 * built on it) when a select has to cover every country.
 */
export const ALL_REGIONS: readonly string[] = Array.from(
  new Set(COUNTRY_CODES.flatMap((code) => [...REGIONS_BY_COUNTRY[code]]))
).sort((a, b) => a.localeCompare(b));

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && (COUNTRY_CODES as readonly string[]).includes(value);
}

export function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

export function regionsForCountry(code: string): readonly string[] {
  return isCountryCode(code) ? REGIONS_BY_COUNTRY[code] : [];
}

/**
 * Whether a region belongs to a country. Used when validating a submitted
 * country/region pair — the two arrive as independent form fields, so a
 * mismatched pair ("scotland" + "Kerry") has to be caught server-side even
 * though the UI can't produce one.
 */
export function isRegionInCountry(country: string, region: string): boolean {
  return regionsForCountry(country).includes(region);
}

/**
 * The country a region name belongs to, or null if it's ambiguous or unknown.
 *
 * Every region name across the five lists happens to be unique today, which
 * is what makes this possible at all — it's how a legacy `county` value with
 * no country beside it gets one. It returns null rather than guessing if
 * that ever stops being true.
 */
export function countryForRegion(region: string): CountryCode | null {
  const matches = COUNTRY_CODES.filter((code) => REGIONS_BY_COUNTRY[code].includes(region));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Regions grouped by country, for a single select that still has to cover
 * everywhere.
 *
 * Not every "where are you" field on the site can afford a country dropdown
 * beside it — the marketplace filter bar and the tee-time browse filters are
 * single controls in a crowded row. Rendering the regions as `<optgroup>`s
 * gives those one control the whole five-country vocabulary while keeping it
 * readable, and because every region name is unique across the five lists
 * (asserted in regions.test.ts) the country can always be recovered from the
 * chosen value with countryForRegion(). That is what lets a listing store a
 * country without ever asking the seller for one.
 */
export const REGION_GROUPS: { country: CountryCode; label: string; regions: readonly string[] }[] =
  COUNTRIES.map((country) => ({
    country: country.code,
    label: country.name,
    regions: REGIONS_BY_COUNTRY[country.code],
  }));
