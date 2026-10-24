"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { teeTimeCalendarUrl } from "@/lib/tee-time-calendar";
import { signTeeTimeToken, teeTimeLinkPath } from "@/lib/tee-time-links";
import {
  changeInviteStatus,
  confirmPlace,
  removeInvite,
  respondToInterest,
  withdrawRequest,
  type InviteStatusValue,
} from "@/lib/tee-times-operations";

/**
 * My rounds' buttons. Each is a thin wrapper over the shared operation in
 * src/lib/tee-times-operations.ts — the same ones the app's API routes call,
 * so the other side is told exactly as it is from the app.
 */
export type ActionResult = { error?: string; url?: string };

async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/tee-times/mine");
  return { supabase, userId: user.id };
}

function refresh() {
  revalidatePath("/tee-times/mine");
  revalidatePath("/tee-times");
  revalidatePath("/dashboard");
}

/** Host: offer a place, or decline. */
export async function answerRequest(interestId: number, accept: boolean): Promise<ActionResult> {
  const { supabase, userId } = await member();
  const result = await respondToInterest(supabase, userId, interestId, accept);
  if (!result.ok) return { error: result.message };
  refresh();
  return {};
}

/** Golfer: confirm an offered place, or hand a place back. */
export async function answerOffer(interestId: number, attending: boolean): Promise<ActionResult> {
  const { supabase, userId } = await member();
  const result = await confirmPlace(supabase, userId, interestId, attending);
  if (!result.ok) return { error: result.message };
  refresh();
  return {};
}

/** Golfer: take back a request the host hasn't answered (0167). */
export async function withdrawMyRequest(interestId: number): Promise<ActionResult> {
  const { supabase } = await member();
  const result = await withdrawRequest(supabase, interestId);
  if (!result.ok) return { error: result.message };
  refresh();
  return {};
}

/** Host: mark full, re-open, or cancel (everyone in it is told). */
export async function setRoundStatus(inviteId: number, status: InviteStatusValue): Promise<ActionResult> {
  const { supabase, userId } = await member();
  const result = await changeInviteStatus(supabase, userId, inviteId, status);
  if (!result.ok) return { error: result.message };
  refresh();
  return {};
}

/** Host: delete — the page only offers it while nobody has asked to join. */
export async function deleteRound(inviteId: number): Promise<ActionResult> {
  const { supabase, userId } = await member();
  const result = await removeInvite(supabase, userId, inviteId);
  if (!result.ok) return { error: result.message };
  refresh();
  return {};
}

/** A link to send for an open place (0132): host or anyone playing. */
export async function shareRoundLink(inviteId: number): Promise<ActionResult> {
  const { supabase, userId } = await member();
  const { data: canFill } = await supabase.rpc("tee_time_can_fill", { p_invite_id: inviteId, p_user: userId });
  if (canFill !== true) return { error: "Only the host or someone playing can share this round." };
  return { url: `${getSiteUrl()}${teeTimeLinkPath(signTeeTimeToken(inviteId, userId))}` };
}

/** "Add to calendar": a link to an .ics for a round you're in. */
export async function calendarLink(inviteId: number): Promise<ActionResult> {
  const { supabase, userId } = await member();
  const result = await teeTimeCalendarUrl(supabase, userId, inviteId);
  return result.ok ? { url: result.url } : { error: result.error };
}

/**
 * Host, after the round: say a confirmed golfer didn't turn up, or undo it
 * (mark_tee_time_no_show, 0188). The database checks it's their round, the
 * round has started, it's within a week, and that the golfer has no live
 * scorecard from that day — and tells the golfer.
 */
export async function markNoShow(inviteId: number, memberId: string, noShow: boolean): Promise<ActionResult> {
  const { supabase } = await member();
  const { error } = await supabase.rpc("mark_tee_time_no_show", { p_invite_id: inviteId, p_member: memberId, p_no_show: noShow });
  if (error) return { error: error.message || "That didn't go through. Please try again." };
  refresh();
  return {};
}

/** Golfer: "I was there." Stops the no-show counting while it's checked (0188). */
export async function disputeNoShow(inviteId: number, note: string): Promise<ActionResult> {
  const { supabase } = await member();
  const { error } = await supabase.rpc("dispute_tee_time_attendance", { p_invite_id: inviteId, p_note: note.slice(0, 500) });
  if (error) return { error: error.message || "That didn't go through. Please try again." };
  refresh();
  return {};
}

