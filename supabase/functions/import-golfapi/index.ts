// Course data importer — golfapi.io → course cards and hole maps (Oct 2026).
//
// ============ What it does ============
//
//   bulk     (cards only) Many clubs at once: search each, import the
//                        confident matches, list the rest for review
//                        (bulk.ts, progress in golfapi_bulk_clubs, 0147).
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
// Every request needs x-import-secret matching the Vault secret
// `golfapi_import_secret` (0109) — checked here, which is why the function
// is deployed with JWT verification off. From SQL, without the value ever
// being typed:
//
//   select net.http_post(
//     url := 'https://<project>.supabase.co/functions/v1/import-golfapi',
//     headers := jsonb_build_object('Content-Type', 'application/json',
//       'x-import-secret', (select decrypted_secret from vault.decrypted_secrets
//                            where name = 'golfapi_import_secret')),
//     body := '{"action":"search","club_id":605}'::jsonb,
//     timeout_milliseconds := 60000);
//   -- then: select content from net._http_response where id = <that id>;

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { clubCost, decide, nameKey, searchName, type Located } from "./bulk.ts";
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
      /** One course only: what members call it ("Championship"). */
      course_name?: string;
      /** Put the course name on the tees ("Championship · Blue"). */
      prefix_tees?: boolean;
    }
  | {
      /** Cards only (no GPS) for many clubs at once — see bulk.ts for how it
       *  decides, and 0147 for the progress it keeps. */
      action: "bulk";
      /** Clubs to work through in this request (default 20, max 50). */
      limit?: number;
      /** Stop before this request spends more golfapi calls (default 25). */
      max_calls?: number;
      /** Stop while golfapi still has at least this many calls left. */
      keep?: number;
      /** Only these clubs (tests, one-offs). */
      club_ids?: number[];
      /** Try clubs that ended in "error" again. */
      retry_errors?: boolean;
      /** Decide review-list clubs again from their saved candidates (no new
       *  search, so free until a card is fetched) — after a rule change. */
      recheck_review?: boolean;
      /** Search and decide, but fetch no cards and record nothing. */
      dry_run?: boolean;
    };

/** Space between golfapi requests — under its burst limit. */
const MIN_GAP_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

class Golfapi {
  left: number | null = null;
  used = 0;
  constructor(private base: string, private key: string) {}

  private last = 0;

  /**
   * One request, paced and retried. golfapi rate-limits bursts: five
   * searches in quick succession got a 429 on 14 Oct 2026 (and ten at once
   * on 9 Oct). A refused request isn't charged, so a 429 is waited out and
   * retried (2, 5, 10, 20 s) rather than failing the club; only a request
   * that went through counts towards `used`.
   */
  async get(path: string, params: Record<string, string> = {}, cost = 1): Promise<unknown> {
    const url = new URL(this.base.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const waits = [2000, 5000, 10000, 20000];
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      const gap = this.last + MIN_GAP_MS - Date.now();
      if (gap > 0) await sleep(gap);
      this.last = Date.now();
      res = await fetch(url, { headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" } });
      if (res.status !== 429 || attempt >= waits.length) break;
      await res.body?.cancel();
      await sleep(waits[attempt]);
    }
    if (res.status !== 429) this.used += cost;
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

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The caller must know the Vault secret golfapi_import_secret (0109). The
  // function is deployed with JWT checking off, because this is its auth.
  const { data: ok, error: secretErr } = await db.rpc("golfapi_import_secret_ok", { p_secret: request.headers.get("x-import-secret") ?? "" });
  if (secretErr) return json({ error: `Couldn't check the import secret: ${secretErr.message}` }, 503);
  if (ok !== true) return json({ error: "forbidden" }, 403);

  const key = Deno.env.get("GOLFAPI_KEY");
  if (!key) return json({ error: "GOLFAPI_KEY isn't set (Supabase → Edge Functions → Secrets)" }, 503);
  const api = new Golfapi(Deno.env.get("GOLFAPI_BASE_URL") ?? DEFAULT_BASE, key);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "expected a JSON body" }, 400);
  }

