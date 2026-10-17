import { useCallback, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

import { postToSite } from "./api";
import { FALLBACK_ACCESS, canUse, parseAgeAccess, type AgeAccess, type AgeFeature } from "./age-rules";
import { isOn } from "./features";
import { listConnections, type Member } from "./members";
import { supabase } from "./supabase";

/**
 * Junior members (claude/junior-members.md, needs 0159): what this member
 * may do, by age. Reads my_age_access() and keeps the answer for five
 * minutes, like lib/membership.ts, so "can I show Tee Times?" costs nothing
 * on every render. Pure parsing and the helper predicates are in
 * age-rules.ts.
 *
 * FAILING OPEN, AND WHEN IT MUSTN'T. With no answer at all (offline on the
 * very first launch, or the `ageBands` flag off) screens draw as for an
 * adult: that is how every member was treated before 0159, and the database
 * refuses whatever a minor can't do regardless. But once the server has said
 * "waiting for your parent" or "we need your date of birth", a dropped
 * signal must not quietly let the member past that screen — so a failed
 * refresh keeps the last answer, and the last answer is also kept on the
 * phone (SecureStore, per member) for a cold start with no signal.
 */

const FRESH_MS = 5 * 60 * 1000;
const STORE_KEY = "pinpals.age-access";

type Snapshot = {
  access: AgeAccess;
  /** True when it came from the server (now or on an earlier launch). */
  known: boolean;
  at: number;
};

const FALLBACK: Snapshot = { access: FALLBACK_ACCESS, known: false, at: 0 };

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;
const listeners = new Set<(s: Snapshot) => void>();

function publish(s: Snapshot): Snapshot {
  cache = s;
  listeners.forEach((l) => l(s));
  return s;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** The last answer this phone had for this member, for a cold start offline. */
async function remembered(userId: string | null): Promise<Snapshot | null> {
  if (!userId) return null;
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { userId?: unknown; access?: unknown };
    if (v.userId !== userId) return null;
    const access = parseAgeAccess(v.access);
    // at: 0 — stale, so the next call asks the server again.
    return access ? { access, known: true, at: 0 } : null;
  } catch {
    return null;
  }
}

async function remember(userId: string | null, raw: unknown): Promise<void> {
  if (!userId) return;
  try {
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ userId, access: raw }));
  } catch {
    // Not kept: a cold start offline falls back to the adult-like default,
    // and the database still refuses anything a minor can't do.
  }
}

async function fetchSnapshot(): Promise<Snapshot> {
  const userId = await currentUserId();
  if (!userId) return FALLBACK;
  const { data, error } = await supabase.rpc("my_age_access");
  const access = error ? null : parseAgeAccess(data);
  if (!access) {
    // Keep what we knew — in memory first, then on the phone.
    return cache?.known ? { ...cache, at: 0 } : ((await remembered(userId)) ?? FALLBACK);
  }
  void remember(userId, data);
  return { access, known: true, at: Date.now() };
}

