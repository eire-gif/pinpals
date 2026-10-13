import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { AdvertisingNotInstalledError, getCampaign } from "@/lib/admin/advertising";
import { AD_FORMAT_INFO, PRICING_LABELS, type AdFormat } from "@/lib/advertising";
import { dailyReport, formatRate, summarizeCampaign } from "@/lib/advertising-revenue";
import ExportCsvLink from "@/components/admin/export-csv-link";
import StatCard from "@/components/admin/stat-card";
import { NotInstalled, Panel, dateOnly, eur } from "../../bits";

// /admin/advertising/[id]/report — what gets sent to the advertiser: a day
// by day table of billable views, clicks and what they earned, plus a CSV of
// the same. Any staff member may look; the export is audited.
export default async function CampaignReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let campaign: Awaited<ReturnType<typeof getCampaign>>;
  try {
    campaign = await getCampaign(id);
  } catch (err) {
    if (err instanceof AdvertisingNotInstalledError) return <NotInstalled />;
    throw err;
  }
  if (!campaign) notFound();

  const now = new Date();
  const rows = dailyReport(campaign, campaign.stats, now);
  const s = summarizeCampaign(campaign, campaign.stats, now);

  return (
    <div>
      <p className="text-sm mb-2">
        <Link href={`/admin/advertising/${campaign.id}`} className="text-ink-500 hover:underline">
          ← {campaign.name}
        </Link>
      </p>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-gold-600">Advertiser report · {campaign.advertiserName}</p>
          <h1 className="font-display font-bold text-3xl text-ink-900 mt-1">{campaign.name}</h1>
          <p className="text-sm text-ink-500 mt-1">
            {AD_FORMAT_INFO[campaign.format as AdFormat]?.label ?? campaign.format} · {dateOnly(campaign.starts_at)} → {dateOnly(campaign.ends_at)} ·{" "}
            {PRICING_LABELS[campaign.pricing_model]} {eur(Number(campaign.rate_eur))}
            {campaign.budget_cap_eur != null ? ` · cap ${eur(Number(campaign.budget_cap_eur))}` : ""}
          </p>
        </div>
        <ExportCsvLink href={`/admin/advertising/${campaign.id}/report/export`} title={`Downloads all ${rows.length} days`} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Views" value={s.views.toLocaleString("en-IE")} hint="Signed-in members, once per hour" />
        <StatCard label="Clicks" value={s.clicks.toLocaleString("en-IE")} hint={`CTR ${formatRate(s.ctr)}`} />
        <StatCard label="Earned" value={eur(s.earnedEur)} accent hint={`of ${eur(s.bookedEur)} booked`} />
        <StatCard label="Effective CPM" value={s.effectiveCpmEur == null ? "—" : eur(s.effectiveCpmEur)} hint="Earned ÷ views × 1,000" />
      </div>

      <Panel title="Day by day (UTC)">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-500 px-5 pb-6">Nothing yet — the campaign hasn&rsquo;t started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Day</th>
                  <th className="px-3 py-3 text-right">Views</th>
                  <th className="px-3 py-3 text-right">Clicks</th>
                  <th className="px-3 py-3 text-right">CTR</th>
                  <th className="px-3 py-3 text-right">Closed</th>
                  <th className="px-5 py-3 text-right">Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.day}>
                    <td className="px-5 py-2.5 font-semibold text-ink-900">{dateOnly(`${r.day}T00:00:00Z`)}</td>
                    <td className="px-3 py-2.5 text-right">{r.views.toLocaleString("en-IE")}</td>
                    <td className="px-3 py-2.5 text-right">{r.clicks.toLocaleString("en-IE")}</td>
                    <td className="px-3 py-2.5 text-right">{formatRate(r.views ? r.clicks / r.views : null)}</td>
                    <td className="px-3 py-2.5 text-right text-ink-500">{r.dismisses.toLocaleString("en-IE")}</td>
                    <td className="px-5 py-2.5 text-right font-semibold">{eur(r.earnedEur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-tint font-bold">
                <tr>
                  <td className="px-5 py-3">Total</td>
                  <td className="px-3 py-3 text-right">{s.views.toLocaleString("en-IE")}</td>
                  <td className="px-3 py-3 text-right">{s.clicks.toLocaleString("en-IE")}</td>
                  <td className="px-3 py-3 text-right">{formatRate(s.ctr)}</td>
                  <td className="px-3 py-3 text-right">{s.dismisses.toLocaleString("en-IE")}</td>
                  <td className="px-5 py-3 text-right">{eur(s.earnedEur)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-ink-500 mt-4">
        Views count once per member per hour and clicks once per member per day, so repeat taps never add to the bill. Views by
        signed-out visitors aren&rsquo;t billed{s.anonViews ? ` (${s.anonViews.toLocaleString("en-IE")} so far)` : ""}.
      </p>
    </div>
  );
}
