import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// /admin/marketplace — Revenue, Pro shops and Promotions tabs (0114/0115).
//
// Same split as the rest of src/lib/admin: the pure helpers at the top of
// this file hold every "what counts as revenue" decision and are unit-tested
// in marketplace-revenue.test.ts without Supabase; the async loaders at the
// bottom only fetch rows (service role, every caller sits behind
// requireStaff()) and hand them to those helpers.
//
// What counts as PinPals revenue:
//   * Buyer Protection — orders.platform_fee_eur on paid orders (€0.70 + 5%,
//     paid by the buyer on a member's own sale; 0 on a shop sale).
//   * Shop commission — orders.seller_commission_eur on paid orders (kept
//     back from a pro shop's transfer; 0 on a member's own sale).
//   * Promotions — listing_promotions.amount_eur of rows that were actually
//     paid for (status active or expired; pending never paid, cancelled and
//     refunded are excluded).
//   * Banner fees — marketplace_banners.fee_eur, booked on the banner's
//     starts_at.
// Affiliate clicks are counted, not valued: the retailer pays on its own
// reports, outside PinPals.

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export const REVENUE_PERIODS = ["7d", "30d", "90d", "all"] as const;
export type RevenuePeriod = (typeof REVENUE_PERIODS)[number];

export const REVENUE_PERIOD_LABELS: Record<RevenuePeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

const PERIOD_DAYS: Record<Exclude<RevenuePeriod, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** `?period=` → a known period, defaulting to 30 days for anything else. */
export function parseRevenuePeriod(value: string | null | undefined): RevenuePeriod {
  return (REVENUE_PERIODS as readonly string[]).includes(value ?? "") ? (value as RevenuePeriod) : "30d";
}

/** The start of the period, or null for "all time". */
export function periodStart(period: RevenuePeriod, now: Date = new Date()): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}

/** Numeric columns can arrive as strings from PostgREST; null/garbage is 0. */
export function toAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Sums euro amounts in whole cents so 0.1 + 0.2 never shows as 0.30000000000000004. */
export function sumEur(values: readonly unknown[]): number {
  const cents = values.reduce<number>((acc, v) => acc + Math.round(toAmount(v) * 100), 0);
  return cents / 100;
}

export type RevenueOrderRow = {
  total_eur: number | string | null;
  platform_fee_eur: number | string | null;
  seller_commission_eur: number | string | null;
  store_id: number | null;
};

export type OrderRevenueSummary = {
  paidOrders: number;
  shopOrders: number;
  gmvEur: number;
  buyerProtectionEur: number;
  shopCommissionEur: number;
};

/** Paid orders → GMV, Buyer Protection and shop commission. Callers pass paid orders only. */
export function summarizeOrderRevenue(orders: readonly RevenueOrderRow[]): OrderRevenueSummary {
  return {
    paidOrders: orders.length,
    shopOrders: orders.filter((o) => o.store_id != null).length,
    gmvEur: sumEur(orders.map((o) => o.total_eur)),
    buyerProtectionEur: sumEur(orders.map((o) => o.platform_fee_eur)),
    shopCommissionEur: sumEur(orders.map((o) => o.seller_commission_eur)),
  };
}

export type PromotionKindKey = "featured" | "bump";
export const PROMOTION_KIND_LABELS: Record<string, string> = { featured: "Featured", bump: "Bump" };

/** Statuses that mean the seller actually paid (and wasn't refunded). */
export const PAID_PROMOTION_STATUSES = ["active", "expired"] as const;

export type PromotionRevenueSummary = {
  count: number;
  totalEur: number;
  byKind: Record<PromotionKindKey, { count: number; totalEur: number }>;
};

export function summarizePromotionRevenue(
  rows: readonly { kind: string; status: string; amount_eur: number | string | null }[]
): PromotionRevenueSummary {
  const paid = rows.filter((r) => (PAID_PROMOTION_STATUSES as readonly string[]).includes(r.status));
  const byKind = (kind: PromotionKindKey) => {
    const ofKind = paid.filter((r) => r.kind === kind);
    return { count: ofKind.length, totalEur: sumEur(ofKind.map((r) => r.amount_eur)) };
  };
  return {
    count: paid.length,
    totalEur: sumEur(paid.map((r) => r.amount_eur)),
    byKind: { featured: byKind("featured"), bump: byKind("bump") },
  };
}

