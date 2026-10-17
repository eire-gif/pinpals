import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The parent's dashboard (/parent, 0159): their 13–15 year olds, who each
 * may play with, their recent rounds, and the parent's groups they could add
 * them to.
 *
 * Children, contacts and groups are read with the parent's own client —
 * my_children() and junior_contact_list() check the parent link themselves,
 * and RLS scopes the groups. Rounds are read with the service role, but only
 * for a child that my_children() has just returned for this parent: a
 * child's scorecards are private to them by RLS, and a parent seeing their
 * child's golf is the point of the page.
 */

export type Child = {
  link_id: number;
  junior_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  age: number | null;
  status: "pending" | "approved";
  consented_at: string | null;
  approved_at: string | null;
  card_checked_at: string | null;
};

export type ChildContact = { contact_id: string; first_name: string; last_name: string; avatar_url: string | null; avatar_color: string | null; approved: boolean };

export type ChildRound = { key: string; when: string; course: string; kind: "Scorecard" | "Live round"; detail: string | null };

export type InvitableGroup = { id: number; name: string; kind: string };

export type ChildPanel = { child: Child; contacts: ChildContact[]; rounds: ChildRound[]; inGroups: number[] };

export async function loadMyChildren(supabase: SupabaseClient): Promise<Child[]> {
  const { data, error } = await supabase.rpc("my_children");
  if (error) {
    console.error("[parent] my_children failed:", error.message);
    return [];
  }
  return (data ?? []) as Child[];
}

/** The last 10 things a child played: their own scorecards and the live rounds they were in. */
async function recentRounds(admin: SupabaseClient, childId: string): Promise<ChildRound[]> {
  const [{ data: cards }, { data: players }] = await Promise.all([
    admin
      .from("scorecards")
      .select("id, course_name, played_on, holes, live_round_id, scorecard_holes(strokes)")
      .eq("member_id", childId)
      .order("played_on", { ascending: false })
      .order("id", { ascending: false })
      .limit(10),
    admin.from("live_round_players").select("round_id").eq("member_id", childId).order("round_id", { ascending: false }).limit(10),
  ]);

  type CardRow = { id: number; course_name: string; played_on: string; holes: number; live_round_id: number | null; scorecard_holes: { strokes: number | null }[] | null };
  const cardRows = (cards ?? []) as CardRow[];
  const withCard = new Set(cardRows.map((c) => c.live_round_id).filter((x): x is number => x != null));

  const roundIds = ((players ?? []) as { round_id: number }[]).map((p) => p.round_id).filter((id) => !withCard.has(id));
  const { data: rounds } = roundIds.length
    ? await admin.from("live_rounds").select("id, course_name, played_on, status, format").in("id", roundIds)
    : { data: [] };

  const out: ChildRound[] = [
    ...cardRows.map((c) => {
      const strokes = (c.scorecard_holes ?? []).map((h) => h.strokes);
      const done = strokes.filter((s): s is number => s != null);
      const total = done.reduce((a, b) => a + b, 0);
      return {
        key: `card-${c.id}`,
        when: c.played_on,
        course: c.course_name,
        kind: "Scorecard" as const,
        detail: done.length ? `${total} over ${done.length} of ${c.holes} holes` : `${c.holes} holes`,
      };
    }),
    ...((rounds ?? []) as { id: number; course_name: string; played_on: string; status: string; format: string }[]).map((r) => ({
      key: `round-${r.id}`,
      when: r.played_on,
      course: r.course_name,
      kind: "Live round" as const,
      detail: r.status === "live" ? "Playing now" : "Finished",
    })),
  ];
  return out.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0)).slice(0, 10);
}

export async function loadChildPanels(supabase: SupabaseClient, children: Child[], groups: InvitableGroup[]): Promise<ChildPanel[]> {
  const admin = children.some((c) => c.status === "approved") ? createAdminClient() : null;
  return Promise.all(
    children.map(async (child) => {
      // Contacts and rounds only once the link is approved: until then the
      // parent hasn't finished saying yes, and the database's own functions
      // treat them as not yet the parent (guardian_of is approved-only).
      if (child.status !== "approved" || !admin) return { child, contacts: [], rounds: [], inGroups: [] };
      const [{ data: contacts, error }, rounds, inGroups] = await Promise.all([
        supabase.rpc("junior_contact_list", { p_junior: child.junior_id }),
        recentRounds(admin, child.junior_id),
        childGroupIds(supabase, child.junior_id, groups.map((g) => g.id)),
      ]);
      if (error) console.error("[parent] junior_contact_list failed:", error.message);
      return { child, contacts: (contacts ?? []) as ChildContact[], rounds, inGroups: [...inGroups] };
    })
  );
}

/**
 * The parent's groups they can invite into — invite_to_group's own rule
 * (0122): whoever runs the group, or any member where members_can_invite.
 * A society only by its owner, captain or secretary (role owner/admin).
 */
export async function loadInvitableGroups(supabase: SupabaseClient, parentId: string): Promise<InvitableGroup[]> {
  const { data } = await supabase
    .from("group_members")
    .select("role, group:groups!inner(id, name, kind, members_can_invite, hidden_at)")
    .eq("member_id", parentId);
  type Row = { role: string; group: { id: number; name: string; kind: string; members_can_invite: boolean; hidden_at: string | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.group && !r.group.hidden_at);
  const runs = (r: Row) => r.role === "owner" || r.role === "admin";
  return rows
    .filter((r) => runs(r) || (r.group!.kind !== "society" && r.group!.members_can_invite))
    .map((r) => ({ id: r.group!.id, name: r.group!.name, kind: r.group!.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** For one child: which of the invitable groups they're already in. */
export async function childGroupIds(supabase: SupabaseClient, childId: string, groupIds: number[]): Promise<Set<number>> {
  if (!groupIds.length) return new Set();
  const { data } = await supabase.from("group_members").select("group_id").eq("member_id", childId).in("group_id", groupIds);
  return new Set(((data ?? []) as { group_id: number }[]).map((r) => r.group_id));
}
