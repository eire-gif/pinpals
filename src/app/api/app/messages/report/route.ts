import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { REPORT_CATEGORIES, type ReportCategory } from "@/lib/admin/reports";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/app/messages/report   { message_id, category, description? }
 *
 * The app's long-press "Report" — the same report the website's
 * reportMessage() files (src/app/conversations/actions.ts), into the same
 * moderation queue. The member's own client reading the message IS the
 * participancy check: a message from a thread they aren't in returns no row.
 * `reports` has no member write policy, so the insert is the service role's.
 */
const REPORT_MAX_ATTEMPTS = 10;
const REPORT_WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const input = await readJson<{ message_id?: unknown; category?: unknown; description?: unknown }>(request);
  const messageId = asId(input?.message_id);
  if (!input || messageId === null) return badRequest("Expected a message to report.");

  const category = (typeof input.category === "string" ? input.category : "") as ReportCategory;
  if (!REPORT_CATEGORIES.includes(category)) return badRequest("Please choose a reason.");
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 4000) return badRequest("Please keep the description under 4000 characters.");

  const rateLimit = await checkRateLimit({
    action: "report-message",
    identifier: auth.user.id,
    maxHits: REPORT_MAX_ATTEMPTS,
    windowSeconds: REPORT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return Response.json({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  const { data: message } = await auth.supabase
    .from("messages")
    .select("id")
    .eq("id", messageId)
    .maybeSingle<{ id: number }>();
  if (!message) return Response.json({ error: "Message not found." }, { status: 404 });

  const { error } = await createAdminClient().from("reports").insert({
    reporter_id: auth.user.id,
    target_type: "message",
    target_id: String(messageId),
    category,
    description: description || null,
  });
  if (error) return Response.json({ error: "Couldn't file that report — please try again." }, { status: 500 });
  return Response.json({ ok: true }, { status: 201 });
}
