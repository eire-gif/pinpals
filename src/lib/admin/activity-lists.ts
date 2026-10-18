import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardSummary, type ActivityKind, type CardHole } from "./live-panel";

// The lists behind the live panel's numbers (/admin/activity) and the
// scorecard page (/admin/scorecards/[id]). Super admin only — each page
// calls requireStaff({ roles: LIVE_PANEL_ROLES }) before any of this runs.
// Read with the service role: a private scorecard is still listed here.

const LIMIT = 200;

type Window = { from: Date; to: Date };
type Person = { id: string; name: string };

async function people(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, Person>();
  if (!unique.length) return map;
  const { data } = await createAdminClient().from("profiles").select("id, first_name, last_name").in("id", unique);
  for (const p of data ?? []) {
    map.set(p.id, { id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Former member" });
  }
  return map;
}

export type ScorecardRow = {
  id: number;
  member: Person | null;
  course_name: string;
  tee_name: string | null;
  holes: number;
  played_on: string;
  source: string;
  team_card: string | null;
  visibility: string;
  created_at: string;
  gross: number;
  played: number;
  toPar: number;
  complete: boolean;
  certified_by: string | null;
};

export type GameRow = {
  id: number;
  course_name: string;
  format: string;
  holes: number;
  status: string;
  created_at: string;
  finished_at: string | null;
  starter: Person | null;
  players: string[];
  thru: number;
  scorecard_ids: number[];
};

export type SimpleRow = {
  id: string | number;
  title: string;
  sub: string;
  who: Person | null;
  at: string;
  href: string;
  status?: string;
};

export type ActivityList =
  | { kind: "scorecards"; rows: ScorecardRow[] }
  | { kind: "games"; rows: GameRow[] }
  | { kind: Exclude<ActivityKind, "scorecards" | "games">; rows: SimpleRow[] };

export async function listActivity(kind: ActivityKind, w: Window): Promise<ActivityList> {
  switch (kind) {
    case "scorecards":
      return { kind, rows: await listScorecards(w) };
    case "games":
      return { kind, rows: await listGames(w) };
    default:
      return { kind, rows: await listSimple(kind, w) };
  }
}

async function certifiers(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!ids.length) return map;
  const { data } = await createAdminClient()
    .from("scorecard_certifications")
    .select("scorecard_id, certifier_name, status")
    .in("scorecard_id", ids)
    .eq("status", "certified");
  for (const c of data ?? []) map.set(c.scorecard_id, c.certifier_name);
  return map;
}

async function listScorecards(w: Window): Promise<ScorecardRow[]> {
  const admin = createAdminClient();
  const { data: cards, error } = await admin
    .from("scorecards")
    .select("id, member_id, course_name, tee_name, holes, played_on, source, team_card, visibility, created_at")
    .gte("created_at", w.from.toISOString())
    .lt("created_at", w.to.toISOString())
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  const rows = cards ?? [];
  const ids = rows.map((c) => c.id);
  const [{ data: holes }, who, certified] = await Promise.all([
    ids.length
      ? admin.from("scorecard_holes").select("scorecard_id, hole, par, strokes, putts").in("scorecard_id", ids)
      : Promise.resolve({ data: [] as { scorecard_id: number; hole: number; par: number; strokes: number | null; putts: number | null }[] }),
    people(rows.map((c) => c.member_id)),
    certifiers(ids),
  ]);
  const byCard = new Map<number, CardHole[]>();
  for (const h of holes ?? []) {
    const list = byCard.get(h.scorecard_id) ?? [];
    list.push(h);
    byCard.set(h.scorecard_id, list);
  }
  return rows.map((c) => {
    const s = cardSummary(byCard.get(c.id) ?? [], c.holes);
    return {
      ...c,
      member: who.get(c.member_id) ?? null,
      gross: s.gross,
      played: s.played,
      toPar: s.toPar,
      complete: s.complete,
      certified_by: certified.get(c.id) ?? null,
    };
  });
}

async function listGames(w: Window): Promise<GameRow[]> {
  const admin = createAdminClient();
  const { data: rounds, error } = await admin
    .from("live_rounds")
    .select("id, created_by, course_name, format, holes, status, created_at, finished_at")
    .gte("created_at", w.from.toISOString())
    .lt("created_at", w.to.toISOString())
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  const rows = rounds ?? [];
  const ids = rows.map((r) => r.id);
  const [{ data: players }, { data: scores }, { data: cards }, who] = await Promise.all([
    ids.length
      ? admin.from("live_round_players").select("round_id, display_name, position").in("round_id", ids).order("position")
      : Promise.resolve({ data: [] as { round_id: number; display_name: string; position: number }[] }),
    ids.length
      ? admin.from("live_round_scores").select("round_id, hole").in("round_id", ids)
      : Promise.resolve({ data: [] as { round_id: number; hole: number }[] }),
    ids.length
      ? admin.from("scorecards").select("id, live_round_id").in("live_round_id", ids)
      : Promise.resolve({ data: [] as { id: number; live_round_id: number | null }[] }),
    people(rows.map((r) => r.created_by)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    course_name: r.course_name,
    format: r.format,
    holes: r.holes,
    status: r.status,
    created_at: r.created_at,
    finished_at: r.finished_at,
    starter: r.created_by ? who.get(r.created_by) ?? null : null,
    players: (players ?? []).filter((p) => p.round_id === r.id).map((p) => p.display_name),
    thru: Math.max(0, ...(scores ?? []).filter((s) => s.round_id === r.id).map((s) => s.hole)),
    scorecard_ids: (cards ?? []).filter((c) => c.live_round_id === r.id).map((c) => c.id),
  }));
}

function euro(cents: number | null, eur: number | null): string {
  const v = cents != null ? cents / 100 : eur;
  return v == null ? "" : new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function snippet(text: string | null, n = 90): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const GROUP_KINDS: Record<string, string> = { crew: "Golf Buddies", trip: "Golf trip", society: "Society", area: "Area", club: "Club" };

async function listSimple(kind: Exclude<ActivityKind, "scorecards" | "games">, w: Window): Promise<SimpleRow[]> {
  const admin = createAdminClient();
  const from = w.from.toISOString();
  const to = w.to.toISOString();

  if (kind === "tee_times") {
    const { data, error } = await admin
      .from("tee_time_invites")
      .select("id, member_id, club_name, play_date, exact_tee_time, time_from, spaces_available, status, created_at")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw new Error(error.message);
    const who = await people((data ?? []).map((t) => t.member_id));
    return (data ?? []).map((t) => ({
      id: t.id,
      title: t.club_name,
      sub: `${new Date(`${t.play_date}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}${
        t.exact_tee_time || t.time_from ? ` · ${(t.exact_tee_time ?? t.time_from ?? "").slice(0, 5)}` : ""
      } · ${t.spaces_available} ${t.spaces_available === 1 ? "space" : "spaces"}`,
      who: who.get(t.member_id) ?? null,
      at: t.created_at,
      href: `/admin/tee-times/${t.id}`,
      status: t.status,
    }));
  }

  if (kind === "groups") {
    const { data, error } = await admin
      .from("groups")
      .select("id, kind, name, member_count, privacy, created_by, created_at, hidden_at")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw new Error(error.message);
    const who = await people((data ?? []).map((g) => g.created_by));
    return (data ?? []).map((g) => ({
      id: g.id,
      title: g.name,
      sub: `${GROUP_KINDS[g.kind] ?? g.kind} · ${g.member_count} ${g.member_count === 1 ? "member" : "members"}`,
      who: g.created_by ? who.get(g.created_by) ?? null : null,
      at: g.created_at,
      href: `/admin/groups/${g.id}`,
      status: g.hidden_at ? "hidden" : undefined,
    }));
  }

  if (kind === "members") {
    const { data, error } = await admin
      .from("profiles")
      .select("id, first_name, last_name, county, created_at, deleted_at")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => {
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "New member (no name yet)";
      return {
        id: p.id,
        title: name,
        sub: p.county ?? "",
        who: null,
        at: p.created_at,
        href: `/admin/users/${p.id}`,
        status: p.deleted_at ? "deleted" : undefined,
      };
    });
  }

  if (kind === "listings") {
    const { data, error } = await admin
      .from("listings")
      .select("id, seller_id, title, price_cents, price_eur, category, county, status, created_at")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw new Error(error.message);
    const who = await people((data ?? []).map((l) => l.seller_id));
    return (data ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      sub: [euro(l.price_cents, l.price_eur), l.category, l.county].filter(Boolean).join(" · "),
      who: who.get(l.seller_id) ?? null,
      at: l.created_at,
      href: `/admin/listings/${l.id}`,
      status: l.status,
    }));
  }

  // posts
  const { data, error } = await admin
    .from("posts")
    .select("id, author_id, body, kind, like_count, comment_count, hidden_at, created_at")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  const who = await people((data ?? []).map((p) => p.author_id));
  return (data ?? []).map((p) => ({
    id: p.id,
    title: snippet(p.body) || "(photo or video)",
    sub: `${p.like_count} reactions · ${p.comment_count} comments`,
    who: who.get(p.author_id) ?? null,
    at: p.created_at,
    href: `/admin/feed?postId=${p.id}`,
    status: p.hidden_at ? "hidden" : undefined,
  }));
}

// ---------------------------------------------------------------------------
// One scorecard, hole by hole.
// ---------------------------------------------------------------------------

export type ScorecardDetail = {
  card: {
    id: number;
    member: Person | null;
    course_name: string;
    tee_name: string | null;
    holes: number;
    played_on: string;
    par_total: number | null;
    course_rating: number | null;
    slope: number | null;
    handicap_index: number | null;
    playing_handicap: number | null;
    source: string;
    team_card: string | null;
    visibility: string;
    live_round_id: number | null;
    created_at: string;
    updated_at: string;
  };
  holes: { hole: number; par: number; stroke_index: number | null; yards: number | null; strokes: number | null; putts: number | null }[];
  certifications: { certifier_name: string; status: string; method: string | null; requested_at: string; query_hole: number | null; query_note: string | null }[];
  playingPartners: string[];
};

export async function getScorecardDetail(id: number): Promise<ScorecardDetail | null> {
  const admin = createAdminClient();
  const { data: card } = await admin
    .from("scorecards")
    .select(
      "id, member_id, course_name, tee_name, holes, played_on, par_total, course_rating, slope, handicap_index, playing_handicap, source, team_card, visibility, live_round_id, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!card) return null;
  const [{ data: holes }, { data: certs }, who, { data: partners }] = await Promise.all([
    admin.from("scorecard_holes").select("hole, par, stroke_index, yards, strokes, putts").eq("scorecard_id", id).order("hole"),
    admin
      .from("scorecard_certifications")
      .select("certifier_name, status, method, requested_at, query_hole, query_note")
      .eq("scorecard_id", id)
      .order("requested_at", { ascending: false }),
    people([card.member_id]),
    card.live_round_id
      ? admin.from("live_round_players").select("display_name, member_id, position").eq("round_id", card.live_round_id).order("position")
      : Promise.resolve({ data: [] as { display_name: string; member_id: string | null; position: number }[] }),
  ]);
  const { member_id, ...rest } = card;
  return {
    card: { ...rest, member: who.get(member_id) ?? null },
    holes: holes ?? [],
    certifications: certs ?? [],
    playingPartners: (partners ?? []).filter((p) => p.member_id !== member_id).map((p) => p.display_name),
  };
}
