// Course data importer — golfapi.io → course cards and hole maps (Oct 2026).
//
// ============ What it does ============
//
//   search   (0.1 call)  Our club → golfapi.io's candidate clubs, nearest
//                        first, with their courses. Writes nothing. A human
//                        (staff) picks the match; this never guesses, for
//                        the same reason the OSM importer never fuzzy-merges.
//   inspect  (1–2 calls) One golfapi course's raw responses plus what the
//                        mapper made of them. Writes nothing. Run this FIRST,
//                        on the trial key: the field names in mapping.ts are
//                        unverified until a real response has been seen.
//   import   (1–2 calls per course) For one of our clubs and the golfapi
//                        course ids picked from `search`: writes a course
//                        card per tee (rating, slope, par, stroke index) and,
//                        with gps, the hole map points.
//
// ============ Money ============
//
// Every call costs real money (1 per course, 1 more for its coordinates).
// So: nothing runs on a schedule; every call names the courses it will
// fetch; the cost is worked out BEFORE the first request and refused above
// `max_calls` (default 10); and every response says how many calls golfapi
// has left (`apiRequestsLeft`).
//
// ============ Licence ============
//
// golfapi.io's terms (read Oct 2026): commercial use in our own product,
// stored and cached indefinitely, no attribution, and we may keep using what
// was delivered after a plan ends. We must take reasonable measures against
// scraping — which is why course_layout_* is readable only one club at a time
// (0108). The key never leaves this function: GOLFAPI_KEY is a Supabase
// secret, never in the app, the site or git.
//
// ============ Calling it ============
//
//   curl -X POST "$SUPABASE_URL/functions/v1/import-golfapi" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "x-import-secret: $GOLFAPI_IMPORT_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"action":"search","club_id":123}'
//
// GOLFAPI_IMPORT_SECRET is required (unlike COURSE_IMPORT_SECRET, which is
// optional): the gateway accepts any signed-in member's token, and this
// function spends money.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { importCost, km, mapClubSearch, mapCoordinates, mapCourse, type ClubCandidate, type MappedCourse, type MappedPoint } from "./mapping.ts";

// Unverified until the first trial call — override with GOLFAPI_BASE_URL.
const DEFAULT_BASE = "https://www.golfapi.io/api/v2.3";

type Body =
  | { action: "search"; club_id: number; name?: string }
  | { action: "inspect"; golfapi_course_id: string; gps?: boolean }
  | {
      action: "import";
      club_id: number;
      golfapi_course_ids: string[];
      gps?: boolean;
      max_calls?: number;
      /** Replace a member-entered card for the same tees. Off by default:
       *  a member's card from this year may be righter than the provider's. */
      overwrite_member_cards?: boolean;
      dry_run?: boolean;
    };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

class Golfapi {
  left: number | null = null;
  used = 0;
  constructor(private base: string, private key: string) {}

  async get(path: string, params: Record<string, string> = {}, cost = 1): Promise<unknown> {
    const url = new URL(this.base.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" } });
    this.used += cost;
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Left as text for the error below.
    }
    if (body && typeof body === "object" && "apiRequestsLeft" in body) {
      const n = Number((body as { apiRequestsLeft: unknown }).apiRequestsLeft);
      if (Number.isFinite(n)) this.left = n;
    }
    if (!res.ok) throw new Error(`golfapi ${path} answered ${res.status}: ${String(typeof body === "string" ? body : JSON.stringify(body)).slice(0, 300)}`);
    return body;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("GOLFAPI_IMPORT_SECRET");
  if (!secret) return json({ error: "GOLFAPI_IMPORT_SECRET isn't set; refusing to spend golfapi calls without it" }, 503);
  if (request.headers.get("x-import-secret") !== secret) return json({ error: "forbidden" }, 403);

  const key = Deno.env.get("GOLFAPI_KEY");
  if (!key) return json({ error: "GOLFAPI_KEY isn't set (supabase secrets set GOLFAPI_KEY=…)" }, 503);
  const api = new Golfapi(Deno.env.get("GOLFAPI_BASE_URL") ?? DEFAULT_BASE, key);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "expected a JSON body" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    if (body.action === "search") return json({ ...(await search(db, api, body)), calls_used: api.used, calls_left: api.left });
    if (body.action === "inspect") return json({ ...(await inspect(api, body)), calls_used: api.used, calls_left: api.left });
    if (body.action === "import") return json({ ...(await runImport(db, api, body)), calls_used: api.used, calls_left: api.left });
    return json({ error: "action must be search, inspect or import" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), calls_used: api.used, calls_left: api.left }, 502);
  }
});

