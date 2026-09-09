// Course importer — OpenStreetMap → public.clubs
//
// ============ Why this is a Supabase Edge Function ============
//
// The import has to make a large outbound request to the Overpass API and
// then write a few thousand rows. Neither fits comfortably anywhere else in
// this stack:
//
//   * A Vercel route is bounded by the plan's function duration (the project
//     is on Hobby), and an Overpass query for England alone can take the
//     better part of a minute before a single row is written.
//   * A local script would need the service-role key on someone's laptop and
//     could only ever be run by hand.
//
// An Edge Function has a long enough budget, already has
// SUPABASE_SERVICE_ROLE_KEY injected, and can be invoked from the admin
// screen one country at a time. It is idempotent: running it twice in a row
// is a no-op beyond refreshed `updated_at` values.
//
// ============ Licence ============
//
// The data is OpenStreetMap, licensed ODbL. That requires visible
// attribution wherever it's shown — rendered by the Courses pages, not here.
// Do not drop that credit.
//
// ============ What it deliberately does NOT do ============
//
// It never fuzzy-matches. A seeded club name that doesn't match an OSM record
// exactly (after normalisation) is left alone with `source = 'seed'` rather
// than being merged into the nearest-looking course. "Adare Golf Club" and
// "Adare Manor Golf Course" may or may not be the same place, and a wrong
// merge silently repoints every member whose home club it is. Unmatched seeds
// are listed in /admin/courses for a human to resolve.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Overpass is a free, heavily shared service. A query the size of England's
// is exactly the kind it sheds under load, and a 504 or 429 here is routine
// rather than exceptional — the first run of this importer hit one. So:
// several independent mirrors, tried in turn, with a pause between attempts.
// Without this the admin "refresh" button would fail often enough that
// nobody would trust it.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const RETRY_DELAYS_MS = [0, 3000, 8000, 15000];

type CountryCode = "ireland" | "northern-ireland" | "england" | "scotland" | "wales";

// Ireland is selected by ISO 3166-1; the four UK countries by ISO 3166-2,
// which is how OSM tags the constituent-country boundaries. Using the
// boundary rather than a bounding box is what makes the country assignment
// exact rather than approximate — no Welsh course landing in England because
// a rectangle overlapped.
const AREA_SELECTOR: Record<CountryCode, string> = {
  ireland: 'area["ISO3166-1"="IE"][admin_level=2]',
  "northern-ireland": 'area["ISO3166-2"="GB-NIR"]',
  england: 'area["ISO3166-2"="GB-ENG"]',
  scotland: 'area["ISO3166-2"="GB-SCT"]',
  wales: 'area["ISO3166-2"="GB-WLS"]',
};

const REGIONS: Record<CountryCode, string[]> = {
  ireland: ["Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow"],
  "northern-ireland": ["Antrim", "Armagh", "Derry", "Down", "Fermanagh", "Tyrone"],
  england: ["Bedfordshire", "Berkshire", "Bristol", "Buckinghamshire", "Cambridgeshire", "Cheshire", "City of London", "Cornwall", "Cumbria", "Derbyshire", "Devon", "Dorset", "Durham", "East Riding of Yorkshire", "East Sussex", "Essex", "Gloucestershire", "Greater London", "Greater Manchester", "Hampshire", "Herefordshire", "Hertfordshire", "Isle of Wight", "Kent", "Lancashire", "Leicestershire", "Lincolnshire", "Merseyside", "Norfolk", "North Yorkshire", "Northamptonshire", "Northumberland", "Nottinghamshire", "Oxfordshire", "Rutland", "Shropshire", "Somerset", "South Yorkshire", "Staffordshire", "Suffolk", "Surrey", "Tyne and Wear", "Warwickshire", "West Midlands", "West Sussex", "West Yorkshire", "Wiltshire", "Worcestershire"],
  scotland: ["Aberdeen City", "Aberdeenshire", "Angus", "Argyll and Bute", "City of Edinburgh", "Clackmannanshire", "Dumfries and Galloway", "Dundee City", "East Ayrshire", "East Dunbartonshire", "East Lothian", "East Renfrewshire", "Falkirk", "Fife", "Glasgow City", "Highland", "Inverclyde", "Midlothian", "Moray", "Na h-Eileanan Siar", "North Ayrshire", "North Lanarkshire", "Orkney Islands", "Perth and Kinross", "Renfrewshire", "Scottish Borders", "Shetland Islands", "South Ayrshire", "South Lanarkshire", "Stirling", "West Dunbartonshire", "West Lothian"],
  wales: ["Blaenau Gwent", "Bridgend", "Caerphilly", "Cardiff", "Carmarthenshire", "Ceredigion", "Conwy", "Denbighshire", "Flintshire", "Gwynedd", "Isle of Anglesey", "Merthyr Tydfil", "Monmouthshire", "Neath Port Talbot", "Newport", "Pembrokeshire", "Powys", "Rhondda Cynon Taf", "Swansea", "Torfaen", "Vale of Glamorgan", "Wrexham"],
};