/** Banner fees booked in the period: banners whose starts_at falls in [start, now]. */
export function summarizeBannerFees(
  rows: readonly { starts_at: string; fee_eur: number | string | null }[],
  start: Date | null,
  now: Date = new Date()
): { count: number; totalEur: number } {
  const inPeriod = rows.filter((r) => {
    const t = new Date(r.starts_at).getTime();
    if (Number.isNaN(t) || t > now.getTime()) return false;
    return start == null || t >= start.getTime();
  });
  return { count: inPeriod.length, totalEur: sumEur(inPeriod.map((r) => r.fee_eur)) };
}

/** Click rows → the most-clicked product ids, most first (ties: lower id first). */
export function topClickedProducts(
  clicks: readonly { product_id: number }[],
  limit = 5
): { productId: number; clicks: number }[] {
  const counts = new Map<number, number>();
  for (const c of clicks) counts.set(c.product_id, (counts.get(c.product_id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([productId, n]) => ({ productId, clicks: n }))
    .sort((a, b) => b.clicks - a.clicks || a.productId - b.productId)
    .slice(0, limit);
}

/**
 * What PinPals is holding right now for sellers: the buyer's total less the
 * Buyer Protection fee (which is PinPals' own money, never owed on). Shop
 * commission is still inside this figure — it's only kept back on release.
 */
export function heldForSellersEur(
  orders: readonly { total_eur: number | string | null; platform_fee_eur: number | string | null }[]
): number {
  return sumEur(orders.map((o) => Math.round(toAmount(o.total_eur) * 100 - toAmount(o.platform_fee_eur) * 100) / 100));
}

/** Held orders whose automatic release falls between now and now + days (overdue included). */
export function releasesDueWithin<T extends { release_due_at: string | null; problem_at: string | null }>(
  orders: readonly T[],
  days: number,
  now: Date = new Date()
): T[] {
  const until = now.getTime() + days * DAY_MS;
  return orders
    .filter((o) => o.release_due_at && !o.problem_at && new Date(o.release_due_at).getTime() <= until)
    .sort((a, b) => new Date(a.release_due_at!).getTime() - new Date(b.release_due_at!).getTime());
}

/** Whether a banner is showing right now: active and inside its schedule. */
export function isBannerLive(
  b: { active: boolean; starts_at: string; ends_at: string | null },
  now: Date = new Date()
): boolean {
  const t = now.getTime();
  return b.active && new Date(b.starts_at).getTime() <= t && (!b.ends_at || new Date(b.ends_at).getTime() > t);
}

/** Click-through rate as a percentage string, or "—" with no impressions. */
export function formatCtr(impressions: number, clicks: number): string {
  if (!impressions || impressions <= 0) return "—";
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

export type StoreStats = { itemsInStock: number; salesCount: number; commissionEur: number };

/** Per-store active listing counts and paid sales/commission, keyed by store id. */
export function aggregateStoreStats(
  listings: readonly { store_id: number | null }[],
  paidOrders: readonly { store_id: number | null; seller_commission_eur: number | string | null }[]
): Map<number, StoreStats> {
  const stats = new Map<number, { itemsInStock: number; salesCount: number; commissionCents: number }>();
  const get = (id: number) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { itemsInStock: 0, salesCount: 0, commissionCents: 0 }));
    return s;
  };
  for (const l of listings) if (l.store_id != null) get(l.store_id).itemsInStock += 1;
  for (const o of paidOrders) {
    if (o.store_id == null) continue;
    const s = get(o.store_id);
    s.salesCount += 1;
    s.commissionCents += Math.round(toAmount(o.seller_commission_eur) * 100);
  }
  return new Map(
    [...stats.entries()].map(([id, s]) => [
      id,
      { itemsInStock: s.itemsInStock, salesCount: s.salesCount, commissionEur: s.commissionCents / 100 },
    ])
  );
}

/** Admin input "8" or "8.5" (percent) → stored commission_rate 0.08/0.085, 0–50% only. */
export function parseCommissionPercent(input: unknown): number | null {
  const raw = String(input ?? "").trim().replace(/%$/, "").trim();
  if (!/^\d{1,2}(\.\d{1,1})?$/.test(raw)) return null;
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) return null;
  // numeric(4,3) — three decimal places of a rate is a tenth of a percent.
  return Math.round(pct * 10) / 1000;
}