type ClubRow = { id: number; name: string; country: string; town: string | null; latitude: number | null; longitude: number | null };

const COUNTRY_NAME: Record<string, string> = {
  ireland: "Ireland",
  "northern-ireland": "United Kingdom",
  england: "United Kingdom",
  scotland: "United Kingdom",
  wales: "United Kingdom",
  spain: "Spain",
  portugal: "Portugal",
};

async function loadClub(db: SupabaseClient, id: number): Promise<ClubRow> {
  const { data, error } = await db.from("clubs").select("id, name, country, town, latitude, longitude").eq("id", id).maybeSingle<ClubRow>();
  if (error) throw error;
  if (!data) throw new Error(`No club ${id}`);
  return data;
}

/** "Portmarnock Golf Club" → "Portmarnock": golfapi's name search is a contains-match. */
const searchName = (name: string) => name.replace(/\b(golf|country|club|links|course|resort|and|&|the|gc|g\.c\.)\b/gi, " ").replace(/\s+/g, " ").trim() || name;

async function search(db: SupabaseClient, api: Golfapi, body: Extract<Body, { action: "search" }>) {
  const club = await loadClub(db, body.club_id);
  const raw = await api.get("/clubs", { name: body.name ?? searchName(club.name), country: COUNTRY_NAME[club.country] ?? "" }, 0.1);
  const here = club.latitude != null && club.longitude != null ? { lat: club.latitude, lng: club.longitude } : null;
  const candidates = mapClubSearch(raw)
    .map((c: ClubCandidate) => ({ ...c, km_away: here && c.lat != null && c.lng != null ? Math.round(km(here, { lat: c.lat, lng: c.lng }) * 10) / 10 : null }))
    .sort((a, b) => (a.km_away ?? 9e9) - (b.km_away ?? 9e9));
  return {
    club: { id: club.id, name: club.name, town: club.town },
    candidates,
    next: "Pick the right club, then call import with its course ids. A match more than ~2 km away is probably a different club.",
  };
}

async function inspect(api: Golfapi, body: Extract<Body, { action: "inspect" }>) {
  const raw = await api.get(`/courses/${encodeURIComponent(body.golfapi_course_id)}`);
  const mapped = mapCourse(raw, 1);
  let coords: unknown = null;
  let mappedPoints: ReturnType<typeof mapCoordinates> | null = null;
  if (body.gps !== false) {
    coords = await api.get(`/coordinates/${encodeURIComponent(body.golfapi_course_id)}`);
    mappedPoints = mapCoordinates(coords);
  }
  return {
    raw_course: raw,
    raw_coordinates: coords,
    mapped_course: mapped.course,
    course_report: mapped.report,
    mapped_points_sample: mappedPoints?.points.slice(0, 12) ?? null,
    points_report: mappedPoints?.report ?? null,
  };
}

