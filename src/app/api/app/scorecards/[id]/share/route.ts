import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { scorecardImagePath, scorecardLinkPath, signScorecardToken } from "@/lib/scorecard-links";
import { getSiteUrl } from "@/lib/site-url";

/**
 * POST /api/app/scorecards/[id]/share   → { url, imageUrl }
 *
 * A public link to one of the caller's own scorecards (0110), for sending by
 * WhatsApp or text. Only the owner can make one: the card is read with the
 * caller's client and must be theirs. Signed, not stored — see
 * src/lib/scorecard-links.ts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const id = asId((await params).id);
  if (id === null) return badRequest("Scorecard id must be a positive integer.");

  const { data } = await auth.supabase
    .from("scorecards")
    .select("id, member_id")
    .eq("id", id)
    .maybeSingle<{ id: number; member_id: string }>();
  if (!data || data.member_id !== auth.user.id) {
    return Response.json({ error: "That scorecard isn't yours to share.", reason: "not_found" }, { status: 404 });
  }

  const token = signScorecardToken(data.id, auth.user.id);
  const site = getSiteUrl();
  return Response.json({ url: `${site}${scorecardLinkPath(token)}`, imageUrl: `${site}${scorecardImagePath(token)}` });
}
