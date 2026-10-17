import { requireStaff } from "@/lib/admin/authorization";
import { LIVE_PANEL_ROLES } from "@/lib/admin/live-panel";
import { getLiveStats } from "@/lib/admin/live-stats";

/**
 * GET /admin/live-stats → LiveStats (0161)
 *
 * What the Overview's "Live now" panel polls every 15 seconds. Super admin
 * only, with two-step sign-in, like the page it feeds.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  await requireStaff({ roles: LIVE_PANEL_ROLES });
  const stats = await getLiveStats();
  if (!stats) return Response.json({ error: "Couldn't load live numbers." }, { status: 503, headers: { "cache-control": "private, no-store" } });
  return Response.json(stats, { headers: { "cache-control": "private, no-store" } });
}
