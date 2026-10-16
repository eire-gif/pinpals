import { readJson } from "@/lib/app-api";
import { createClient } from "@/lib/supabase/server";
import { hashFromRequest, NO_STORE } from "@/lib/parent-approval";

/**
 * POST /api/parent/answer   (header  Authorization: Parent <secret>)
 *
 * Junior members (0159): the parent says yes or no.
 *
 * Body: { answer: "approve", consent: true } | { answer: "decline" }
 *
 * Approve runs guardian_link_accept as the signed-in parent (their own
 * PinPals account, 18+ by its own date of birth). With the €0 card check
 * switched on in admin it answers { status: "card_check" } and the page
 * offers the card check next. Decline needs no account — whoever holds the
 * link can say no.
 *
 * 200 { status: "approved" | "card_check" | "declined" }
 * 400 { error, code? }  code "needs_dob": the parent's account has no date
 *     of birth yet; the page asks for it and tries again.
 * 401 approve while signed out.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const hash = hashFromRequest(request);
  if (!hash) return Response.json({ error: "This link isn't valid." }, { status: 404, headers: NO_STORE });

  const body = await readJson<{ answer?: unknown; consent?: unknown }>(request);
  const supabase = await createClient();

  if (body?.answer === "decline") {
    const { error } = await supabase.rpc("guardian_link_decline", { p_token_hash: hash });
    if (error) return Response.json({ error: error.code === "22023" ? error.message : "Couldn't save that — please try again." }, { status: 400, headers: NO_STORE });
    return Response.json({ status: "declined" }, { headers: NO_STORE });
  }

  if (body?.answer !== "approve") return Response.json({ error: "Approve or decline?" }, { status: 400, headers: NO_STORE });
  // The consent tick is the parent's GDPR consent for the child (Article 8);
  // the database records when it was given (consented_at).
  if (body.consent !== true) {
    return Response.json({ error: "Please tick the box to confirm you're their parent or guardian." }, { status: 400, headers: NO_STORE });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please log in first." }, { status: 401, headers: NO_STORE });

  const { data, error } = await supabase.rpc("guardian_link_accept", { p_token_hash: hash });
  if (error) {
    if (error.message === "needs_dob") {
      return Response.json({ error: "Add your date of birth first.", code: "needs_dob" }, { status: 400, headers: NO_STORE });
    }
    // P0002 / 22023 / 42501 are the function's own messages, written to be shown.
    const shown = ["P0002", "22023", "42501"].includes(error.code ?? "");
    if (!shown) console.error("[parent] accept failed:", error.message);
    return Response.json({ error: shown ? error.message : "Couldn't save that — please try again." }, { status: 400, headers: NO_STORE });
  }
  const status = (data as { status?: string } | null)?.status === "card_check" ? "card_check" : "approved";
  return Response.json({ status }, { headers: NO_STORE });
}
