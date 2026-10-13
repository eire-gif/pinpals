import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import {
  AdvertisingNotInstalledError,
  canEditAdvertising,
  getAdvertisingOverview,
  type AdvertisingOverview,
  type CampaignListItem,
} from "@/lib/admin/advertising";
import {
  AD_FORMAT_INFO,
  CAMPAIGN_FILTERS,
  PAYMENT_LABELS,
  matchesFilter,
  parseCampaignFilter,
  type AdFormat,
  type CampaignFilter,
} from "@/lib/advertising";
import { formatRate } from "@/lib/advertising-revenue";
import StatCard from "@/components/admin/stat-card";
import FieldsActionForm from "@/components/admin/fields-action-form";
import SimpleActionForm from "@/components/admin/simple-action-form";
import { AdvertisingHeader, CampaignBadge, NewCampaignLink, NotInstalled, Panel, dateOnly, eur } from "./bits";
import { saveAdSettings, setAdsEnabled } from "./actions";

// /admin/advertising — the overview: headline figures, the approval queue,
// every campaign (filterable), the house rules and the master switch.
// Any active staff member may look; editing is ADVERTISING_EDIT_ROLES only
// (checked again inside every action).

const FILTER_LABELS: Record<CampaignFilter, string> = {
  all: "All",
  live: "Live",
  scheduled: "Scheduled",
  pending: "Pending",
  ended: "Ended",
};