/** 0.08 → "8%", 0.085 → "8.5%". */
export function formatCommissionRate(rate: number | string | null): string {
  const pct = Math.round(toAmount(rate) * 1000) / 10;
  return `${pct}%`;
}

// ---------------------------------------------------------------------------
// Loaders (service role)
// ---------------------------------------------------------------------------

const PAGE = 1000;

/**
 * PostgREST caps a response at 1,000 rows by default; the revenue totals
 * must not silently stop at the cap, so this pages through until a short
 * page comes back. `build` is called fresh for each page.
 */
async function fetchAllRows<T>(
  label: string,
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to load ${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

type PersonName = { first_name: string; last_name: string };

async function loadPeople(ids: string[]): Promise<Map<string, PersonName>> {
  if (ids.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", ids)
    .returns<(PersonName & { id: string })[]>();
  if (error) throw new Error(`Failed to load profiles: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.id, { first_name: p.first_name, last_name: p.last_name }]));
}

export type HeldOrderRow = {
  id: number;
  listing_title: string;
  total_eur: number;
  platform_fee_eur: number;
  release_due_at: string | null;
  problem_at: string | null;
  released_at: string | null;
  fulfilment_status: string | null;
  store_id: number | null;
};

export type MarketplaceRevenue = {
  period: RevenuePeriod;
  orders: OrderRevenueSummary;
  promotions: PromotionRevenueSummary;
  banners: { count: number; totalEur: number };
  affiliate: { clicks: number; top: { productId: number; title: string; retailer: string; clicks: number }[] };
  totalRevenueEur: number;
  live: {
    heldCount: number;
    heldEur: number;
    releasesDue: HeldOrderRow[];
    problems: HeldOrderRow[];
  };
};

const HELD_COLUMNS =
  "id, listing_title, total_eur, platform_fee_eur, release_due_at, problem_at, released_at, fulfilment_status, store_id";

export async function getMarketplaceRevenue(period: RevenuePeriod, now: Date = new Date()): Promise<MarketplaceRevenue> {
  const admin = createAdminClient();
  const start = periodStart(period, now);
  const startIso = start?.toISOString() ?? null;

  const [paidOrders, promotions, banners, clicks, held, problems] = await Promise.all([
    // Booked on created_at: orders has no paid_at column, and a paid order
    // is created and paid within minutes (checkout), so the two agree.
    fetchAllRows<RevenueOrderRow>("paid orders", (from, to) => {
      let q = admin
        .from("orders")
        .select("total_eur, platform_fee_eur, seller_commission_eur, store_id")
        .eq("payment_status", "paid")
        .order("id")
        .range(from, to);
      if (startIso) q = q.gte("created_at", startIso);
      return q.returns<RevenueOrderRow[]>();
    }),
    fetchAllRows<{ kind: string; status: string; amount_eur: number }>("promotions", (from, to) => {
      let q = admin
        .from("listing_promotions")
        .select("kind, status, amount_eur")
        .in("status", [...PAID_PROMOTION_STATUSES])
        .order("id")
        .range(from, to);
      if (startIso) q = q.gte("starts_at", startIso);
      return q.returns<{ kind: string; status: string; amount_eur: number }[]>();
    }),
    fetchAllRows<{ starts_at: string; fee_eur: number | null }>("banners", (from, to) => {
      let q = admin.from("marketplace_banners").select("starts_at, fee_eur").order("id").range(from, to);
      if (startIso) q = q.gte("starts_at", startIso);
      return q.returns<{ starts_at: string; fee_eur: number | null }[]>();
    }),
    fetchAllRows<{ product_id: number }>("affiliate clicks", (from, to) => {
      let q = admin.from("affiliate_clicks").select("product_id").order("id").range(from, to);
      if (startIso) q = q.gte("created_at", startIso);
      return q.returns<{ product_id: number }[]>();
    }),
    fetchAllRows<HeldOrderRow>("held orders", (from, to) =>
      admin
        .from("orders")
        .select(HELD_COLUMNS)
        .eq("payment_status", "paid")
        .eq("payout_status", "held")
        .order("id")
        .range(from, to)
        .returns<HeldOrderRow[]>()
    ),
    fetchAllRows<HeldOrderRow>("problem orders", (from, to) =>
      admin
        .from("orders")
        .select(HELD_COLUMNS)
        .not("problem_at", "is", null)
        .is("released_at", null)
        .order("problem_at", { ascending: true })
        .range(from, to)
        .returns<HeldOrderRow[]>()
    ),
  ]);

  const orders = summarizeOrderRevenue(paidOrders);
  const promo = summarizePromotionRevenue(promotions);
  const bannerFees = summarizeBannerFees(banners, start, now);
  const top = topClickedProducts(clicks, 5);

  const { data: products, error: productsError } = top.length
    ? await admin
        .from("affiliate_products")
        .select("id, title, retailer")
        .in("id", top.map((t) => t.productId))
        .returns<{ id: number; title: string; retailer: string }[]>()
    : { data: [] as { id: number; title: string; retailer: string }[], error: null };
  if (productsError) throw new Error(`Failed to load affiliate products: ${productsError.message}`);
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  return {
    period,
    orders,
    promotions: promo,
    banners: bannerFees,
    affiliate: {
      clicks: clicks.length,
      top: top.map((t) => ({
        productId: t.productId,
        title: productById.get(t.productId)?.title ?? `Product #${t.productId}`,
        retailer: productById.get(t.productId)?.retailer ?? "—",
        clicks: t.clicks,
      })),
    },
    totalRevenueEur: sumEur([orders.buyerProtectionEur, orders.shopCommissionEur, promo.totalEur, bannerFees.totalEur]),
    live: {
      heldCount: held.length,
      heldEur: heldForSellersEur(held),
      releasesDue: releasesDueWithin(held, 3, now),
      problems,
    },
  };
}