async function runImport(db: SupabaseClient, api: Golfapi, body: Extract<Body, { action: "import" }>) {
  const ids = [...new Set((body.golfapi_course_ids ?? []).map(String).filter(Boolean))];
  if (ids.length === 0) throw new Error("golfapi_course_ids is empty — run search first");
  const gps = body.gps !== false;
  const cost = importCost(ids.length, gps);
  const cap = body.max_calls ?? 10;
  if (cost > cap) throw new Error(`This would use ${cost} golfapi calls, over max_calls (${cap}). Raise max_calls to go ahead.`);

  const club = await loadClub(db, body.club_id);
  const results: unknown[] = [];

  for (const id of ids) {
    const raw = await api.get(`/courses/${encodeURIComponent(id)}`);
    const { course, report } = mapCourse(raw, ids.length);
    if (!course) {
      results.push({ golfapi_course_id: id, error: "Couldn't read the course", report });
      continue;
    }
    let points: MappedPoint[] = [];
    let pointsReport = null;
    if (gps) {
      const mapped = mapCoordinates(await api.get(`/coordinates/${encodeURIComponent(id)}`));
      points = mapped.points;
      pointsReport = mapped.report;
    }
    if (body.dry_run) {
      results.push({ golfapi_course_id: id, dry_run: true, course, report, points: points.length, pointsReport });
      continue;
    }
    results.push({ golfapi_course_id: id, ...(await write(db, club, course, points, gps, body.overwrite_member_cards === true)), report, pointsReport });
  }

  return { club: { id: club.id, name: club.name }, results };
}

async function write(db: SupabaseClient, club: ClubRow, course: MappedCourse, points: MappedPoint[], gps: boolean, overwriteMember: boolean) {
  const cards: Array<{ tee: string; outcome: string }> = [];

  for (const tee of course.tees) {
    if (!tee.card) {
      cards.push({ tee: tee.teeName, outcome: "skipped: no complete stroke indexes from the provider" });
      continue;
    }
    const { data: existing, error: findErr } = await db
      .from("course_cards")
      .select("id, source")
      .eq("club_id", club.id)
      .eq("holes", tee.holes)
      .ilike("tee_name", tee.teeName.replace(/[%_]/g, "\\$&"))
      .maybeSingle<{ id: number; source: string }>();
    if (findErr) throw findErr;
    if (existing && existing.source === "member" && !overwriteMember) {
      cards.push({ tee: tee.teeName, outcome: "kept the member's card (overwrite_member_cards to replace)" });
      continue;
    }
    const row = {
      club_id: club.id,
      tee_name: tee.teeName,
      holes: tee.holes,
      par_total: tee.parTotal,
      course_rating: tee.courseRating,
      slope: tee.slope,
      source: "provider",
      submitted_by: null,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    let cardId: number;
    if (existing) {
      const { error } = await db.from("course_cards").update(row).eq("id", existing.id);
      if (error) throw error;
      cardId = existing.id;
    } else {
      const { data, error } = await db.from("course_cards").insert(row).select("id").single<{ id: number }>();
      if (error) throw error;
      cardId = data.id;
    }
    const { error: holesErr } = await db
      .from("course_card_holes")
      .upsert(tee.card.map((h) => ({ card_id: cardId, hole: h.hole, par: h.par, stroke_index: h.strokeIndex })), { onConflict: "card_id,hole" });
    if (holesErr) throw holesErr;
    cards.push({ tee: tee.teeName, outcome: existing ? "updated" : "added" });
  }

  // The layout row is written even without GPS, so the link from our club
  // to golfapi's course id is kept for a later GPS pull or refresh.
  const { data: layout, error: layoutErr } = await db
    .from("course_layouts")
    .upsert(
      {
        club_id: club.id,
        name: course.name,
        holes: course.holes,
        source: "provider",
        provider: "golfapi",
        provider_course_id: course.providerCourseId,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,provider_course_id" }
    )
    .select("id")
    .single<{ id: number }>();
  if (layoutErr) throw layoutErr;

  let pointsWritten = 0;
  if (gps) {
    // Replace, don't merge: a moved green is one row in the provider's data
    // and must not leave its old position behind.
    const { error: delErr } = await db.from("course_layout_points").delete().eq("layout_id", layout.id);
    if (delErr) throw delErr;
    if (points.length > 0) {
      const { error } = await db
        .from("course_layout_points")
        .insert(points.map((p) => ({ layout_id: layout.id, hole: p.hole, kind: p.kind, lat: p.lat, lng: p.lng, label: p.label })));
      if (error) throw error;
      pointsWritten = points.length;
    }
  }

  return { layout_id: layout.id, course: course.name, cards, points_written: pointsWritten };
}
