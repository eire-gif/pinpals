// golfapi.io responses → PinPals rows. Pure: no Deno, no network, no
// Supabase, so vitest runs it (mapping.test.ts) alongside everything else.
//
// ============ Field names ============
//
// Verified against live responses on 9 Oct 2026 (Portmarnock Championship
// and seven other North Dublin courses): courseID, courseName (sometimes
// absent), numHoles, parsMen/indexesMen arrays, tees[] with teeName,
// courseRatingMen/slopeMen/courseRatingWomen/slopeWomen and length1…18 (yards),
// coordinates[] with poi/location/sideFW/hole/latitude/longitude. Reads stay
// tolerant and report what they found, in case the provider changes shape.

export type PointKind =
  | "tee_front"
  | "tee_back"
  | "green_front"
  | "green_centre"
  | "green_back"
  | "green_bunker"
  | "fairway_bunker"
  | "water"
  | "trees"
  | "marker_100"
  | "marker_150"
  | "marker_200"
  | "dogleg"
  | "other";

export type MappedPoint = { hole: number; kind: PointKind; lat: number; lng: number; label: string | null };

export type MappedTee = {
  teeName: string;
  holes: 9 | 18;
  parTotal: number | null;
  courseRating: number | null;
  slope: number | null;
  /** Par and stroke index per hole; null when the provider has no indexes. */
  card: Array<{ hole: number; par: number; strokeIndex: number }> | null;
};

export type MappedCourse = {
  providerCourseId: string;
  name: string;
  holes: 9 | 18;
  tees: MappedTee[];
};

export type ShapeReport = {
  found: string[];
  missing: string[];
};

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v != null && !Array.isArray(v);

function pick(o: Json, names: readonly string[], report: ShapeReport, what: string): unknown {
  for (const n of names) {
    if (o[n] !== undefined && o[n] !== null && o[n] !== "") {
      report.found.push(`${what}: ${n}`);
      return o[n];
    }
  }
  report.missing.push(`${what} (tried ${names.join(", ")})`);
  return undefined;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** An array of 9 or 18 numbers, from an array or from field1…field18. */
function perHole(o: Json, arrayNames: readonly string[], prefix: string | null, report: ShapeReport, what: string): Array<number | null> | null {
  const arr = pick(o, arrayNames, { found: [], missing: [] }, what);
  if (Array.isArray(arr)) {
    report.found.push(`${what}: array`);
    return arr.map(num);
  }
  if (prefix && o[`${prefix}1`] !== undefined) {
    report.found.push(`${what}: ${prefix}1…`);
    const out: Array<number | null> = [];
    for (let i = 1; i <= 18 && o[`${prefix}${i}`] !== undefined; i++) out.push(num(o[`${prefix}${i}`]));
    return out;
  }
  report.missing.push(`${what} (tried ${arrayNames.join(", ")}${prefix ? `, ${prefix}1…` : ""})`);
  return null;
}

const clampName = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);

/** A whole card is only usable if every hole has a valid par and a unique index. */
export function validCard(pars: Array<number | null>, indexes: Array<number | null> | null, holes: 9 | 18): MappedTee["card"] {
  if (!indexes || pars.length < holes || indexes.length < holes) return null;
  const card: Array<{ hole: number; par: number; strokeIndex: number }> = [];
  const seen = new Set<number>();
  for (let i = 0; i < holes; i++) {
    const par = pars[i];
    const si = indexes[i];
    if (par == null || par < 3 || par > 6 || si == null || si < 1 || si > 18 || seen.has(si)) return null;
    seen.add(si);
    card.push({ hole: i + 1, par, strokeIndex: si });
  }
  return card;
}

/**
 * GET /courses/{id}. `clubCourseCount` is how many courses the club has:
 * with more than one, tee names are prefixed with the course ("Old · White")
 * because PinPals keeps one card per club and tee name.
 */
/**
 * `opts.name` replaces the provider's course name ("Red + Blue" →
 * "Championship"); `opts.prefixTees` forces the course name onto tee names
 * even for a single-course import — needed at clubs like Portmarnock, which
 * golfapi lists as nine nine-hole combinations sharing tee colours.
 */