  try {
    if (body.action === "search") return json({ ...(await search(db, api, body)), calls_used: api.used, calls_left: api.left });
    if (body.action === "inspect") return json({ ...(await inspect(api, body)), calls_used: api.used, calls_left: api.left });
    if (body.action === "import") return json({ ...(await runImport(db, api, body)), calls_used: api.used, calls_left: api.left });
    if (body.action === "bulk") return json({ ...(await runBulk(db, api, body)), calls_used: Math.round(api.used * 10) / 10, calls_left: api.left });
    return json({ error: "action must be search, inspect, import or bulk" }, 400);
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

/** golfapi's clubs for one of ours, nearest first. 0.1 call. "Portmarnock
 *  Golf Club" is searched as "Portmarnock": golfapi's name search is a
 *  contains-match. */
async function findCandidates(api: Golfapi, club: ClubRow, name?: string): Promise<{ raw: unknown; candidates: Located[] }> {
  const raw = await api.get("/clubs", { name: name ?? searchName(club.name), country: COUNTRY_NAME[club.country] ?? "" }, 0.1);
  const here = club.latitude != null && club.longitude != null ? { lat: club.latitude, lng: club.longitude } : null;
  const candidates = mapClubSearch(raw)
    .map((c: ClubCandidate) => ({ ...c, km_away: here && c.lat != null && c.lng != null ? Math.round(km(here, { lat: c.lat, lng: c.lng }) * 10) / 10 : null }))
    .sort((a, b) => (a.km_away ?? 9e9) - (b.km_away ?? 9e9));
  return { raw, candidates };
}

async function search(db: SupabaseClient, api: Golfapi, body: Extract<Body, { action: "search" }>) {
  const club = await loadClub(db, body.club_id);
  const { raw, candidates } = await findCandidates(api, club, body.name);
  return {
    club: { id: club.id, name: club.name, town: club.town },
    candidates,
    // Nothing matched: show what came back, so a field-name mismatch is visible.
    raw_search: candidates.length === 0 ? raw : undefined,
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

  if (body.course_name && ids.length > 1) throw new Error("course_name names one course; import the others separately");
  const club = await loadClub(db, body.club_id);
  const results: unknown[] = [];

  for (const id of ids) {
    const raw = await api.get(`/courses/${encodeURIComponent(id)}`);
    const { course, report } = mapCourse(raw, ids.length, { name: body.course_name, prefixTees: body.prefix_tees });
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
      .upsert(tee.card.map((h) => ({ card_id: cardId, hole: h.hole, par: h.par, stroke_index: h.strokeIndex, yards: h.yards })), { onConflict: "card_id,hole" });
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

// ============ bulk ============
//
// Cards only, many clubs, as few calls as possible: one search per club
// (0.1), then one call per course of a confident match (bulk.ts decides).
// Progress per club goes to golfapi_bulk_clubs (0147), so a run picks up
// where it stopped and never pays twice for a club. Stops before going over
// max_calls, before golfapi's balance falls below `keep`, at the first
// error from golfapi (a 429 or an empty balance would fail every club after
// it), and before the Edge Function's time limit.

const BULK_TIME_MS = 110_000;

type BulkClub = ClubRow & { has_provider_cards: boolean; saved_candidates: Located[] | null };

async function runBulk(db: SupabaseClient, api: Golfapi, body: Extract<Body, { action: "bulk" }>) {
  const started = Date.now();
  const limit = Math.max(1, Math.min(50, Math.floor(body.limit ?? 20)));
  const maxCalls = body.max_calls ?? 25;
  const keep = body.keep ?? 0;
  const dry = body.dry_run === true;

  const { data: due, error: dueErr } = await db.rpc("golfapi_bulk_next", {
    p_limit: limit,
    p_club_ids: body.club_ids?.length ? body.club_ids : null,
    p_retry_errors: body.retry_errors === true,
    p_recheck_review: body.recheck_review === true,
  });
  if (dueErr) throw dueErr;
  const clubs = (due ?? []) as BulkClub[];
  const namesakes = await ourNameCounts(db);

  const done: unknown[] = [];
  let stopped: string | null = null;

  const record = async (clubId: number, row: Record<string, unknown>) => {
    if (dry) return;
    const { error } = await db.from("golfapi_bulk_clubs").upsert({ club_id: clubId, ...row, updated_at: new Date().toISOString() }, { onConflict: "club_id" });
    if (error) throw error;
  };
  /** Would spending `cost` more break a limit? Says which, or null. */
  const over = (cost: number): string | null => {
    if (api.used + cost > maxCalls + 1e-9) return `max_calls (${maxCalls}) reached`;
    if (api.left != null && api.left - cost < keep - 1e-9) return `golfapi balance would fall below keep (${keep}); ${api.left} left`;
    return null;
  };

  for (const club of clubs) {
    if (Date.now() - started > BULK_TIME_MS) {
      stopped = "time limit for one request — call bulk again to carry on";
      break;
    }
    if (club.has_provider_cards) {
      await record(club.id, { status: "skipped", reason: "already has provider cards", calls: 0 });
      done.push({ club_id: club.id, name: club.name, status: "skipped", reason: "already has provider cards" });
      continue;
    }
    const saved = club.saved_candidates?.length ? club.saved_candidates : null;
    const searchStop = saved ? null : over(0.1);
    if (searchStop) {
      stopped = searchStop;
      break;
    }

    const usedBefore = api.used;
    let candidates: Located[] = [];
    try {
      candidates = saved ?? (await findCandidates(api, club)).candidates;
      const decision = decide(candidates, club.latitude != null && club.longitude != null, club.name, namesakes.get(nameGroup(club.country, club.name)) ?? 1);

      if (decision.kind === "review") {
        await record(club.id, { status: "review", reason: decision.reason, candidates: decision.candidates.slice(0, 20), calls: saved ? 0 : clubCost(1, 0) });
        done.push({ club_id: club.id, name: club.name, status: "review", reason: decision.reason });
        continue;
      }

      // The directory has some clubs twice ("Elm Park Golf Club" / "Elm Park
      // Golf and Sports Club"). Don't pay twice for one golfapi club.
      const twin = await alreadyImportedAs(db, club.id, decision.candidate.providerClubId, decision.courseIds);
      if (twin != null) {
        const reason = `same golfapi club as our club ${twin} — a duplicate in our directory?`;
        await record(club.id, { status: "review", reason, provider_club_id: decision.candidate.providerClubId, candidates: [decision.candidate], calls: saved ? 0 : clubCost(1, 0) });
        done.push({ club_id: club.id, name: club.name, status: "review", reason });
        continue;
      }

      const cost = decision.courseIds.length;
      const cardStop = over(cost);
      if (cardStop) {
        // The search is spent; the club stays due (no row) and is searched
        // again next time — 0.1 wasted, rather than half a club imported.
        stopped = cardStop;
        break;
      }
      if (dry) {
        done.push({ club_id: club.id, name: club.name, status: "would import", golfapi_club: decision.candidate.name, km_away: decision.candidate.km_away, courses: decision.candidate.courses.map((c) => c.name) });
        continue;
      }

      const imported: unknown[] = [];
      let cardsWritten = 0;
      for (const id of decision.courseIds) {
        const raw = await api.get(`/courses/${encodeURIComponent(id)}`);
        const { course, report } = mapCourse(raw, decision.courseIds.length);
        if (!course) {
          imported.push({ golfapi_course_id: id, error: "couldn't read the course", missing: report.missing });
          continue;
        }
        const result = await write(db, club, course, [], false, false);
        cardsWritten += result.cards.filter((c) => c.outcome === "added" || c.outcome === "updated").length;
        imported.push({ golfapi_course_id: id, course: result.course, cards: result.cards });
      }
      const calls = Math.round((api.used - usedBefore) * 10) / 10;
      const status = cardsWritten > 0 ? "imported" : "review";
      const kept = imported.some((i) => (i as { cards?: Array<{ outcome: string }> }).cards?.some((c) => c.outcome.startsWith("kept")));
      const reason = cardsWritten > 0 ? null : kept ? "only tees a member had already entered — kept theirs" : "golfapi's cards have no complete stroke indexes";
      await record(club.id, { status, reason, provider_club_id: decision.candidate.providerClubId, candidates: [decision.candidate], imported, calls });
      done.push({ club_id: club.id, name: club.name, status, reason, golfapi_club: decision.candidate.name, km_away: decision.candidate.km_away, cards: cardsWritten, calls });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const calls = Math.round((api.used - usedBefore) * 10) / 10;
      await record(club.id, { status: "error", reason: message.slice(0, 500), candidates: candidates.slice(0, 20), calls });
      done.push({ club_id: club.id, name: club.name, status: "error", reason: message });
      if (message.startsWith("golfapi ")) {
        stopped = "golfapi refused a request — stopped so the rest aren't failed too";
        break;
      }
    }
  }

  const { data: totals } = dry ? { data: null } : await db.from("golfapi_bulk_clubs").select("status");
  const summary: Record<string, number> = {};
  for (const r of (totals ?? []) as Array<{ status: string }>) summary[r.status] = (summary[r.status] ?? 0) + 1;

  return { dry_run: dry, clubs: done, stopped, more: clubs.length === limit || stopped != null, totals_so_far: dry ? undefined : summary };
}

/** Another of our clubs that already has this golfapi club's cards, or null. */
async function alreadyImportedAs(db: SupabaseClient, clubId: number, providerClubId: string, courseIds: string[]): Promise<number | null> {
  const { data: bulk, error: e1 } = await db
    .from("golfapi_bulk_clubs")
    .select("club_id")
    .eq("provider_club_id", providerClubId)
    .eq("status", "imported")
    .neq("club_id", clubId)
    .limit(1);
  if (e1) throw e1;
  if (bulk?.length) return (bulk[0] as { club_id: number }).club_id;
  const { data: layouts, error: e2 } = await db
    .from("course_layouts")
    .select("club_id")
    .eq("provider", "golfapi")
    .in("provider_course_id", courseIds)
    .neq("club_id", clubId)
    .limit(1);
  if (e2) throw e2;
  return layouts?.length ? (layouts[0] as { club_id: number }).club_id : null;
}

/** A club's name key within golfapi's country (the UK is one country there). */
const nameGroup = (country: string, name: string) => `${COUNTRY_NAME[country] ?? country}|${nameKey(name)}`;

/** How many of our clubs share each name key, per golfapi country. */
async function ourNameCounts(db: SupabaseClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("clubs").select("name, country").order("id").range(from, from + 999);
    if (error) throw error;
    for (const c of (data ?? []) as Array<{ name: string; country: string }>) {
      const k = nameGroup(c.country, c.name);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (!data || data.length < 1000) break;
  }
  return counts;
}
