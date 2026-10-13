import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction } from "@/lib/admin/audit";
import { getCampaign } from "@/lib/admin/advertising";
import { dailyReport } from "@/lib/advertising-revenue";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import { csvFilename, csvResponse } from "@/lib/admin/export";

/**
 * CSV of /admin/advertising/[id]/report — the advertiser's day-by-day
 * figures. Same gate as the page (any active staff member); carries no
 * member data at all, only counts and money. Audited like every export.
 */
export const dynamic = "force-dynamic";

const HEADERS = ["Day (UTC)", "Views", "Clicks", "CTR %", "Closed", "Signed-out views (not billed)", "Earned EUR"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, staff } = await requireStaff();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const campaign = await getCampaign(id);
  if (!campaign) return new Response("Not found", { status: 404 });

  const rows = dailyReport(campaign, campaign.stats);
  const body: CsvValue[][] = rows.map((r) => [
    r.day,
    r.views,
    r.clicks,
    r.views ? ((r.clicks / r.views) * 100).toFixed(2) : "",
    r.dismisses,
    r.anonViews,
    r.earnedEur.toFixed(2),
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.ad_report",
    targetType: "ad_campaign",
    targetId: id,
    metadata: { rowCount: body.length, includesEmail: false },
  });

  const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || String(id);
  return csvResponse(csvFilename(`ad-report-${slug}`), toCsv(HEADERS, body));
}