export function mapCourse(
  raw: unknown,
  clubCourseCount: number,
  opts: { name?: string; prefixTees?: boolean } = {}
): { course: MappedCourse | null; report: ShapeReport } {
  const report: ShapeReport = { found: [], missing: [] };
  if (!isObj(raw)) {
    report.missing.push("course object");
    return { course: null, report };
  }
  const id = pick(raw, ["courseID", "courseId", "id"], report, "course id");
  const providerName = String(pick(raw, ["courseName", "name"], report, "course name") ?? "Main course");
  const name = opts.name?.trim() || providerName;
  const numHoles = num(pick(raw, ["numHoles", "holes"], report, "hole count"));
  const holes: 9 | 18 = numHoles === 9 ? 9 : 18;

  const parsMen = perHole(raw, ["parsMen", "pars", "par"], "parMen", report, "pars") ?? [];
  const idxMen = perHole(raw, ["indexesMen", "indexes", "strokeIndexes", "handicaps"], "indexMen", report, "stroke indexes");
  const parsWomen = perHole(raw, ["parsWomen"], "parWomen", { found: [], missing: [] }, "pars (women)");
  const idxWomen = perHole(raw, ["indexesWomen"], "indexWomen", { found: [], missing: [] }, "stroke indexes (women)");

  const teesRaw = pick(raw, ["tees", "teeBoxes"], report, "tees");
  const tees: MappedTee[] = [];
  const prefix = clubCourseCount > 1 || opts.prefixTees ? `${clampName(name, 18)} · ` : "";
  const sumPar = (p: Array<number | null>) => (p.length >= holes && p.slice(0, holes).every((x) => x != null) ? p.slice(0, holes).reduce<number>((a, b) => a + (b ?? 0), 0) : null);

  for (const t of Array.isArray(teesRaw) ? teesRaw : []) {
    if (!isObj(t)) continue;
    const teeName = String(t.teeName ?? t.name ?? t.teeColor ?? t.color ?? "Standard").trim() || "Standard";
    const ratingMen = num(t.courseRatingMen ?? t.courseRating ?? t.rating);
    const slopeMen = num(t.slopeMen ?? t.slope ?? t.slopeRating);
    const ratingWomen = num(t.courseRatingWomen);
    const slopeWomen = num(t.slopeWomen);

    const mensCard = validCard(parsMen, idxMen, holes);
    tees.push({
      teeName: clampName(prefix + teeName, 40),
      holes,
      parTotal: sumPar(parsMen),
      courseRating: ratingMen != null && ratingMen >= 25 && ratingMen <= 85 ? ratingMen : null,
      slope: slopeMen != null && slopeMen >= 55 && slopeMen <= 155 ? Math.round(slopeMen) : null,
      card: mensCard,
    });

    // A women's rating on the same tees is a different card (rating, slope,
    // and often par and indexes): kept as its own tee so the handicap maths
    // uses the right numbers.
    if (ratingWomen != null && ratingWomen >= 25 && ratingWomen <= 85) {
      const wPars = parsWomen && parsWomen.length >= holes ? parsWomen : parsMen;
      const wIdx = idxWomen && idxWomen.length >= holes ? idxWomen : idxMen;
      tees.push({
        teeName: clampName(`${prefix}${teeName} (Women)`, 40),
        holes,
        parTotal: sumPar(wPars),
        courseRating: ratingWomen,
        slope: slopeWomen != null && slopeWomen >= 55 && slopeWomen <= 155 ? Math.round(slopeWomen) : null,
        card: validCard(wPars, wIdx, holes),
      });
    }
  }

  if (id == null) return { course: null, report };
  return { course: { providerCourseId: String(id), name: clampName(name, 80), holes, tees }, report };
}

// golfapi.io's point-of-interest codes, as previously published. Road (10)
// is dropped: it isn't something a golfer plays to.
const POI: Record<number, PointKind | "green" | "skip"> = {
  1: "green",
  2: "green_bunker",
  3: "fairway_bunker",
  4: "water",
  5: "trees",
  6: "marker_100",
  7: "marker_150",
  8: "marker_200",
  9: "dogleg",
  10: "skip",
  11: "tee_front",
  12: "tee_back",
};

