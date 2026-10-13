import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import {
  AdvertisingNotInstalledError,
  canEditAdvertising,
  clubNames,
  getCampaign,
  listAdvertisers,
} from "@/lib/admin/advertising";
import { AD_CATEGORY_LABELS, campaignView, isSensitiveCategory, toInputDublin, type AdCategory, type AdFormat, type DisplayStyle, type TakeoverPlacement } from "@/lib/advertising";
import { formatRate, isCapReached, summarizeCampaign } from "@/lib/advertising-revenue";
import { formatDateTime } from "@/lib/admin/format";
import StatCard from "@/components/admin/stat-card";
import FieldsActionForm from "@/components/admin/fields-action-form";
import ModerationForm from "@/components/admin/moderation-form";
import SimpleActionForm from "@/components/admin/simple-action-form";
import { CampaignBadge, NotInstalled, eur } from "../bits";
import CampaignForm from "../campaign-form";
import { approveCampaign, endCampaign, pauseCampaign, rejectCampaign, resumeCampaign, saveCampaign } from "../actions";

// /admin/advertising/[id] — one campaign: its figures, the status actions
// (approve, reject, pause, resume, end) and the edit form. Any staff member
// may look; only ADVERTISING_EDIT_ROLES see the actions and an editable form.
export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaff();
  const canEdit = canEditAdvertising(staff.role);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const justCreated = (await searchParams).saved === "1";

  let campaign: Awaited<ReturnType<typeof getCampaign>>;
  let advertisers: Awaited<ReturnType<typeof listAdvertisers>>;
  try {
    [campaign, advertisers] = await Promise.all([getCampaign(id), listAdvertisers()]);
  } catch (err) {
    if (err instanceof AdvertisingNotInstalledError) return <NotInstalled />;
    throw err;
  }
  if (!campaign) notFound();

  const now = new Date();
  const summary = summarizeCampaign(campaign, campaign.stats, now);
  const view = campaignView(campaign, now, isCapReached(campaign, campaign.stats));
  const names = await clubNames(campaign.club_ids.map(Number));
  const sensitive = isSensitiveCategory(campaign.category);

  return (
    <div>
      <p className="text-sm mb-2">
        <Link href="/admin/advertising" className="text-ink-500 hover:underline">
          ← Advertising
        </Link>
      </p>

      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-gold-600">{campaign.advertiserName}</p>
          <h1 className="font-display font-bold text-3xl text-ink-900 mt-1 flex flex-wrap items-center gap-3">
            {campaign.name} <CampaignBadge view={view} />
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {AD_CATEGORY_LABELS[campaign.category as AdCategory] ?? campaign.category}
            {campaign.approved_at ? ` · approved ${formatDateTime(campaign.approved_at)}` : ""}
            {campaign.end_reason === "budget_cap" ? " · ended: budget cap reached" : ""}
          </p>
        </div>
        <Link
          href={`/admin/advertising/${campaign.id}/report`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm border border-line bg-surface hover:bg-cream-100"
        >
          Advertiser report →
        </Link>
      </div>

      {justCreated && <p className="text-sm text-green-700 bg-green-100 rounded-lg px-4 py-2 mb-6">Campaign saved.</p>}
      {campaign.status === "rejected" && campaign.reject_reason && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-4 py-2 mb-6">Rejected: {campaign.reject_reason}</p>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Views" value={summary.views.toLocaleString("en-IE")} hint={summary.anonViews ? `+ ${summary.anonViews.toLocaleString("en-IE")} signed-out (not billed)` : "Billable, de-duplicated"} />
        <StatCard label="Clicks" value={summary.clicks.toLocaleString("en-IE")} hint={`CTR ${formatRate(summary.ctr)}`} />
        <StatCard
          label="Earned to date"
          value={eur(summary.earnedEur)}
          accent
          hint={`Booked ${eur(summary.bookedEur)} · eff. CPM ${summary.effectiveCpmEur == null ? "—" : eur(summary.effectiveCpmEur)}`}
        />
        <StatCard label="Outstanding" value={eur(summary.outstandingEur)} warn={summary.outstandingEur > 0 && campaign.payment_status !== "invoiced"} hint={`Payment: ${campaign.payment_status}`} />
      </div>

      {canEdit && (
        <section className="bg-surface border border-line rounded-2xl p-5 mb-8">
          <h2 className="font-display font-bold text-lg mb-3">Status</h2>
          <div className="flex flex-wrap items-start gap-6">
            {campaign.status === "pending_approval" && (
              <>
                <div className="min-w-64">
                  <FieldsActionForm action={approveCampaign} submitLabel="Approve" pendingLabel="Approving…" successLabel="Approved.">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    {sensitive && (
                      <label className="flex items-start gap-2 text-sm bg-red-100 text-red-600 rounded-lg px-3 py-2 max-w-md">
                        <input type="checkbox" name="confirm_sensitive" required className="mt-1" />
                        <span>
                          I&rsquo;ve checked this {campaign.category} advert is suitable for PinPals members (all 18+) and
                          complies with advertising rules where it will show.
                        </span>
                      </label>
                    )}
                  </FieldsActionForm>
                </div>
                <div className="min-w-64 flex-1">
                  <ModerationForm action={rejectCampaign} idField="campaignId" id={campaign.id} submitLabel="Reject" pendingLabel="Rejecting…" tone="danger" placeholder="Why (shown on the campaign; recorded in the audit log)" />
                </div>
              </>
            )}
            {campaign.status === "approved" && (
              <SimpleActionForm action={pauseCampaign} idField="campaignId" id={campaign.id} submitLabel="Pause" pendingLabel="Pausing…" />
            )}
            {campaign.status === "paused" && (
              <SimpleActionForm action={resumeCampaign} idField="campaignId" id={campaign.id} submitLabel="Resume" pendingLabel="Resuming…" />
            )}
            {(campaign.status === "approved" || campaign.status === "paused" || campaign.status === "pending_approval") && (
              <SimpleActionForm action={endCampaign} idField="campaignId" id={campaign.id} submitLabel="End campaign" pendingLabel="Ending…" tone="danger" />
            )}
            {(campaign.status === "draft" || campaign.status === "rejected") && (
              <p className="text-sm text-ink-500">Finish the form below and press Submit for approval.</p>
            )}
            {campaign.status === "ended" && <p className="text-sm text-ink-500">This campaign has ended. Its payment status can still be updated below.</p>}
          </div>
        </section>
      )}

      <CampaignForm
        action={saveCampaign}
        canEdit={canEdit}
        advertisers={advertisers.map((a) => ({ id: a.id, name: a.name, logo_url: a.logo_url }))}
        initial={{
          id: campaign.id,
          status: campaign.status,
          advertiser_id: campaign.advertiser_id,
          name: campaign.name,
          category: campaign.category as AdCategory,
          format: campaign.format as AdFormat,
          display_style: campaign.display_style as DisplayStyle,
          countdown_seconds: campaign.countdown_seconds,
          takeover_placement: campaign.takeover_placement as TakeoverPlacement,
          image_url: campaign.image_url,
          image_wide_url: campaign.image_wide_url,
          image_square_url: campaign.image_square_url,
          headline: campaign.headline,
          body: campaign.body,
          button_text: campaign.button_text,
          link_url: campaign.link_url,
          countries: campaign.countries ?? [],
          regions: campaign.regions ?? [],
          clubs: (campaign.club_ids ?? []).map((cid) => ({ id: Number(cid), name: names.get(Number(cid)) ?? `Course #${cid}` })),
          starts_at: toInputDublin(campaign.starts_at),
          ends_at: toInputDublin(campaign.ends_at),
          weight: campaign.weight,
          pricing_model: campaign.pricing_model,
          rate_eur: String(campaign.rate_eur ?? ""),
          budget_cap_eur: campaign.budget_cap_eur == null ? "" : String(campaign.budget_cap_eur),
          payment_status: campaign.payment_status,
        }}
      />
    </div>
  );
}
