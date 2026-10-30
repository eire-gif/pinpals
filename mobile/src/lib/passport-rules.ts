/**
 * Course Passport (Oct 2026, claude/course-passport.md): the pure half.
 *
 * A member's passport is every course they've played — from their saved
 * scorecards (with the dates) and the courses they've ticked as played on
 * their profile — drawn on a satellite map, with badges and bucket lists.
 * No migration: scorecards and member_courses are the member's own rows,
 * and clubs are readable by everyone.
 *
 * Tested in passport-rules.test.ts.
 */

export type PassportClub = {
  id: number;
  name: string;
  country: string;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type Stamp = PassportClub & {
  /** Most recent round here from a scorecard; null when only ticked as played. */
  lastPlayed: string | null;
  rounds: number;
};

export type Province = "Leinster" | "Munster" | "Connacht" | "Ulster";

const PROVINCE_OF: Record<string, Province> = {
  Carlow: "Leinster",
  Dublin: "Leinster",
  Kildare: "Leinster",
  Kilkenny: "Leinster",
  Laois: "Leinster",
  Longford: "Leinster",
  Louth: "Leinster",
  Meath: "Leinster",
  Offaly: "Leinster",
  Westmeath: "Leinster",
  Wexford: "Leinster",
  Wicklow: "Leinster",
  Clare: "Munster",
  Cork: "Munster",
  Kerry: "Munster",
  Limerick: "Munster",
  Tipperary: "Munster",
  Waterford: "Munster",
  Galway: "Connacht",
  Leitrim: "Connacht",
  Mayo: "Connacht",
  Roscommon: "Connacht",
  Sligo: "Connacht",
  Cavan: "Ulster",
  Donegal: "Ulster",
  Monaghan: "Ulster",
};

export const PROVINCES: readonly Province[] = ["Leinster", "Munster", "Connacht", "Ulster"];

/** The province an Irish club is in (all of Northern Ireland is Ulster), or null. */
export function provinceOf(club: Pick<PassportClub, "country" | "region">): Province | null {
  if (club.country === "northern-ireland") return "Ulster";
  if (club.country !== "ireland" || !club.region) return null;
  return PROVINCE_OF[club.region.replace(/^(Co\.?|County)\s+/i, "").trim()] ?? null;
}

/** Courses played in each province. */
export function provinceCounts(stamps: readonly Stamp[]): Record<Province, number> {
  const out: Record<Province, number> = { Leinster: 0, Munster: 0, Connacht: 0, Ulster: 0 };
  for (const s of stamps) {
    const p = provinceOf(s);
    if (p) out[p] += 1;
  }
  return out;
}

const HOME = new Set(["ireland", "northern-ireland"]);

export const COUNTRY_LABEL: Record<string, string> = {
  ireland: "Ireland",
  "northern-ireland": "Northern Ireland",
  england: "England",
  scotland: "Scotland",
  wales: "Wales",
  spain: "Spain",
  portugal: "Portugal",
};

/** Countries played in, Ireland and Northern Ireland counted as one island. */
export function countriesPlayed(stamps: readonly Stamp[]): string[] {
  const set = new Set<string>();
  for (const s of stamps) set.add(HOME.has(s.country) ? "ireland" : s.country);
  return [...set];
}

export type Badge = { id: string; label: string; earned: boolean; detail: string; icon: "star" | "globe" | "flag" | "trophy" | "water" };

/** The badges on the passport, earned or still to get. */
export function badges(stamps: readonly Stamp[], trailDone: number, trailSize: number): Badge[] {
  const n = stamps.length;
  const prov = provinceCounts(stamps);
  const provincesDone = PROVINCES.filter((p) => prov[p] > 0).length;
  const abroad = stamps.filter((s) => !HOME.has(s.country)).length;
  const milestone = [10, 25, 50, 100].find((m) => n < m) ?? null;
  const reached = [100, 50, 25, 10].find((m) => n >= m) ?? null;
  return [
    {
      id: "provinces",
      label: "All 4 Provinces",
      earned: provincesDone === 4,
      detail: provincesDone === 4 ? "Played in every province" : `${provincesDone} of 4 provinces`,
      icon: "star",
    },
    {
      id: "courses",
      label: reached ? `${reached} Courses` : "10 Courses",
      earned: reached != null,
      detail: milestone ? `${n} of ${milestone}` : `${n} courses`,
      icon: "flag",
    },
    {
      id: "trail",
      label: "Links Trail",
      earned: trailSize > 0 && trailDone >= trailSize,
      detail: `${trailDone} of ${trailSize}`,
      icon: "water",
    },
    {
      id: "abroad",
      label: "Played Abroad",
      earned: abroad > 0,
      detail: abroad > 0 ? `${abroad} course${abroad === 1 ? "" : "s"} abroad` : "Spain, Portugal, the UK…",
      icon: "globe",
    },
  ];
}

/** Merge scorecard rounds and ticked-as-played courses into one stamp per club, newest first. */
export function stampsFrom(
  rounds: readonly { club: PassportClub; playedOn: string }[],
  ticked: readonly PassportClub[],
): Stamp[] {
  const by = new Map<number, Stamp>();
  for (const r of rounds) {
    const s = by.get(r.club.id);
    if (!s) by.set(r.club.id, { ...r.club, lastPlayed: r.playedOn, rounds: 1 });
    else {
      s.rounds += 1;
      if (!s.lastPlayed || r.playedOn > s.lastPlayed) s.lastPlayed = r.playedOn;
    }
  }
  for (const c of ticked) if (!by.has(c.id)) by.set(c.id, { ...c, lastPlayed: null, rounds: 0 });
  return [...by.values()].sort(
    (a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "") || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Bucket lists
// ---------------------------------------------------------------------------

export type TrailCourse = { key: string; label: string; place: string; match: string; country: string };

/**
 * The Irish Links Trail: twelve of the island's great links. `match` is a
 * word that only that club's name has in the directory, looked up by name
 * (the directory's ids aren't fixed across environments).
 */
export const IRISH_LINKS_TRAIL: readonly TrailCourse[] = [
  { key: "ballybunion", label: "Ballybunion", place: "Co. Kerry", match: "Ballybunion", country: "ireland" },
  { key: "lahinch", label: "Lahinch", place: "Co. Clare", match: "Lahinch", country: "ireland" },
  { key: "portmarnock", label: "Portmarnock", place: "Co. Dublin", match: "Portmarnock Golf Club", country: "ireland" },
  { key: "royal-dublin", label: "Royal Dublin", place: "Co. Dublin", match: "Royal Dublin", country: "ireland" },
  { key: "european-club", label: "The European Club", place: "Co. Wicklow", match: "European Club", country: "ireland" },
  { key: "royal-county-down", label: "Royal County Down", place: "Co. Down", match: "Royal County Down", country: "northern-ireland" },
  { key: "royal-portrush", label: "Royal Portrush", place: "Co. Antrim", match: "Royal Portrush", country: "northern-ireland" },
  { key: "waterville", label: "Waterville", place: "Co. Kerry", match: "Waterville", country: "ireland" },
  { key: "tralee", label: "Tralee", place: "Co. Kerry", match: "Tralee", country: "ireland" },
  { key: "county-sligo", label: "County Sligo", place: "Rosses Point", match: "County Sligo", country: "ireland" },
  { key: "enniscrone", label: "Enniscrone", place: "Co. Sligo", match: "Enniscrone", country: "ireland" },
  { key: "carne", label: "Carne", place: "Co. Mayo", match: "Carne", country: "ireland" },
];

/** Which directory club a trail entry is: its name contains the match word, in the right country; shortest name wins. */
export function matchTrail<T extends { id: number; name: string; country: string }>(trail: readonly TrailCourse[], clubs: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const t of trail) {
    const word = t.match.toLowerCase();
    const hits = clubs
      .filter((c) => c.country === t.country && c.name.toLowerCase().includes(word))
      .sort((a, b) => a.name.length - b.name.length || a.id - b.id);
    if (hits[0]) out.set(t.key, hits[0]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

export type MapPin = { id: number; lat: number; lng: number; kind: "played" | "newest" | "bucket"; title: string; sub: string };

/** Pins for the map: played courses, the newest picked out, then bucket-list courses not yet played. */
export function mapPins(stamps: readonly Stamp[], bucket: readonly PassportClub[], dateLabel: (iso: string) => string): MapPin[] {
  const pins: MapPin[] = [];
  const newest = stamps.find((s) => s.lastPlayed)?.id ?? null;
  for (const s of stamps) {
    if (s.latitude == null || s.longitude == null) continue;
    pins.push({
      id: s.id,
      lat: s.latitude,
      lng: s.longitude,
      kind: s.id === newest ? "newest" : "played",
      title: s.name,
      sub: s.lastPlayed ? `${s.rounds > 1 ? `${s.rounds} rounds · ` : ""}last ${dateLabel(s.lastPlayed)}` : "Played",
    });
  }
  const played = new Set(stamps.map((s) => s.id));
  for (const b of bucket) {
    if (played.has(b.id) || b.latitude == null || b.longitude == null) continue;
    pins.push({ id: b.id, lat: b.latitude, lng: b.longitude, kind: "bucket", title: b.name, sub: "On your bucket list" });
  }
  return pins;
}

export type MapView = "ireland" | "europe" | "world";

/** [south, west, north, east] for each zoom chip. */
export const VIEW_BOUNDS: Record<MapView, [number, number, number, number]> = {
  ireland: [51.35, -10.7, 55.45, -5.35],
  europe: [35.5, -11.5, 59.5, 4.5],
  world: [-50, -170, 70, 170],
};
