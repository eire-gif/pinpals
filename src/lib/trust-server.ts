import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRow, type Reliability, type ReliabilityRow } from "@/lib/reliability";

/**
 * Trust signals for a set of members (0188): the tee-time reliability badge
 * and the Verified golfer badge. One call each, for any number of members,
 * so a list of requests or players costs two queries, not two per row.
 * Read with the member's own client — member_reliability() is callable by
 * any signed-in member and verified_members is readable by all of them.
 */

export type Trust = { reliability: Reliability | null; verifiedClub: string | null; verified: boolean };

export async function loadTrust(supabase: SupabaseClient, memberIds: string[]): Promise<Map<string, Trust>> {
  const ids = [...new Set(memberIds.filter(Boolean))].slice(0, 200);
  const out = new Map<string, Trust>();
  if (ids.length === 0) return out;

  const [rel, ver] = await Promise.all([
    supabase.rpc("member_reliability", { p_members: ids }),
    supabase.from("verified_members").select("member_id, club_name").in("member_id", ids),
  ]);

  const reliability = new Map<string, Reliability>();
  for (const row of (rel.data ?? []) as ReliabilityRow[]) reliability.set(row.member_id, fromRow(row));
  const verified = new Map<string, string | null>();
  for (const row of (ver.data ?? []) as { member_id: string; club_name: string | null }[]) verified.set(row.member_id, row.club_name);

  for (const id of ids) {
    out.set(id, {
      reliability: reliability.get(id) ?? null,
      verified: verified.has(id),
      verifiedClub: verified.get(id) ?? null,
    });
  }
  return out;
}

export async function loadOneTrust(supabase: SupabaseClient, memberId: string): Promise<Trust> {
  return (await loadTrust(supabase, [memberId])).get(memberId) ?? { reliability: null, verified: false, verifiedClub: null };
}
