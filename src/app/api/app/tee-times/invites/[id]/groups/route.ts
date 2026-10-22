import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { inviteGroupsToTeeTime, parseGroupIds } from "@/lib/tee-time-groups";

/**
 * POST /api/app/tee-times/invites/[id]/groups   { group_ids: number[] }  → { invited: number }
 *
 * The host invites one or more of their groups to a round already posted
 * (0186). Same as picking them on the post form: everyone in them is told
 * and can take a place in one tap.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const id = asId((await params).id);
  if (id === null) return badRequest("Tee time id must be a positive integer.");

  const body = await readJson<{ group_ids?: unknown }>(request);
  const groupIds = parseGroupIds(body?.group_ids);
  if (groupIds.length === 0) return badRequest("group_ids must list at least one group.");

  const { data: t } = await auth.supabase
    .from("tee_time_invites")
    .select("member_id, club_name, play_date, spaces_available, club:clubs ( name )")
    .eq("id", id)
    .maybeSingle<{ member_id: string; club_name: string | null; play_date: string; spaces_available: number; club: { name: string } | null }>();
  if (!t) return Response.json({ error: "This tee time is no longer available.", reason: "not_found" }, { status: 404 });
  if (t.member_id !== auth.user.id) {
    return Response.json({ error: "Only the host can invite a group.", reason: "forbidden" }, { status: 403 });
  }

  const result = await inviteGroupsToTeeTime(
    auth.supabase,
    auth.user.id,
    { inviteId: id, clubName: t.club?.name ?? t.club_name ?? "a round", playDate: t.play_date, spaces: t.spaces_available },
    groupIds
  );
  return Response.json({ invited: result.invitees.size });
}
