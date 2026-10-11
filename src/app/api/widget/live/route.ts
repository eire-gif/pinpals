import { createAdminClient } from "@/lib/supabase/admin";
import { widgetPayloadFor } from "@/lib/widget-data";
import { verifyWidgetToken } from "@/lib/widget-token";

/**
 * GET /api/widget/live   (header  Authorization: Widget <token>)
 *
 * The scoreboard a member's Home Screen widget draws (src/lib/widget-board.ts):
 * their live match day, scramble or round. The token comes from
 * POST /api/app/widget/token via the app; it's sent as a header rather than
 * in the URL so it never lands in access logs.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Widget (.+)$/i)?.[1]?.trim();
  const memberId = verifyWidgetToken(token);
  if (!memberId) return Response.json({ error: "Sign in to PinPals again to refresh this widget." }, { status: 401 });
  try {
    const payload = await widgetPayloadFor(createAdminClient(), memberId);
    return Response.json(payload, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("widget: payload failed", e);
    return Response.json({ error: "Couldn't load the scoreboard." }, { status: 500 });
  }
}
