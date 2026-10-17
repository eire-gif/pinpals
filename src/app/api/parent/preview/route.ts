import { createClient } from "@/lib/supabase/server";
import { hashFromRequest, NO_STORE } from "@/lib/parent-approval";

/**
 * POST /api/parent/preview   (header  Authorization: Parent <secret>)
 *
 * Junior members (0159): what /parent#<secret> shows before anyone signs in
 * — the child's first name and whether the request is still open. Nothing
 * else about the child leaves the database here (guardian_link_preview).
 * POST rather than GET so nothing between here and the browser caches it.
 *
 * 200 { preview: { status, childFirstName, invitedAt, awaitingCardCheck, cardCheckRequired } }
 * 404 { error } for a secret that matches nothing.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const hash = hashFromRequest(request);
  if (!hash) return Response.json({ error: "This link isn't valid." }, { status: 404, headers: NO_STORE });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guardian_link_preview", { p_token_hash: hash });
  if (error) {
    console.error("[parent] preview failed:", error.message);
    return Response.json({ error: "Couldn't load this request — please try again." }, { status: 500, headers: NO_STORE });
  }
  if (!data) return Response.json({ error: "This link isn't valid." }, { status: 404, headers: NO_STORE });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Response.json({ preview: data, signedIn: !!user }, { headers: NO_STORE });
}