// ---------- Pro shops ----------

export type StoreStatus = "pending" | "active" | "suspended";
export const STORE_STATUSES: readonly StoreStatus[] = ["pending", "active", "suspended"];

export type AdminStoreRow = {
  id: number;
  slug: string;
  name: string;
  club_id: number | null;
  owner_id: string;
  status: StoreStatus;
  commission_rate: number;
  approved_at: string | null;
  created_at: string;
  owner: PersonName | null;
  clubName: string | null;
} & StoreStats;

export async function listStoresForAdmin(): Promise<AdminStoreRow[]> {
  const admin = createAdminClient();
  type StoreRow = Omit<AdminStoreRow, "owner" | "clubName" | keyof StoreStats>;

  const { data: stores, error } = await admin
    .from("stores")
    .select("id, slug, name, club_id, owner_id, status, commission_rate, approved_at, created_at")
    .order("created_at", { ascending: false })
    .returns<StoreRow[]>();
  if (error) throw new Error(`Failed to list stores: ${error.message}`);
  const rows = stores ?? [];
  if (rows.length === 0) return [];

  const storeIds = rows.map((s) => s.id);
  const clubIds = [...new Set(rows.map((s) => s.club_id).filter((id): id is number => id != null))];

  const [owners, clubsResult, listings, orders] = await Promise.all([
    loadPeople([...new Set(rows.map((s) => s.owner_id))]),
    clubIds.length
      ? admin.from("clubs").select("id, name").in("id", clubIds).returns<{ id: number; name: string }[]>()
      : Promise.resolve({ data: [] as { id: number; name: string }[], error: null }),
    fetchAllRows<{ store_id: number | null }>("shop listings", (from, to) =>
      admin
        .from("listings")
        .select("store_id")
        .in("store_id", storeIds)
        .eq("status", "active")
        .order("id")
        .range(from, to)
        .returns<{ store_id: number | null }[]>()
    ),
    fetchAllRows<{ store_id: number | null; seller_commission_eur: number }>("shop orders", (from, to) =>
      admin
        .from("orders")
        .select("store_id, seller_commission_eur")
        .in("store_id", storeIds)
        .eq("payment_status", "paid")
        .order("id")
        .range(from, to)
        .returns<{ store_id: number | null; seller_commission_eur: number }[]>()
    ),
  ]);
  if (clubsResult.error) throw new Error(`Failed to load clubs: ${clubsResult.error.message}`);
  const clubById = new Map((clubsResult.data ?? []).map((c) => [c.id, c.name]));
  const stats = aggregateStoreStats(listings, orders);

  return rows.map((s) => ({
    ...s,
    commission_rate: toAmount(s.commission_rate),
    owner: owners.get(s.owner_id) ?? null,
    clubName: s.club_id != null ? clubById.get(s.club_id) ?? null : null,
    ...(stats.get(s.id) ?? { itemsInStock: 0, salesCount: 0, commissionEur: 0 }),
  }));
}

