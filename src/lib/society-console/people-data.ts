import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isGroupOffice, type GroupOffice, type GroupRole } from "./rules";
import { ALERT_PREFS, type AlertPrefKind } from "./people-rules";

/**
 * Extra reads for the console's members, handicaps and settings pages — the
 * same tables and functions the app reads (mobile/src/lib/mobile-number.ts,
 * groups-data.ts, society.ts, live-rounds.ts), with the member's own client.
 */

type Db = SupabaseClient;

export type GroupContact = { memberId: string; name: string; role: GroupRole; office: GroupOffice | null; phone: string };

/** Numbers members chose to share with this society (0134's group_contacts). */
export async function loadContacts(db: Db, groupId: number): Promise<GroupContact[] | null> {
  const { data, error } = await db.rpc("group_contacts", { p_group_id: groupId });
  if (error) return null;
  return ((data ?? []) as { member_id: string; first_name: string | null; last_name: string | null; role: GroupRole; office: string | null; phone: string }[]).map((r) => ({
    memberId: r.member_id,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "A member",
    role: r.role,
    office: isGroupOffice(r.office) ? r.office : null,
    phone: r.phone,
  }));
}

/** The society's invite code, made on first ask (0120's group_invite_code — owner and admins). */
export async function loadInviteCode(db: Db, groupId: number): Promise<string | null> {
  const { data, error } = await db.rpc("group_invite_code", { p_group_id: groupId });
  if (error || data == null) return null;
  return String(data);
}

/** Your own mute switch and society alert settings (on unless switched off). */
export async function loadMyAlerts(db: Db, groupId: number, userId: string): Promise<{ muted: boolean; prefs: Record<AlertPrefKind, boolean> }> {
  const [me, prefs] = await Promise.all([
    db.from("group_members").select("muted").eq("group_id", groupId).eq("member_id", userId).maybeSingle<{ muted: boolean | null }>(),
    db.from("society_alert_prefs").select("kind, enabled").eq("group_id", groupId).eq("member_id", userId).overrideTypes<{ kind: AlertPrefKind; enabled: boolean }[]>(),
  ]);
  const map = new Map((prefs.data ?? []).map((p) => [p.kind, p.enabled]));
  const out = {} as Record<AlertPrefKind, boolean>;
  for (const p of ALERT_PREFS) out[p.kind] = map.get(p.kind) ?? true;
  return { muted: !!me.data?.muted, prefs: out };
}

export type CourseCardTee = { id: number; teeName: string; holes: number; parTotal: number | null; courseRating: number | null; slope: number | null; verified: boolean };

/** Every saved card (tee) for a club, as the app's loadCourseCards — one club per call through course_cards_for_club (0149); the tables are closed to members (0150). */
export async function loadCourseTees(db: Db, clubId: number): Promise<CourseCardTee[]> {
  const { data, error } = await db.rpc("course_cards_for_club", { p_club_id: clubId });
  if (error) return [];
  const rows = (data ?? []) as { id: number; tee_name: string; holes: number; par_total: number | null; course_rating: number | string | null; slope: number | null; verified_at: string | null }[];
  return rows.map((c) => ({
    id: c.id,
    teeName: c.tee_name,
    holes: c.holes === 9 ? 9 : 18,
    parTotal: c.par_total,
    courseRating: c.course_rating == null ? null : Number(c.course_rating),
    slope: c.slope,
    verified: c.verified_at != null,
  }));
}

export type ClubHit = { id: number; name: string; place: string | null };

/** Clubs by name, for the handicaps page's course picker (clubs is world-readable). */
export async function searchClubs(db: Db, query: string): Promise<ClubHit[]> {
  const q = query.replace(/[%_\\,()]/g, " ").trim();
  if (q.length < 2) return [];
  const { data } = await db.from("clubs").select("id, name, town, region").ilike("name", `%${q}%`).order("name").limit(12).overrideTypes<{ id: number; name: string; town: string | null; region: string | null }[]>();
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, place: [c.town, c.region].filter(Boolean).join(", ") || null }));
}

/** The society's home club with its country, for the settings page's club picker. */
export async function loadClubWithCountry(db: Db, clubId: number | null): Promise<{ id: number; name: string; country: string } | null> {
  if (!clubId) return null;
  const { data } = await db.from("clubs").select("id, name, country").eq("id", clubId).maybeSingle<{ id: number; name: string; country: string }>();
  return data ?? null;
}