export default async function AdvertisingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { staff } = await requireStaff();
  const canEdit = canEditAdvertising(staff.role);
  const filter = parseCampaignFilter((await searchParams).filter);

  let data: AdvertisingOverview;
  try {
    data = await getAdvertisingOverview();
  } catch (err) {
    if (err instanceof AdvertisingNotInstalledError) {
      return (
        <div>
          <AdvertisingHeader current="/admin/advertising" title="Advertising" />
          <NotInstalled />
        </div>
      );
    }
    throw err;
  }

  const { settings, campaigns } = data;
  const pending = campaigns.filter((c) => c.view === "pending");
  const shown = campaigns.filter((c) => matchesFilter(c.view, filter));
  const counts = Object.fromEntries(CAMPAIGN_FILTERS.map((f) => [f, campaigns.filter((c) => matchesFilter(c.view, f)).length])) as Record<CampaignFilter, number>;

  return (
    <div>
      <AdvertisingHeader
        current="/admin/advertising"
        title="Advertising"
        subtitle="Takeovers, banners, sponsored posts and course partners in the PinPals app. Nothing shows to members unless advertising is switched on here and in the app."
        actions={canEdit ? <NewCampaignLink /> : null}
      />

      <MasterSwitch enabled={settings.ads_enabled} canEdit={canEdit} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Live campaigns" value={String(data.liveCount)} hint={`${counts.scheduled} scheduled · ${counts.pending} awaiting approval`} />
        <StatCard label="Views · 30 days" value={data.last30.views.toLocaleString("en-IE")} hint="Billable: once per member per hour" />
        <StatCard
          label="Clicks · 30 days"
          value={data.last30.clicks.toLocaleString("en-IE")}
          hint={`CTR ${formatRate(data.last30.ctr)}`}
        />
        <StatCard
          label="Ad revenue this month"
          value={eur(data.month.earnedEur)}
          accent
          hint={`Outstanding ${eur(data.month.outstandingEur)}${data.bannerFeesThisMonthEur ? ` · Marketplace banners ${eur(data.bannerFeesThisMonthEur)}` : ""}`}
        />
      </div>

      {pending.length > 0 && (
        <div className="mb-8">
          <Panel title={`Waiting for approval · ${pending.length}`}>
            <ul className="divide-y divide-line">
              {pending.map((c) => (
                <li key={c.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink-900">
                      {c.name}
                      {(c.category === "alcohol" || c.category === "betting") && (
                        <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-red-600">{c.category} · needs confirmation</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500">
                      {c.advertiserName} · {AD_FORMAT_INFO[c.format as AdFormat]?.label ?? c.format} · {dateOnly(c.starts_at)} → {dateOnly(c.ends_at)}
                    </div>
                  </div>
                  <Link href={`/admin/advertising/${c.id}`} className="text-sm font-bold text-green-700 underline">
                    Review →
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
        <Panel
          title="Campaigns"
          aside={
            <div className="flex flex-wrap gap-1.5">
              {CAMPAIGN_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={f === "all" ? "/admin/advertising" : `/admin/advertising?filter=${f}`}
                  className={`px-3 py-1 rounded-full text-xs font-bold border transition ${
                    f === filter ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line text-ink-500 hover:text-ink-900 bg-surface"
                  }`}
                >
                  {FILTER_LABELS[f]} {counts[f] > 0 ? <span className="opacity-70">{counts[f]}</span> : null}
                </Link>
              ))}
            </div>
          }
        >
          {shown.length === 0 ? (
            <p className="text-sm text-ink-500 px-5 pb-6">
              {campaigns.length === 0 ? "No campaigns yet." : `No ${FILTER_LABELS[filter].toLowerCase()} campaigns.`}
              {canEdit && campaigns.length === 0 && (
                <>
                  {" "}
                  <Link href="/admin/advertising/new" className="underline font-semibold text-green-700">
                    Create the first one
                  </Link>
                  .
                </>
              )}
            </p>
          ) : (
            <CampaignTable rows={shown} />
          )}
        </Panel>

        <HouseRules settings={settings} canEdit={canEdit} />
      </div>
    </div>
  );
}

function MasterSwitch({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  return (
    <div
      className={`mb-8 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 border ${
        enabled ? "bg-navy-900 border-navy-900 text-cream-50" : "bg-surface border-line"
      }`}
    >
      <div>
        <div className={`text-xs uppercase tracking-wide font-bold ${enabled ? "text-gold-400" : "text-ink-500"}`}>Master switch</div>
        <div className={`font-display font-bold text-xl ${enabled ? "text-cream-50" : "text-ink-900"}`}>
          Advertising is {enabled ? "on" : "off"}
        </div>
        <div className={`text-xs mt-0.5 ${enabled ? "text-cream-100" : "text-ink-500"}`}>
          {enabled
            ? "Approved campaigns are showing to members (on app versions with the ads flag on)."
            : "No advert shows anywhere, whatever its status. Campaigns can still be set up and approved."}
        </div>
      </div>
      {canEdit && (
        <SimpleActionForm
          key={String(enabled)}
          action={setAdsEnabled}
          idField="enabled"
          id={enabled ? "off" : "on"}
          submitLabel={enabled ? "Turn advertising off" : "Turn advertising on"}
          pendingLabel="Saving…"
          tone={enabled ? "danger" : "default"}
        />
      )}
    </div>
  );
}

function CampaignTable({ rows }: { rows: CampaignListItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-5 py-3">Campaign</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Runs</th>
            <th className="px-3 py-3 text-right">Views</th>
            <th className="px-3 py-3 text-right">Clicks</th>
            <th className="px-3 py-3 text-right">CTR</th>
            <th className="px-3 py-3 text-right">Earned</th>
            <th className="px-5 py-3">Paid</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface-tint">
              <td className="px-5 py-3">
                <Link href={`/admin/advertising/${c.id}`} className="font-semibold text-ink-900 hover:underline">
                  {c.name}
                </Link>
                <div className="text-xs text-ink-500">
                  {c.advertiserName} · {AD_FORMAT_INFO[c.format as AdFormat]?.label ?? c.format}
                </div>
              </td>
              <td className="px-3 py-3">
                <CampaignBadge view={c.view} />
              </td>
              <td className="px-3 py-3 text-ink-500 whitespace-nowrap">
                {dateOnly(c.starts_at)} → {dateOnly(c.ends_at)}
              </td>
              <td className="px-3 py-3 text-right">{c.summary.views.toLocaleString("en-IE")}</td>
              <td className="px-3 py-3 text-right">{c.summary.clicks.toLocaleString("en-IE")}</td>
              <td className="px-3 py-3 text-right">{formatRate(c.summary.ctr)}</td>
              <td className="px-3 py-3 text-right font-semibold">{eur(c.summary.earnedEur)}</td>
              <td className="px-5 py-3 text-ink-500">{PAYMENT_LABELS[c.payment_status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inputCls = "w-24 text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface";

function HouseRules({ settings, canEdit }: { settings: AdvertisingOverview["settings"]; canEdit: boolean }) {
  return (
    <Panel title="House rules">
      <div className="px-5 pb-5 text-sm text-ink-900">
        <ul className="space-y-2 mb-4 text-ink-500">
          <li>
            One takeover per member every <strong className="text-ink-900">{settings.takeover_min_hours_between} hours</strong> at most.
          </li>
          <li>
            New members see no adverts for their first <strong className="text-ink-900">{settings.new_member_ad_free_days} days</strong>.
          </li>
          <li>Never during live scoring, hole maps, checkout or onboarding.</li>
          <li>Alcohol and betting need approval with a suitability confirmation.</li>
          <li>Views bill once per member per hour; clicks once per day.</li>
        </ul>
        {canEdit && (
          <FieldsActionForm action={saveAdSettings} submitLabel="Save rules" pendingLabel="Saving…">
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Hours between takeovers</span>
              <input name="takeover_min_hours_between" type="number" min={0} max={168} required defaultValue={settings.takeover_min_hours_between} className={inputCls} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Ad-free days for new members</span>
              <input name="new_member_ad_free_days" type="number" min={0} max={365} required defaultValue={settings.new_member_ad_free_days} className={inputCls} />
            </label>
          </FieldsActionForm>
        )}
      </div>
    </Panel>
  );
}
