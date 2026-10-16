import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { loadAgeAccess } from "@/lib/age-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notifications-server";
import { formatPrice } from "@/lib/format";

/**
 * POST /api/app/age/ask-parent   (bearer)
 *
 * Junior members (0159): under-18s browse the marketplace but can't buy. A
 * 13–15 year old's "Ask a parent" sends the listing to their approved
 * parent as an alert (in-app, push, and email by their settings), who can
 * buy it for them. 16–17s have no parent link, so the app offers its share
 * sheet instead — this answers { sent: false, reason: "no_parent" } and the
 * app falls back to that.
 *
 * Body: { listingId }
 * 200 { sent: true } | { sent: false, reason: "no_parent" }  ·  400  ·  401  ·  404  ·  429
 *
 * The listing is read with the member's own client, so a draft or removed
 * listing they couldn't see can't be sent. The parent is read with the
 * service role from guardian_links (approved only) — never from the request.
 */
const MAX_PER_DAY = 20;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const body = await readJson<{ listingId?: unknown }>(request);
  const listingId = asId(body?.listingId);
  if (!listingId) return badRequest("Which listing?");

  const access = await loadAgeAccess(auth.supabase);
  if (!access || (access.band !== "junior" && access.band !== "junior_pending")) {
    return Response.json({ sent: false, reason: "no_parent" });
  }

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("guardian_links")
    .select("guardian_id")
    .eq("junior_id", auth.user.id)
    .eq("status", "approved")
    .not("guardian_id", "is", null)
    .maybeSingle<{ guardian_id: string }>();
  if (!link) return Response.json({ sent: false, reason: "no_parent" });

  const limit = await checkRateLimit({ action: "age-ask-parent", identifier: auth.user.id, maxHits: MAX_PER_DAY, windowSeconds: 24 * 3600 });
  if (!limit.allowed) return Response.json({ error: rateLimitMessage(limit.retryAfterSeconds) }, { status: 429 });

  const { data: listing } = await auth.supabase
    .from("listings")
    .select("id, title, price_eur, status")
    .eq("id", listingId)
    .maybeSingle<{ id: number; title: string; price_eur: number | null; status: string }>();
  if (!listing || listing.status !== "active") return Response.json({ error: "That listing isn't available." }, { status: 404 });

  const { data: me } = await admin.from("profiles").select("first_name").eq("id", auth.user.id).maybeSingle<{ first_name: string | null }>();
  const name = me?.first_name?.trim() || "Your child";
  const price = listing.price_eur != null ? ` — ${formatPrice(Number(listing.price_eur))}` : "";

  await notifyUser(admin, {
    userId: link.guardian_id,
    type: "junior_ask_parent",
    title: `${name} would like something in the marketplace`,
    body: `${listing.title}${price}. Have a look and buy it for them if you like.`,
    href: `/marketplace/${listing.id}`,
    data: { listing_id: listing.id },
    // One alert per listing per day, however many times it's tapped.
    dedupeKey: `junior_ask_parent:${auth.user.id}:${listing.id}:${new Date().toISOString().slice(0, 10)}`,
  });

  return Response.json({ sent: true });
}
