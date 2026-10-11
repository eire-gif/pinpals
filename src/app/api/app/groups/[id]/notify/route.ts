import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { notifyGroupApproved, notifyGroupInvites, notifyGroupRequest } from "@/lib/group-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/groups/[id]/notify   { event, memberId? }
 *
 * Called by the app right after it changes a group through one of 0120's
 * functions, because push, email and preferences live in notifyUser(). The
 * change itself is already made; this only tells people about it.
 *
 *   invited    — after invite_to_group: the caller's pending invitations
 *   requested  — after request_to_join_group: the caller's own pending request
 *   approved   — after review_group_request: `memberId` is in, and the caller
 *                runs the group
 *
 * Who may ask is checked with the member's own client (RLS decides whether
 * they can even see the group); who hears about it comes from the
 * invitation rows, never from the request body. Repeats are harmless: every
 * notification is deduped.
 */
type Body = { event?: string; memberId?: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const groupId = asId((await params).id);
  if (groupId === null) return badRequest("id must be a positive integer");
  const body = await readJson<Body>(request);
  if (!body?.event) return badRequest("event is required");

  const { data: group } = await auth.supabase.from("groups").select("id").eq("id", groupId).maybeSingle();
  if (!group) return Response.json({ error: "Group not found" }, { status: 404 });

  const admin = createAdminClient();
  switch (body.event) {
    case "invited":
      return Response.json({ sent: await notifyGroupInvites(admin, groupId, auth.user.id) });
    case "requested":
      return Response.json({ sent: await notifyGroupRequest(admin, groupId, auth.user.id) });
    case "approved": {
      if (typeof body.memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.memberId)) return badRequest("memberId is required");
      const { data: me } = await auth.supabase
        .from("group_members")
        .select("role")
        .eq("group_id", groupId)
        .eq("member_id", auth.user.id)
        .maybeSingle<{ role: string }>();
      if (!me || (me.role !== "owner" && me.role !== "admin")) {
        return Response.json({ error: "Only whoever runs the group can do that" }, { status: 403 });
      }
      return Response.json({ sent: await notifyGroupApproved(admin, groupId, body.memberId) });
    }
    default:
      return badRequest("unknown event");
  }
}