// Things OSM tags as, or names, like a golf course but which nobody holds a
// club membership at. Kept as a name test as well as a tag test because the
// `golf=` tag is inconsistently applied — plenty of driving ranges are
// tagged only `leisure=golf_course` with "Driving Range" in the name.
const NOT_A_CLUB =
  /(driving\s*range|pitch\s*(and|&|'?n'?)\s*putt|pitch-?and-?putt|crazy\s*golf|mini(ature)?\s*golf|adventure\s*golf|foot\s*golf|footgolf|disc\s*golf|frisbee|golf\s*range|indoor\s*golf|golf\s*simulator|putting\s*green)/i;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type Candidate = {
  osmId: string;
  name: string;
  normalised: string;
  region: string | null;
  town: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  holes: number | null;
};

type ExistingRow = {
  id: number;
  name: string;
  slug: string;
  osm_id: string | null;
  source: string;
  verified_at: string | null;
};

/**
 * Comparison key for "is this the same club?".
 *
 * Lowercased, accents stripped, "&" spelled out, punctuation dropped,
 * whitespace collapsed — and then the generic suffix removed, so
 * "Lahinch Golf Club" and "Lahinch Golf Links" both reduce to "lahinch".
 * That last step is what lets the seeded Irish names match OSM's wording,
 * which differs on the suffix far more often than on the actual place name.
 */
