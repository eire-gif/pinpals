import { authenticateAppRequest, unauthenticated } from "@/lib/app-api";
import { statusForBlockFailure, unblockMember } from "@/lib/blocking";

/** DELETE /api/app/blocks/[memberId] — unblock. Their posts and comments
 *  reappear straight away; nothing was deleted by the block. */
export async function DELETE(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const result = await unblockMember(auth.supabase, auth.user.id, (await params).memberId);
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForBlockFailure(result.reason) });
  }
  return Response.json({ ok: true });
}