const HAZARD_NAMES: Partial<Record<PointKind, string>> = {
  green_bunker: "Greenside bunker",
  fairway_bunker: "Fairway bunker",
  water: "Water",
  trees: "Trees",
};

/**
 * GET /coordinates/{id}. Each row is a point of interest on a hole; for the
 * green and hazards, `location` says front (1), centre (2) or back (3).
 * Hazards keep front ("reach") and back ("carry") — the two numbers a golfer
 * actually decides with — and a centre only when it's all there is.
 */
export function mapCoordinates(raw: unknown): { points: MappedPoint[]; report: ShapeReport } {
  const report: ShapeReport = { found: [], missing: [] };
  const list = isObj(raw) ? pick(raw, ["coordinates", "points", "pois"], report, "coordinates") : Array.isArray(raw) ? raw : undefined;
  if (!Array.isArray(list)) return { points: [], report };

  const out: MappedPoint[] = [];
  const centres: Array<{ key: string; point: MappedPoint }> = [];
  const hasEdge = new Set<string>();
  let unknown = 0;

  for (const r of list) {
    if (!isObj(r)) continue;
    const hole = num(r.hole ?? r.holeNumber);
    const lat = num(r.latitude ?? r.lat);
    const lng = num(r.longitude ?? r.lng ?? r.lon);
    const poi = num(r.poi ?? r.type);
    const loc = num(r.location ?? r.position);
    if (hole == null || hole < 1 || hole > 18 || lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const kind = poi != null ? POI[poi] : undefined;
    if (kind === "skip") continue;
    if (kind === undefined) {
      unknown++;
      continue;
    }
    if (kind === "green") {
      out.push({ hole, kind: loc === 1 ? "green_front" : loc === 3 ? "green_back" : "green_centre", lat, lng, label: null });
      continue;
    }
    const name = HAZARD_NAMES[kind];
    if (!name) {
      out.push({ hole, kind, lat, lng, label: null });
      continue;
    }
    // sideFW: 1 left of the fairway, 2 middle, 3 right.
    const side = num(r.sideFW);
    const sided = side === 1 ? `${name} left` : side === 3 ? `${name} right` : name;
    const key = `${hole}-${kind}-${side ?? 0}`;
    if (loc === 1 || loc === 3) {
      hasEdge.add(key);
      out.push({ hole, kind, lat, lng, label: `${sided} · ${loc === 1 ? "reach" : "carry"}` });
    } else {
      centres.push({ key, point: { hole, kind, lat, lng, label: sided } });
    }
  }

  for (const c of centres) if (!hasEdge.has(c.key)) out.push(c.point);
  if (unknown > 0) report.missing.push(`${unknown} points with an unrecognised poi code (kept out)`);
  report.found.push(`${out.length} points`);
  return { points: out, report };
}

/** Search results (GET /clubs): just what's needed to pick the right match. */
export type ClubCandidate = {
  providerClubId: string;
  name: string;
  town: string | null;
  lat: number | null;
  lng: number | null;
  courses: Array<{ providerCourseId: string; name: string; holes: number | null; hasGps: boolean | null }>;
};

export function mapClubSearch(raw: unknown): ClubCandidate[] {
  const list = isObj(raw) ? (raw.clubs ?? raw.results ?? raw.data) : raw;
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((c) => ({
    providerClubId: String(c.clubID ?? c.clubId ?? c.id ?? ""),
    name: String(c.clubName ?? c.name ?? ""),
    town: (c.city ?? c.town ?? null) as string | null,
    lat: num(c.latitude ?? c.lat),
    lng: num(c.longitude ?? c.lng),
    courses: (Array.isArray(c.courses) ? c.courses : []).filter(isObj).map((k) => ({
      providerCourseId: String(k.courseID ?? k.courseId ?? k.id ?? ""),
      name: String(k.courseName ?? k.name ?? "Main course"),
      holes: num(k.numHoles ?? k.holes),
      hasGps: k.hasGPS == null ? null : Boolean(Number(k.hasGPS)),
    })),
  }));
}

/** Kilometres between two points — for ranking search matches. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** golfapi.io charges 1 per detail call and 0.1 per search (Oct 2026). */
export function importCost(courses: number, withGps: boolean): number {
  return courses * (withGps ? 2 : 1);
}
