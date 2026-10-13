import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { FINANCE_ROLES } from "./finance";
import type { StaffRole } from "./roles";
import { campaignView, type CampaignView } from "@/lib/advertising";
import {
  earnedBetweenCents,
  isCapReached,
  monthTotals,
  summarizeCampaign,
  utcDay,
  addDays,
  type CampaignMoney,
  type CampaignSummary,
  type DailyStat,
  type MonthTotals,
} from "@/lib/advertising-revenue";

// /admin/advertising (0139) — loaders only. Every "what counts" decision is
// in src/lib/advertising-revenue.ts (money) and src/lib/advertising.ts
// (state, validation); these just fetch rows with the service role. Every
// caller sits behind requireStaff().

/** Who may change anything in /admin/advertising. Any active staff member may look. */
export const ADVERTISING_EDIT_ROLES: readonly StaffRole[] = FINANCE_ROLES;

export const canEditAdvertising = (role: StaffRole): boolean => ADVERTISING_EDIT_ROLES.includes(role);

/** Thrown when 0139 hasn't been applied yet, so a page can say so instead of crashing. */
export class AdvertisingNotInstalledError extends Error {
  constructor() {
    super("Advertising isn't set up in the database yet — apply migration 0139_advertising.sql.");
  }
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|Could not find the table/i.test(error.message ?? "");
}

function fail(label: string, error: { code?: string; message: string }): never {
  if (isMissingTable(error)) throw new AdvertisingNotInstalledError();
  throw new Error(`Failed to load ${label}: ${error.message}`);
}

export type AdSettings = {
  ads_enabled: boolean;
  takeover_min_hours_between: number;
  new_member_ad_free_days: number;
  updated_at: string | null;
};

export const DEFAULT_AD_SETTINGS: AdSettings = {
  ads_enabled: false,
  takeover_min_hours_between: 4,
  new_member_ad_free_days: 7,
  updated_at: null,
};

export type Advertiser = {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  notes: string | null;
  created_at: string;
};

export type AdCampaignRow = CampaignMoney & {
  id: number;
  advertiser_id: number;
  name: string;
  category: string;
  format: string;
  display_style: string;
  countdown_seconds: number;
  takeover_placement: string;
  image_url: string | null;
  image_wide_url: string | null;
  image_square_url: string | null;
  headline: string | null;
  body: string | null;
  button_text: string | null;
  link_url: string;
  countries: string[];
  regions: string[];
  club_ids: number[];
  weight: number;
  sensitive_ack_at: string | null;
  reject_reason: string | null;
  end_reason: string | null;
  ended_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export const CAMPAIGN_COLUMNS =
  "id, advertiser_id, name, category, format, display_style, countdown_seconds, takeover_placement, image_url, image_wide_url, image_square_url, headline, body, button_text, link_url, countries, regions, club_ids, starts_at, ends_at, status, weight, pricing_model, rate_eur, budget_cap_eur, payment_status, sensitive_ack_at, reject_reason, end_reason, ended_at, approved_by, approved_at, created_at, updated_at";

export type CampaignListItem = AdCampaignRow & {
  advertiserName: string;
  view: CampaignView;
  summary: CampaignSummary;
  stats: DailyStat[];
};

export async function getAdSettings(): Promise<AdSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_settings")
    .select("ads_enabled, takeover_min_hours_between, new_member_ad_free_days, updated_at")
    .eq("id", true)
    .maybeSingle<AdSettings>();
  if (error) fail("advertising settings", error);
  return data ?? DEFAULT_AD_SETTINGS;
}

export async function listAdvertisers(): Promise<Advertiser[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("advertisers")
    .select("id, name, contact_name, email, phone, website, logo_url, notes, created_at")
    .order("name")
    .returns<Advertiser[]>();
  if (error) fail("advertisers", error);
  return data ?? [];
}

export async function getAdvertiser(id: number): Promise<Advertiser | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("advertisers")
    .select("id, name, contact_name, email, phone, website, logo_url, notes, created_at")
    .eq("id", id)
    .maybeSingle<Advertiser>();
  if (error) fail("advertiser", error);
  return data ?? null;
}