/** The current answer, fetched if stale. Pass `force` after anything that changes it. */
export async function loadAgeAccess(force = false): Promise<Snapshot> {
  if (!isOn("ageBands")) return FALLBACK;
  if (!force && cache && cache.at > 0 && Date.now() - cache.at < FRESH_MS) return cache;
  if (!inflight) {
    inflight = fetchSnapshot()
      .then(publish)
      .catch(() => cache ?? FALLBACK)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** A fresh answer the server handed back some other way (set_my_date_of_birth). */
export async function acceptAgeAccess(raw: unknown): Promise<AgeAccess | null> {
  const access = parseAgeAccess(raw);
  if (!access) return null;
  publish({ access, known: true, at: Date.now() });
  void remember(await currentUserId(), raw);
  return access;
}

/** Forget the answer — on sign-out, so the next member doesn't inherit it. */
export function clearAgeAccess(): void {
  // Screens still mounted (the root layout) drop the old member's answer
  // now, not when the next member's arrives.
  listeners.forEach((l) => l(FALLBACK));
  cache = null;
  void SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined);
}

/**
 * This member's age access, kept up to date across screens.
 *
 * `allows(feature)` is what screens ask: true until an answer says
 * otherwise (see the note at the top). `loaded` is false until the first
 * answer (or the fallback) is in.
 */
export function useAgeAccess() {
  const [snap, setSnap] = useState<Snapshot | null>(isOn("ageBands") ? cache : FALLBACK);

  useEffect(() => {
    if (!isOn("ageBands")) return;
    const l = (s: Snapshot) => setSnap(s);
    listeners.add(l);
    void loadAgeAccess().then(setSnap);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const access = snap?.access ?? FALLBACK_ACCESS;
  const refresh = useCallback(() => loadAgeAccess(true).then((s) => (setSnap(s), s.access)), []);
  const allows = useCallback((feature: AgeFeature) => canUse(access, feature), [access]);

  return { access, loaded: snap !== null, known: snap?.known ?? false, allows, refresh };
}

// ---------------------------------------------------------------------------
// The calls the age screens make
// ---------------------------------------------------------------------------

/** An existing member enters their date of birth, once (set_my_date_of_birth). */
export async function setMyDateOfBirth(iso: string): Promise<AgeAccess> {
  const { data, error } = await supabase.rpc("set_my_date_of_birth", { p_date: iso });
  if (error) throw new Error(error.message || "Couldn't save your date of birth.");
  const access = await acceptAgeAccess(data);
  if (access) return access;
  return (await loadAgeAccess(true)).access;
}

/** A 13–15 year old sends the parent link (again, or to a new address). */
export async function sendParentLink(email: string): Promise<void> {
  await postToSite<{ ok?: boolean }>("/api/app/age/parent", { email: email.trim() });
  await loadAgeAccess(true);
}

/** "Ask a parent" on a listing. `{ sent: false }` when there's no parent to send it to. */
export const askParentAbout = (listingId: number) =>
  postToSite<{ sent?: boolean }>("/api/app/age/ask-parent", { listingId });

/** A junior's approved contacts — the PinPals their parent says they may play with. */
export type JuniorContact = { id: string; name: string; avatarUrl: string | null; avatarColor: string | null };

export async function myApprovedContacts(me: string): Promise<JuniorContact[]> {
  const { data, error } = await supabase.rpc("junior_contact_list", { p_junior: me });
  if (error) throw error;
  type Row = { contact_id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null; approved: boolean };
  return ((data ?? []) as Row[])
    .filter((r) => r.approved)
    .map((r) => ({
      id: r.contact_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "A member",
      avatarUrl: r.avatar_url,
      avatarColor: r.avatar_color,
    }));
}

/** My approved parent, if any (guardian_links is readable by the junior). */
export async function myParent(me: string): Promise<JuniorContact | null> {
  const { data } = await supabase
    .from("guardian_links")
    .select("guardian:profiles!guardian_links_guardian_id_fkey (id, first_name, last_name, avatar_url, avatar_color)")
    .eq("junior_id", me)
    .eq("status", "approved")
    .maybeSingle()
    .overrideTypes<{ guardian: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null } | null }>();
  const g = data?.guardian;
  if (!g) return null;
  return { id: g.id, name: [g.first_name, g.last_name].filter(Boolean).join(" ") || "Your parent", avatarUrl: g.avatar_url, avatarColor: g.avatar_color };
}

/**
 * The PinPals a member may put in a round (live scoring's "Add a PinPal").
 *
 * Everyone 16 and over: their accepted connections, as before. A 13–15 year
 * old has no connections; they play with their parent and the contacts
 * their parent has approved (junior_contact_list), and the database
 * (age_guard, live_player) holds them to it. Group mates still come from the
 * group screens as now; guests by name are always allowed.
 */
export async function pinPalsToPlayWith(userId: string): Promise<Member[]> {
  const { access } = await loadAgeAccess();
  if (access.can.playWith !== "approved") return (await listConnections(userId)).accepted;

  const [parent, contacts] = await Promise.all([myParent(userId).catch(() => null), myApprovedContacts(userId).catch(() => [])]);
  const people = [...(parent ? [parent] : []), ...contacts.filter((c) => c.id !== parent?.id)];
  if (people.length === 0) return [];

  // Handicaps, where they share them — the same rule as everywhere else.
  const { data } = await supabase
    .from("profiles")
    .select("id, handicap, handicap_visible, home_club, county, country")
    .in("id", people.map((p) => p.id))
    .overrideTypes<{ id: string; handicap: number | null; handicap_visible: boolean | null; home_club: string | null; county: string | null; country: string | null }[]>();
  const byId = new Map((data ?? []).map((r) => [r.id, r]));
  return people.map((p) => {
    const row = byId.get(p.id);
    return {
      id: p.id,
      name: p.name,
      homeClub: row?.home_club ?? null,
      county: row?.county ?? null,
      country: row?.country ?? null,
      handicap: row?.handicap_visible ? (row.handicap ?? null) : null,
      avatarUrl: p.avatarUrl,
      avatarColor: p.avatarColor,
      ageBand: null,
    };
  });
}
