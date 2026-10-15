import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { areasFor, isGroupOffice, isSocietyArea, positiveInt, type GroupOffice, type GroupRole, type SocietyArea } from "./rules";

/**
 * Who may open the society console, and with what.
 *
 * Signed in with their ordinary PinPals login (the site's cookie session);
 * no separate password, no staff role. Every read and write after this runs
 * with that member's OWN client, so the database's rules (RLS and 0144's
 * society_can) decide what they can see and change — exactly as in the app.
 * This check only turns away people the console has nothing for, before any
 * page draws: not signed in → sign-in; not on the society's committee → 404,
 * so the console never confirms a private society exists.
 */

export type ConsoleSociety = {
  id: number;
  name: string;
  about: string | null;
  privacy: string;
  memberCount: number;
  clubId: number | null;
  clubName: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  createdAt: string;
};

export type ConsoleContext = {
  supabase: SupabaseClient;
  user: User;
  society: ConsoleSociety;
  role: GroupRole;
  office: GroupOffice | null;
  /** From the database (my_society_areas), falling back to the same rule. */
  areas: SocietyArea[];
  /** Owner, captain or secretary. */
  runs: boolean;
};

const SOCIETY_COLUMNS = "id, kind, name, about, privacy, member_count, club_id, cover_url, logo_url, created_at, club:clubs(name)";

type Row = {
  id: number;
  kind: string;
  name: string;
  about: string | null;
  privacy: string;
  member_count: number;
  club_id: number | null;
  cover_url: string | null;
  logo_url: string | null;
  created_at: string;
  club: { name: string } | null;
};

const toSociety = (r: Row): ConsoleSociety => ({
  id: r.id,
  name: r.name,
  about: r.about,
  privacy: r.privacy,
  memberCount: r.member_count,
  clubId: r.club_id,
  clubName: r.club?.name ?? null,
  coverUrl: r.cover_url,
  logoUrl: r.logo_url,
  createdAt: r.created_at,
});

/** The signed-in member, or off to sign in (and back here afterwards). */
export async function requireMember(next: string): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { supabase, user };
}

/**
 * Loads once per request (React cache), so the layout and the page share it.
 * Returns null rather than throwing, for Server Actions to answer in words.
 */
export const loadConsole = cache(async (groupId: number): Promise<ConsoleContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: row }, { data: me }, { data: areaRows, error: areasError }] = await Promise.all([
    supabase.from("groups").select(SOCIETY_COLUMNS).eq("id", groupId).maybeSingle<Row>(),
    supabase.from("group_members").select("role, office").eq("group_id", groupId).eq("member_id", user.id).maybeSingle<{ role: GroupRole; office: string | null }>(),
    supabase.rpc("my_society_areas", { p_group_id: groupId }),
  ]);
  if (!row || row.kind !== "society" || !me) return null;

  const office = isGroupOffice(me.office) ? me.office : null;
  // The database says which areas; if it can't answer, the console stays shut.
  if (areasError) return null;
  const areas = ((areaRows ?? []) as unknown[]).filter(isSocietyArea);
  const runs = me.role === "owner" || me.role === "admin";
  if (!runs && areas.length === 0) return null;

  return { supabase, user, society: toSociety(row), role: me.role, office, areas, runs };
});

/** For pages: the console, or sign-in / 404. `area` narrows it to one tool. */
export async function requireConsole(rawId: string, opts: { area?: SocietyArea; run?: boolean; path?: string } = {}): Promise<ConsoleContext> {
  const groupId = positiveInt(rawId);
  if (!groupId) notFound();
  await requireMember(opts.path ?? `/society/${groupId}`);
  const ctx = await loadConsole(groupId);
  if (!ctx) notFound();
  if (opts.run && !ctx.runs) notFound();
  if (opts.area && !ctx.areas.includes(opts.area)) notFound();
  return ctx;
}

export type MySociety = ConsoleSociety & { role: GroupRole; office: GroupOffice | null; areas: SocietyArea[] };

/** Societies the member helps run — owner or any committee office. */
export async function listMySocieties(supabase: SupabaseClient, userId: string): Promise<MySociety[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select(`role, office, group:groups(${SOCIETY_COLUMNS})`)
    .eq("member_id", userId)
    .overrideTypes<{ role: GroupRole; office: string | null; group: Row | null }[]>();
  if (error) throw new Error("Couldn't load your societies.");
  return (data ?? [])
    .filter((r) => r.group?.kind === "society")
    .map((r) => {
      const office = isGroupOffice(r.office) ? r.office : null;
      return { ...toSociety(r.group as Row), role: r.role, office, areas: areasFor(r.role, office) };
    })
    .filter((s) => s.areas.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));
}