function normaliseName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+(golf\s+(club|course|links|centre|center|resort)|golf|gc|g\s*c)$/, "")
    .replace(/^(the)\s+/, "")
    .trim();
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "-and-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Only http(s), only something that could plausibly be a hostname. */
function cleanWebsite(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().split(/[;,\s]/)[0];
  if (!trimmed || trimmed.length > 300) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Map an OSM address tag onto one of the country's own region names.
 *
 * Handles the spellings OSM actually uses: "Co. Antrim", "County Kerry",
 * "County Londonderry" for what this site calls Derry, and the
 * `-shire`/`-County` variants. Anything that doesn't resolve returns null and
 * gets filled in by hand in /admin/courses — a wrong region is worse than a
 * blank one, because a blank one shows up in the admin gap list and a wrong
 * one doesn't.
 */
function matchRegion(country: CountryCode, tags: Record<string, string>): string | null {
  const regions = REGIONS[country];
  const candidates = [
    tags["addr:county"],
    tags["addr:subdistrict"],
    tags["addr:district"],
    tags["addr:state"],
    tags["is_in:county"],
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    const cleaned = raw
      .replace(/^\s*(co\.?|county)\s+/i, "")
      .replace(/\s*,.*$/, "")
      .trim();
    const key = cleaned.toLowerCase();

    const direct = regions.find((r) => r.toLowerCase() === key);
    if (direct) return direct;

    // Londonderry → Derry. The only place this site's chosen spelling
    // differs from OSM's, so it's a named special case rather than a table.
    if (country === "northern-ireland" && /londonderry/i.test(cleaned)) return "Derry";
    if (country === "england" && /^(london|greater london)$/i.test(cleaned)) return "Greater London";

    const loose = regions.find(
      (r) => r.toLowerCase().replace(/[^a-z]/g, "") === key.replace(/[^a-z]/g, "")
    );
    if (loose) return loose;
  }

  return null;
}

function parseHoles(tags: Record<string, string>): number | null {
  const raw = tags["golf:holes"] ?? tags["holes"];
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : null;
}

function overpassQuery(country: CountryCode): string {
  // `out tags center` returns each way/relation's tags plus a single
  // representative point, instead of the full polygon geometry. A course
  // outline is dozens to hundreds of nodes and we only ever plot a pin, so
  // asking for geometry would multiply the response size for nothing.
  return `[out:json][timeout:180];
${AREA_SELECTOR[country]}->.searchArea;
(
  node["leisure"="golf_course"]["name"](area.searchArea);
  way["leisure"="golf_course"]["name"](area.searchArea);
  relation["leisure"="golf_course"]["name"](area.searchArea);
);
out tags center;`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Overpass query, retried across mirrors.
 *
 * Overpass reports overload as a 504 or 429 *and* sometimes as a 200 whose
 * body is an HTML error page rather than JSON, so the parse is part of what
 * counts as success here — a response that doesn't parse is retried like any
 * other failure rather than being reported as "0 courses found", which is
 * indistinguishable from a genuinely empty country and would quietly wipe
 * nothing but also import nothing.
 */
async function fetchOverpass(country: CountryCode): Promise<OverpassElement[]> {
  const failures: string[] = [];

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt]);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass asks callers to identify themselves; an anonymous bulk
          // query is the kind that gets an IP rate-limited.
          "User-Agent": "Pinpals course directory import (https://www.pinpals.ie)",
        },
        body: new URLSearchParams({ data: overpassQuery(country) }),
      });

      const text = await response.text();
      if (!response.ok) {
        failures.push(`${endpoint} → ${response.status}`);
        continue;
      }

      const payload = JSON.parse(text) as { elements?: OverpassElement[] };
      if (!Array.isArray(payload.elements)) {
        failures.push(`${endpoint} → 200 with no elements array`);
        continue;
      }
      return payload.elements;
    } catch (cause) {
      failures.push(`${endpoint} → ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  throw new Error(`Overpass unavailable after ${RETRY_DELAYS_MS.length} attempts: ${failures.join("; ")}`);
}

async function fetchCandidates(country: CountryCode): Promise<Candidate[]> {
  const elements = await fetchOverpass(country);

  const raw: Candidate[] = [];

  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = (tags.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 200) continue;
    if (NOT_A_CLUB.test(name)) continue;
    if (tags.golf === "driving_range" || tags.golf === "pitch_and_putt") continue;

    const normalised = normaliseName(name);
    if (!normalised) continue;

    const point = element.center ?? (element.lat != null && element.lon != null ? { lat: element.lat, lon: element.lon } : null);

    const candidate: Candidate = {
      osmId: `${element.type}/${element.id}`,
      name,
      normalised,
      region: matchRegion(country, tags),
      town: (tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"] ?? tags["addr:suburb"] ?? "").trim() || null,
      website: cleanWebsite(tags.website ?? tags["contact:website"] ?? tags.url),
      latitude: point ? point.lat : null,
      longitude: point ? point.lon : null,
      holes: parseHoles(tags),
    };

    raw.push(candidate);
  }

  return dedupe(raw);
}

/** Rough great-circle distance in kilometres. */
function distanceKm(a: Candidate, b: Candidate): number {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return Number.POSITIVE_INFINITY;
  }
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const midLat = ((a.latitude + b.latitude) / 2) * toRad;
  const x = dLon * Math.cos(midLat);
  return Math.hypot(dLat, x) * 6371;
}

// Two records this far apart are two courses even if they share a name.
// 8km comfortably contains a single course mapped twice (a clubhouse node
// and a course polygon are usually a few hundred metres apart at most) and
// comfortably separates two clubs that merely share a common name.
const SAME_COURSE_KM = 8;

/**
 * Collapse the same course appearing more than once, without collapsing two
 * different courses that share a name.
 *
 * OSM routinely holds one club as several elements — the clubhouse as a
 * node, the course as a way, sometimes a relation over both — and listing
 * Royal County Down three times would be an obvious embarrassment. But
 * name alone is not enough to merge on across a country the size of England:
 * there is a "Manor Golf Club" in Yorkshire and another in Surrey, and
 * merging them would silently delete a real club from the directory.
 *
 * So records are grouped by normalised name and then split by distance.
 * A record with no coordinates can't be placed at all, so it joins the
 * cluster only when there is exactly one to join; where the name covers two
 * or more real courses it stands alone rather than being guessed into the
 * wrong one.
 */
function dedupe(candidates: Candidate[]): Candidate[] {
  const byName = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = byName.get(candidate.normalised);
    if (group) group.push(candidate);
    else byName.set(candidate.normalised, [candidate]);
  }

  const output: Candidate[] = [];

  for (const group of byName.values()) {
    if (group.length === 1) {
      output.push(group[0]);
      continue;
    }

    const clusters: Candidate[][] = [];

    // Placeable records first, so the clusters exist before anything has to
    // be assigned to one.
    for (const candidate of group.filter((c) => c.latitude != null)) {
      const home = clusters.find((cluster) =>
        cluster.some((member) => distanceKm(member, candidate) <= SAME_COURSE_KM)
      );
      if (home) home.push(candidate);
      else clusters.push([candidate]);
    }

    // A record with no coordinates can't be placed. If every placeable
    // record of this name turned out to be one course, it is that course —
    // most likely the clubhouse node someone tagged without a position. If
    // there are two or more, guessing would put it at the wrong club, so it
    // stands alone and shows up in the admin gap list instead.
    for (const candidate of group.filter((c) => c.latitude == null)) {
      if (clusters.length === 1) clusters[0].push(candidate);
      else clusters.push([candidate]);
    }

    for (const cluster of clusters) {
      const sorted = [...cluster].sort((a, b) => score(b) - score(a));
      output.push(sorted.reduce((winner, other) => merge(winner, other)));
    }
  }

  return output;
}

function score(c: Candidate): number {
  return (c.website ? 4 : 0) + (c.region ? 2 : 0) + (c.latitude != null ? 1 : 0) + (c.town ? 1 : 0) + (c.holes ? 1 : 0);
}

/** Winner's values, with the loser filling any gap the winner has. */
function merge(preferred: Candidate, other: Candidate): Candidate {
  return {
    ...preferred,
    region: preferred.region ?? other.region,
    town: preferred.town ?? other.town,
    website: preferred.website ?? other.website,
    latitude: preferred.latitude ?? other.latitude,
    longitude: preferred.longitude ?? other.longitude,
    holes: preferred.holes ?? other.holes,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const secret = Deno.env.get("COURSE_IMPORT_SECRET");
  if (secret && request.headers.get("x-import-secret") !== secret) {
    return json({ error: "forbidden" }, 403);
  }

  let country: CountryCode;
  try {
    const body = (await request.json()) as { country?: string };
    if (!body.country || !(body.country in AREA_SELECTOR)) {
      return json({ error: `country must be one of ${Object.keys(AREA_SELECTOR).join(", ")}` }, 400);
    }
    country = body.country as CountryCode;
  } catch {
    return json({ error: "expected a JSON body with a country" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const started = Date.now();

  // An uncaught throw here reaches the caller as a bare "Internal Server
  // Error" with the reason only in the function logs, which is a miserable
  // thing to hand a staff member who just pressed a button.
  let candidates: Candidate[];
  try {
    candidates = await fetchCandidates(country);
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : String(cause), country }, 502);
  }

  // Every row that could conceivably be the home of one of these candidates:
  // this country's rows, plus — when importing either part of the island —
  // the all-island seeded rows, which are all provisionally 'ireland' and
  // include the ~95 that actually belong to Northern Ireland.
  const countriesToScan =
    country === "ireland" || country === "northern-ireland"
      ? ["ireland", "northern-ireland"]
      : [country];

  const { data: existingRows, error: readError } = await supabase
    .from("clubs")
    .select("id, name, slug, osm_id, source, verified_at")
    .in("country", countriesToScan)
    .returns<ExistingRow[]>();

  if (readError) return json({ error: `reading clubs failed: ${readError.message}` }, 500);

  const byOsmId = new Map((existingRows ?? []).filter((r) => r.osm_id).map((r) => [r.osm_id!, r]));
  const seedByNormalised = new Map(
    (existingRows ?? [])
      .filter((r) => r.source === "seed")
      .map((r) => [normaliseName(r.name), r])
  );

  // Slugs already in use across the whole table, so a new English course
  // called "Woodbrook" can't take the slug the Irish one already publishes.
  const { data: allSlugs } = await supabase.from("clubs").select("slug").returns<{ slug: string }[]>();
  const takenSlugs = new Set((allSlugs ?? []).map((r) => r.slug));

  const inserts: Record<string, unknown>[] = [];
  // Two update batches, not one, and every row in a batch carries exactly
  // the same keys. PostgREST builds a single statement from an array and
  // takes the union of the keys it finds — so a row that omits a key another
  // row in the same batch supplies gets that column set to null. Mixing a
  // full refresh and a country-only correction in one array would therefore
  // blank a verified course's website. Each batch also repeats `name` and
  // `slug` because an upsert is an INSERT ... ON CONFLICT under the hood,
  // and both columns are NOT NULL — the insert tuple has to be valid even
  // though it will never actually be inserted.
  const fullUpdates: Record<string, unknown>[] = [];
  const structuralUpdates: Record<string, unknown>[] = [];
  let skippedVerified = 0;
  let skippedManual = 0;
  let adopted = 0;

  for (const candidate of candidates) {
    const existing = byOsmId.get(candidate.osmId) ?? seedByNormalised.get(candidate.normalised);

    if (existing) {
      if (existing.source === "manual") {
        skippedManual++;
        continue;
      }
      if (existing.verified_at) {
        // A staff member has checked this row. Country is still corrected —
        // that's structural, not editorial — but their website, region,
        // town and coordinates stand.
        structuralUpdates.push({
          id: existing.id,
          name: existing.name,
          slug: existing.slug,
          country,
          osm_id: candidate.osmId,
        });
        skippedVerified++;
        continue;
      }

      if (existing.source === "seed") adopted++;

      // The slug is deliberately left alone. A seeded row's slug came from
      // the name Pinpals already published at /courses/…, and OSM's wording
      // for the same club often differs ("Golf Links" vs "Golf Club");
      // regenerating it would silently break every existing link and any
      // search engine result pointing at it.
      fullUpdates.push({
        id: existing.id,
        name: candidate.name,
        slug: existing.slug,
        country,
        region: candidate.region,
        town: candidate.town,
        website: candidate.website,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        holes: candidate.holes,
        source: "osm",
        osm_id: candidate.osmId,
      });
      continue;
    }

    let slug = slugify(candidate.name);
    if (!slug) slug = `course-${candidate.osmId.replace("/", "-")}`;
    if (takenSlugs.has(slug) && candidate.region) slug = `${slug}-${slugify(candidate.region)}`;
    if (takenSlugs.has(slug)) slug = `${slug}-${slugify(country)}`;
    if (takenSlugs.has(slug)) slug = `${slug}-${candidate.osmId.replace("/", "")}`;
    takenSlugs.add(slug);

    inserts.push({
      name: candidate.name,
      slug,
      country,
      region: candidate.region,
      town: candidate.town,
      website: candidate.website,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      holes: candidate.holes,
      source: "osm",
      osm_id: candidate.osmId,
    });
  }

  // Chunked because a single statement carrying ~1,900 rows is a needlessly
  // large request body and one failure loses the whole run.
  const CHUNK = 200;

  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase.from("clubs").insert(inserts.slice(i, i + CHUNK));
    if (error) return json({ error: `insert failed at row ${i}: ${error.message}`, inserted: i }, 500);
  }

  for (const batch of [fullUpdates, structuralUpdates]) {
    for (let i = 0; i < batch.length; i += CHUNK) {
      const { error } = await supabase.from("clubs").upsert(batch.slice(i, i + CHUNK), { onConflict: "id" });
      if (error) return json({ error: `update failed at row ${i}: ${error.message}`, updated: i }, 500);
    }
  }

  return json({
    country,
    osmRecords: candidates.length,
    inserted: inserts.length,
    updated: fullUpdates.length + structuralUpdates.length,
    seedRowsAdopted: adopted,
    leftAloneVerified: skippedVerified,
    leftAloneManual: skippedManual,
    withWebsite: candidates.filter((c) => c.website).length,
    withRegion: candidates.filter((c) => c.region).length,
    withCoordinates: candidates.filter((c) => c.latitude != null).length,
    elapsedMs: Date.now() - started,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
