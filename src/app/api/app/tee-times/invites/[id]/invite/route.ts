import { after } from "next/server";

import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { signTeeTimeToken, teeTimeLinkPath } from "@/lib/tee-time-links";
import { notifyTeeTimeInvited } from "@/lib/tee-times-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/app/tee-times/invites/[id]/invite   { member_ids: string[] }
 *   → { invited: number }
 *
 * The host or a golfer with a confirmed place invites PinPals members to fill
 * an open place (0132). invite_to_tee_time() decides who may and who is
 * skipped (already in it, already asked, blocked); each member newly invited
 * gets a notification whose link is the inviter's share link for the round.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const id = asId((await params).id);
  if (id === null) return badRequest("Tee time id must be a positive integer.");

  const body = await readJson<{ member_ids?: unknown }>(request);
  const ids = Array.isArray(body?.member_ids) ? body.member_ids.filter((m): m is string => typeof m === "string" && UUID.test(m)) : [];
  if (ids.length === 0) return badRequest("member_ids must list at least one member.");
  if (ids.length > 20) return badRequest("Invite up to 20 people at a time.");

  const { data, error } = await auth.supabase.rpc("invite_to_tee_time", { p_invite_id: id, p_members: ids });
  if (error) {
    const forbidden = error.code === "42501";
    return Response.json({ error: error.message, reason: forbidden ? "forbidden" : "conflict" }, { status: forbidden ? 403 : 409 });
  }
  const invited = ((data as string[] | { invite_to_tee_time: string }[] | null) ?? []).map((r) => (typeof r === "string" ? r : r.invite_to_tee_time));

  if (invited.length > 0) {
    const { data: t } = await auth.supabase
      .from("tee_time_invites")
      .select("club_name, play_date, club:clubs ( name )")
      .eq("id", id)
      .maybeSingle<{ club_name: string | null; play_date: string; club: { name: string } | null }>();
    const link = teeTimeLinkPath(signTeeTimeToken(id, auth.user.id));
    after(async () => {
      const admin = createAdminClient();
      for (const memberId of invited) {
        await notifyTeeTimeInvited(admin, {
          memberId,
          inviterId: auth.user.id,
          link,
          invite: { inviteId: id, clubName: t?.club?.name ?? t?.club_name ?? "a round", playDate: t?.play_date ?? "" },
        });
      }
    });
  }

  return Response.json({ invited: invited.length });
}