// ---------- Promotions ----------

export const PROMOTION_STATUSES = ["pending", "active", "expired", "cancelled", "refunded"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];
export const PROMOTIONS_PAGE_SIZE = 50;

export type AdminPromotionRow = {
  id: number;
  listing_id: number;
  seller_id: string;
  kind: string;
  amount_eur: number;
  status: PromotionStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  listingTitle: string | null;
  seller: PersonName | null;
};

export async function listPromotionsForAdmin(
  filters: { status?: PromotionStatus } = {},
  page = 1
): Promise<{ rows: AdminPromotionRow[]; total: number; pageSize: number }> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * PROMOTIONS_PAGE_SIZE;

  let q = admin
    .from("listing_promotions")
    .select("id, listing_id, seller_id, kind, amount_eur, status, starts_at, ends_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PROMOTIONS_PAGE_SIZE - 1);
  if (filters.status) q = q.eq("status", filters.status);

  type Row = Omit<AdminPromotionRow, "listingTitle" | "seller">;
  const { data, error, count } = await q.returns<Row[]>();
  if (error) throw new Error(`Failed to list promotions: ${error.message}`);
  const rows = data ?? [];

  const listingIds = [...new Set(rows.map((r) => r.listing_id))];
  const [sellers, listingsResult] = await Promise.all([
    loadPeople([...new Set(rows.map((r) => r.seller_id))]),
    listingIds.length
      ? admin.from("listings").select("id, title").in("id", listingIds).returns<{ id: number; title: string }[]>()
      : Promise.resolve({ data: [] as { id: number; title: string }[], error: null }),
  ]);
  if (listingsResult.error) throw new Error(`Failed to load listings: ${listingsResult.error.message}`);
  const titleById = new Map((listingsResult.data ?? []).map((l) => [l.id, l.title]));

  return {
    rows: rows.map((r) => ({
      ...r,
      amount_eur: toAmount(r.amount_eur),
      listingTitle: titleById.get(r.listing_id) ?? null,
      seller: sellers.get(r.seller_id) ?? null,
    })),
    total: count ?? 0,
    pageSize: PROMOTIONS_PAGE_SIZE,
  };
}

// ---------- Retail & ads ----------

export type AdminAffiliateProduct = {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  price_eur: number | null;
  was_price_eur: number | null;
  image_url: string | null;
  retailer: string;
  url: string;
  active: boolean;
  sort_order: number;
  clicks: number;
  created_at: string;
};

export type AdminBanner = {
  id: number;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string;
  sponsor: string;
  placement: "new_gear" | "used_gear";
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  impressions: number;
  clicks: number;
  fee_eur: number | null;
  created_at: string;
  /** Computed at load time — see isBannerLive(). */
  live: boolean;
};

export async function listAffiliateProductsForAdmin(): Promise<AdminAffiliateProduct[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("affiliate_products")
    .select("id, title, brand, category, price_eur, was_price_eur, image_url, retailer, url, active, sort_order, clicks, created_at")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .returns<AdminAffiliateProduct[]>();
  if (error) throw new Error(`Failed to list affiliate products: ${error.message}`);
  return data ?? [];
}

export async function listBannersForAdmin(): Promise<AdminBanner[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketplace_banners")
    .select(
      "id, eyebrow, title, subtitle, image_url, link_url, sponsor, placement, starts_at, ends_at, active, impressions, clicks, fee_eur, created_at"
    )
    .order("starts_at", { ascending: false })
    .order("id", { ascending: false })
    .returns<Omit<AdminBanner, "live">[]>();
  if (error) throw new Error(`Failed to list banners: ${error.message}`);
  const now = new Date();
  return (data ?? []).map((b) => ({ ...b, live: isBannerLive(b, now) }));
}
