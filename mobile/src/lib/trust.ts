import { postFormToSite, type UploadFile } from "./api";
import { supabase } from "./supabase";
import { fromRow, toMark, type AttendanceMark, type AttendanceRow, type Reliability, type ReliabilityRow } from "./reliability";

/**
 * Trust & safety reads and writes for the app (Oct 2026, 0188,
 * claude/trust-and-safety.md). The wording lives in reliability.ts and
 * message-safety.ts; this only talks to the database and the website.
 */

export type Trust = { reliability: Reliability | null; verified: boolean; verifiedClub: string | null };

export const NO_TRUST: Trust = { reliability: null, verified: false, verifiedClub: null };

/** Both badges for any number of members: two queries, whatever the count. */
export async function loadTrust(memberIds: string[]): Promise<Map<string, Trust>> {
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
    out.set(id, { reliability: reliability.get(id) ?? null, verified: verified.has(id), verifiedClub: verified.get(id) ?? null });
  }
  return out;
}

export async function loadOneTrust(memberId: string): Promise<Trust> {
  try {
    return (await loadTrust([memberId])).get(memberId) ?? NO_TRUST;
  } catch {
    return NO_TRUST;
  }
}

/** No-shows and late cancellations on these rounds that I can see: mine, and any on rounds I host. */
export async function loadMarks(inviteIds: number[]): Promise<AttendanceMark[]> {
  if (inviteIds.length === 0) return [];
  const { data, error } = await supabase
    .from("tee_time_attendance")
    .select("invite_id, member_id, outcome, disputed_at, resolution")
    .in("invite_id", inviteIds);
  if (error) return [];
  return ((data ?? []) as AttendanceRow[]).map(toMark);
}

export async function markNoShow(inviteId: number, memberId: string, noShow: boolean): Promise<void> {
  const { error } = await supabase.rpc("mark_tee_time_no_show", { p_invite_id: inviteId, p_member: memberId, p_no_show: noShow });
  if (error) throw new Error(error.message || "That didn't go through. Please try again.");
}

export async function disputeNoShow(inviteId: number, note: string): Promise<void> {
  const { error } = await supabase.rpc("dispute_tee_time_attendance", { p_invite_id: inviteId, p_note: note.slice(0, 500) });
  if (error) throw new Error(error.message || "That didn't go through. Please try again.");
}

// ---- Verified golfer ------------------------------------------------------

export type VerificationStatus = "none" | "checking" | "verified" | "needs_review" | "rejected";

export type Verification = {
  status: VerificationStatus;
  clubName: string | null;
  number: string | null;
  reason: string | null;
};

export async function myVerification(userId: string): Promise<Verification> {
  const { data } = await supabase
    .from("member_verifications")
    .select("status, club_name, golf_ireland_number, reason")
    .eq("member_id", userId)
    .maybeSingle<{ status: VerificationStatus; club_name: string; golf_ireland_number: string; reason: string | null }>();
  if (!data) return { status: "none", clubName: null, number: null, reason: null };
  return { status: data.status, clubName: data.club_name, number: data.golf_ireland_number, reason: data.reason };
}

/** Sends the card photo for the AI check and returns the outcome. */
export async function submitVerification(input: {
  photo: UploadFile;
  number: string;
  clubName: string;
  clubId: number | null;
}): Promise<Verification> {
  const fields: Record<string, string> = { number: input.number, club_name: input.clubName };
  if (input.clubId) fields.club_id = String(input.clubId);
  const result = await postFormToSite<{ status: VerificationStatus; clubName: string | null; number: string | null; reason: string | null }>(
    "/api/app/verification",
    fields,
    { field: "file", file: input.photo }
  );
  return { status: result.status, clubName: result.clubName, number: result.number, reason: result.reason };
}