async function loadStats(campaignIds: number[]): Promise<Map<number, DailyStat[]>> {
  const out = new Map<number, DailyStat[]>();
  if (campaignIds.length === 0) return out;
  const admin = createAdminClient();
  // One row per campaign per day, so this stays small; paged anyway so a
  // long-running catalogue never silently stops at PostgREST's 1,000 rows.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("ad_daily_stats")
      .select("campaign_id, day, views, clicks, dismisses, anon_views, anon_clicks")
      .in("campaign_id", campaignIds)
      .order("campaign_id")
      .order("day")
      .range(from, from + 999)
      .returns<(DailyStat & { campaign_id: number })[]>();
    if (error) fail("advertising stats", error);
    for (const row of data ?? []) {
      const list = out.get(row.campaign_id) ?? [];
      list.push(row);
      out.set(row.campaign_id, list);
    }
    if (!data || data.length < 1000) return out;
  }
}

export async function listCampaigns(now: Date = new Date()): Promise<CampaignListItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_campaigns")
    .select(`${CAMPAIGN_COLUMNS}, advertisers ( name )`)
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<(AdCampaignRow & { advertisers: { name: string } | null })[]>();
  if (error) fail("campaigns", error);
  const rows = data ?? [];
  const stats = await loadStats(rows.map((r) => r.id));
  return rows.map(({ advertisers, ...c }) => {
    const s = stats.get(c.id) ?? [];
    return {
      ...c,
      advertiserName: advertisers?.name ?? "—",
      view: campaignView(c, now, isCapReached(c, s)),
      summary: summarizeCampaign(c, s, now),
      stats: s,
    };
  });
}

export async function getCampaign(id: number): Promise<(AdCampaignRow & { advertiserName: string; stats: DailyStat[] }) | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_campaigns")
    .select(`${CAMPAIGN_COLUMNS}, advertisers ( name )`)
    .eq("id", id)
    .maybeSingle<AdCampaignRow & { advertisers: { name: string } | null }>();
  if (error) fail("campaign", error);
  if (!data) return null;
  const { advertisers, ...c } = data;
  const stats = (await loadStats([id])).get(id) ?? [];
  return { ...c, advertiserName: advertisers?.name ?? "—", stats };
}

export type AdvertisingOverview = {
  settings: AdSettings;
  campaigns: CampaignListItem[];
  liveCount: number;
  last30: { views: number; clicks: number; ctr: number | null };
  month: MonthTotals;
  /** marketplace_banners fees started this month (0115), read-only alongside. */
  bannerFeesThisMonthEur: number;
};

export async function getAdvertisingOverview(now: Date = new Date()): Promise<AdvertisingOverview> {
  const [settings, campaigns] = await Promise.all([getAdSettings(), listCampaigns(now)]);
  const since = addDays(utcDay(now), -29);
  let views = 0;
  let clicks = 0;
  for (const c of campaigns) {
    for (const s of c.stats) {
      if (s.day >= since) {
        views += Number(s.views) || 0;
        clicks += Number(s.clicks) || 0;
      }
    }
  }
  const month = monthTotals(
    campaigns.map((c) => ({ campaign: c, stats: c.stats })),
    now
  );
  return {
    settings,
    campaigns,
    liveCount: campaigns.filter((c) => c.view === "live").length,
    last30: { views, clicks, ctr: views > 0 ? clicks / views : null },
    month,
    bannerFeesThisMonthEur: await bannerFeesThisMonth(now),
  };
}

async function bannerFeesThisMonth(now: Date): Promise<number> {
  const admin = createAdminClient();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await admin
    .from("marketplace_banners")
    .select("fee_eur")
    .gte("starts_at", start)
    .lte("starts_at", now.toISOString())
    .returns<{ fee_eur: number | string | null }[]>();
  if (error) return 0; // read-only extra; never block the page on it
  return (data ?? []).reduce((cents, r) => cents + Math.round(Number(r.fee_eur ?? 0) * 100), 0) / 100;
}

/**
 * Advertising earned in a period, for the marketplace revenue dashboard's
 * total. Zero (not an error) when 0139 isn't applied, so that dashboard
 * keeps working either way.
 */
export async function advertisingEarnedBetween(start: Date | null, now: Date = new Date()): Promise<{ earnedEur: number; available: boolean }> {
  try {
    const campaigns = await listCampaigns(now);
    const from = start ? utcDay(start) : "1970-01-01";
    const to = utcDay(now);
    const cents = campaigns.reduce((acc, c) => acc + earnedBetweenCents(c, c.stats, from, to), 0);
    return { earnedEur: cents / 100, available: true };
  } catch {
    return { earnedEur: 0, available: false };
  }
}

/** Course names for the targeting picker and the campaign table. */
export async function clubNames(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const admin = createAdminClient();
  const { data } = await admin.from("clubs").select("id, name").in("id", ids).returns<{ id: number; name: string }[]>();
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}
