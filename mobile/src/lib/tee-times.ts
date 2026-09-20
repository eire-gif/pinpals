import { supabase } from "./supabase";

/**
 * Every tee-time read the app makes, in one place.
 *
 * Nothing here re-implements a rule. Visibility — connections-only, ladies-only,
 * who may see a confirmed fourball — is enforced by RLS on `tee_time_invites`
 * (migrations 0065, 0066, 0074, 0078). If a member can't see an invite, these
 * queries return fewer rows; they never decide that themselves. See §4.1 of
 * claude/ios-app-build-spec.md.
 */

export type Invite = {
  id: number;
  member_id: string;
  club_name: string | null;
  club_id: number | null;
  play_date: string;
  time_from: string | null;
  time_to: string | null;
  exact_tee_time: string | null;
  spaces_available: number;
  has_tee_time_booked: boolean;
  handicap_limit: number | null;
  notes: string | null;
  county: string | null;
  ladies_only: boolean;
  host: {
    first_name: string | null;
    last_name: string | null;
    home_club: string | null;
    handicap: number | null;
    handicap_visible: boolean | null;
    /** A full public Storage URL, or null. `avatar_color` is the fallback
     *  and every member has one, so the initials treatment is the normal
     *  case rather than the empty one. */
    avatar_url: string | null;
    avatar_color: string | null;
  } | null;
  club: {
    name: string;
    town: string | null;
    region: string | null;
    holes: number | null;
  } | null;
  /** Only set when the list came from a location search. */
  distance_km?: number;
};

const SELECT = `
  id, member_id, club_name, club_id, play_date, time_from, time_to,
  exact_tee_time, spaces_available, has_tee_time_booked, handicap_limit,
  notes, county, ladies_only,
  host:profiles!tee_time_invites_member_id_fkey (
    first_name, last_name, home_club, handicap, handicap_visible,
    avatar_url, avatar_color
  ),
  club:clubs!tee_time_invites_club_id_fkey (name, town, region, holes)
`;

/** Local calendar date as YYYY-MM-DD. Not `toISOString()`, which is UTC and so
 *  drops a day during Irish summer time. */
export const todayIso = (): string => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const openAndUpcoming = <T>(q: T): T =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any)
    .eq("status", "open")
    .gte("play_date", todayIso())
    .gt("spaces_available", 0);

export async function listInvites(limit = 50): Promise<Invite[]> {
  const { data, error } = await openAndUpcoming(
    supabase.from("tee_time_invites").select(SELECT)
  )
    .order("play_date", { ascending: true })
    .order("time_from", { ascending: true, nullsFirst: false })
    .limit(limit)
    .overrideTypes<Invite[]>();

  if (error) throw error;
  return data ?? [];
}

/**
 * Tee times near a point.
 *
 * `invites_near` is a plain STABLE function, not SECURITY DEFINER, so RLS still
 * applies to it — but it filters on distance ALONE. It happily returns invites
 * that are cancelled, full, or in the past, and it can only see invites whose
 * club has coordinates. So it is used purely as a source of ids and distances,
 * and the real filtering stays in the query below, identical to listInvites().
 * Get this wrong and the "near me" list quietly shows different rules from the
 * main one.
 */
export async function listInvitesNear(
  lat: number,
  lng: number,
  radiusKm = 50,
  limit = 50
): Promise<Invite[]> {
  const { data: near, error: nearError } = await supabase.rpc("invites_near", {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
  });

  if (nearError) throw nearError;

  // Typed by assertion rather than `.overrideTypes()`: that helper refuses to
  // cast an RPC result to an array type, even when the function returns TABLE
  // and the result genuinely is one. The shape is pinned by the function
  // signature in migration 0068_invites_near.sql.
  const rows = (near ?? []) as { invite_id: number; distance_km: number }[];
  if (rows.length === 0) return [];

  const distances = new Map<number, number>(
    rows.map((r) => [r.invite_id, r.distance_km])
  );

  const { data, error } = await openAndUpcoming(
    supabase.from("tee_time_invites").select(SELECT)
  )
    .in("id", Array.from(distances.keys()))
    .limit(limit)
    .overrideTypes<Invite[]>();

  if (error) throw error;

  return (data ?? [])
    .map((invite) => ({ ...invite, distance_km: distances.get(invite.id) }))
    .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
}

export async function getInvite(id: number): Promise<Invite | null> {
  const { data, error } = await supabase
    .from("tee_time_invites")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<Invite>();

  if (error) throw error;
  return data;
}

// ===========================================================================
// Formatting — shared by the list and the detail screen so they can never
// disagree about how a tee time reads.
// ===========================================================================

/** "14:30:00" → "2:30pm". Times are wall-clock, stored without a zone. */
export const clockTime = (value: string | null): string | null => {
  if (!value) return null;
  const [h, m] = value.split(":");
  const hour = Number.parseInt(h, 10);
  if (!Number.isFinite(hour)) return null;
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return m === "00" ? `${twelve}${suffix}` : `${twelve}:${m}${suffix}`;
};

export const whenLabel = (invite: Invite): string => {
  const exact = clockTime(invite.exact_tee_time);
  if (exact) return exact;
  const from = clockTime(invite.time_from);
  const to = clockTime(invite.time_to);
  if (from && to) return `${from} – ${to}`;
  return from ?? "Time flexible";
};

/** Parsed as local midnight: `new Date("2026-09-20")` is UTC midnight, which
 *  renders as the 19th in Ireland during BST. */
export const parseDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  return new Date(y, m - 1, d);
};

export const dateLabel = (iso: string, long = false): string =>
  parseDate(iso).toLocaleDateString("en-IE", {
    weekday: long ? "long" : "short",
    day: "numeric",
    month: long ? "long" : "short",
  });

export const hostName = (invite: Invite): string =>
  [invite.host?.first_name, invite.host?.last_name].filter(Boolean).join(" ");

export const distanceLabel = (km?: number): string | null => {
  if (km === undefined) return null;
  return km < 1 ? "under 1 km away" : `${Math.round(km)} km away`;
};
