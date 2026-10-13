/**
 * Advertising revenue (0139). Pure: no Supabase, no Next, no clock unless
 * passed in — every "what has this advertiser earned us" decision lives here
 * and is unit-tested in advertising-revenue.test.ts.
 *
 * Money is handled in whole euro CENTS (integers) throughout. Numeric
 * columns arrive from PostgREST as strings ("12.50"); they are parsed
 * digit-by-digit, never through a float multiply, and the only division —
 * spreading a flat fee over days, or views ÷ 1,000 — rounds half to even
 * ("banker's rounding"), so pennies don't drift one way over many rows.
 *
 * THE RULES
 *
 *   Billable views/clicks are the de-duplicated counts ad_log() keeps in
 *   ad_daily_stats.views / .clicks (signed-in members only: a view once per
 *   member per campaign per clock hour, a click once per UTC day). Anonymous
 *   website views (anon_views) are reported but never billed.
 *
 *   flat  Contract value = rate_eur. Earned is spread evenly over the run's
 *         UTC calendar days: rate × (days begun ÷ total days), capped at the
 *         rate. A day counts as soon as it starts. Pausing or ending a flat
 *         deal early doesn't change what's earned — agree a refund and
 *         change the rate if that's the deal. Booked = full value once
 *         approved.
 *   cpm   Earned = billable views ÷ 1,000 × rate_eur, capped at
 *         budget_cap_eur when set. Booked = the cap if set, else earned.
 *   cpc   Earned = billable clicks × rate_eur, same cap. Booked as cpm.
 *
 *   A campaign never approved (draft, first-time pending, rejected) earns and
 *   books 0.
 *
 *   Paid: payment_status 'paid' means the full BOOKED amount has been paid;
 *   'waived' means nothing is owed; 'unpaid'/'invoiced' mean nothing paid yet.
 *   Outstanding = max(0, earned − paid), and 0 when waived.
 *
 *   Effective CPM = earned ÷ billable views × 1,000 — lets a flat deal be
 *   compared with a CPM one. CTR = billable clicks ÷ billable views.
 *
 *   Period figures (a month, a report day) are cumulative-earned at the end
 *   of the period minus cumulative-earned before it, so days always add up to
 *   the total and a cap reached mid-period is respected exactly.
 */

export const PRICING_MODELS = ["flat", "cpm", "cpc"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const CAMPAIGN_STATUSES = ["draft", "pending_approval", "approved", "paused", "ended", "rejected"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "invoiced", "paid", "waived"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type Numeric = number | string | null | undefined;

/** The money-relevant columns of an ad_campaigns row. */
export type CampaignMoney = {
  pricing_model: PricingModel;
  rate_eur: Numeric;
  budget_cap_eur: Numeric;
  starts_at: string;
  ends_at: string | null;
  status: CampaignStatus;
  payment_status: PaymentStatus;
  approved_at: string | null;
};

/** One ad_daily_stats row. `day` is a UTC date, YYYY-MM-DD. */
export type DailyStat = {
  day: string;
  views: number;
  clicks: number;
  dismisses?: number;
  anon_views?: number;
  anon_clicks?: number;
};

// ---------------------------------------------------------------------------
// Cents
// ---------------------------------------------------------------------------

/**
 * Euros → whole cents: "12.50" → 1250, 0.1 + 0.2 → 30. A numeric(10,2)
 * column never carries more than two decimals; anything further (typed
 * input, float noise) is rounded half to even. Null, empty and garbage are 0.
 */
export function toCents(value: Numeric): number {
  if (value == null) return 0;
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(6) : "") : String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const whole = Number(m[2]);
  const frac = (m[3] ?? "").padEnd(2, "0");
  const base = whole * 100 + Number(frac.slice(0, 2));
  const rest = frac.slice(2).replace(/0+$/, "");
  if (!rest) return sign * base;
  // Half-to-even on the remaining digits.
  const first = Number(rest[0]);
  const tail = rest.slice(1).length > 0;
  let up = first > 5 || (first === 5 && tail);
  if (first === 5 && !tail) up = base % 2 === 1;
  return sign * (base + (up ? 1 : 0));
}

export const centsToEur = (cents: number): number => cents / 100;

/** numerator ÷ denominator for non-negative integers, rounded half to even. */
export function divRoundHalfEven(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("denominator must be positive");
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  if (r * 2 > denominator) return q + 1;
  if (r * 2 < denominator) return q;
  return q % 2 === 0 ? q : q + 1;
}

// ---------------------------------------------------------------------------
// Days (UTC calendar dates as YYYY-MM-DD strings)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function utcDay(at: Date | string): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive count of days from a to b; 0 when b is before a. */
export function daysInclusive(a: string, b: string): number {
  const diff = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
  return diff < 0 ? 0 : diff + 1;
}

/** First and last UTC day of the month containing `at`. */
export function monthBounds(at: Date): { first: string; last: string } {
  const first = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { first: utcDay(first), last: utcDay(new Date(next.getTime() - DAY_MS)) };
}

/** The UTC days a flat run covers: from its start day to the day of its last instant. */
export function runDays(c: Pick<CampaignMoney, "starts_at" | "ends_at">): { first: string; last: string; total: number } | null {
  if (!c.ends_at) return null;
  const first = utcDay(c.starts_at);
  const last = utcDay(new Date(new Date(c.ends_at).getTime() - 1));
  const total = daysInclusive(first, last);
  return total > 0 ? { first, last, total } : null;
}

// ---------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------

/**
 * Whether the campaign was approved to run — the only ones that earn. An
 * approved advert whose creative was edited goes back to pending_approval
 * but keeps approved_at, and keeps earning while it's re-checked.
 */
export function hasBeenApproved(c: Pick<CampaignMoney, "status" | "approved_at">): boolean {
  if (c.status === "draft" || c.status === "rejected") return false;
  return c.status === "approved" || c.approved_at != null;
}

function sumThrough(stats: readonly DailyStat[], throughDay: string, key: "views" | "clicks"): number {
  let n = 0;
  for (const s of stats) if (s.day <= throughDay) n += Number(s[key]) || 0;
  return n;
}

/** CPM/CPC cost of these billable counts, before any cap. */
function uncappedUsageCents(c: CampaignMoney, views: number, clicks: number): number {
  const rate = toCents(c.rate_eur);
  if (c.pricing_model === "cpm") return divRoundHalfEven(views * rate, 1000);
  if (c.pricing_model === "cpc") return clicks * rate;
  return 0;
}

/** Same rule as ad_campaign_capped() in 0139: usage has reached the cap. */
export function isCapReached(c: CampaignMoney, stats: readonly DailyStat[]): boolean {
  if (c.pricing_model === "flat" || c.budget_cap_eur == null || c.budget_cap_eur === "") return false;
  const cap = toCents(c.budget_cap_eur);
  if (cap <= 0) return false;
  const rate = toCents(c.rate_eur);
  const views = sumThrough(stats, "9999-12-31", "views");
  const clicks = sumThrough(stats, "9999-12-31", "clicks");
  // Compared unrounded, as SQL does: views × rate / 1000 ≥ cap ⇔ views × rate ≥ cap × 1000.
  return c.pricing_model === "cpm" ? views * rate >= cap * 1000 : clicks * rate >= cap;
}

/** Earned in cents from the start of the campaign through the end of `throughDay` (UTC). */
export function cumulativeEarnedCents(c: CampaignMoney, stats: readonly DailyStat[], throughDay: string): number {
  if (!hasBeenApproved(c)) return 0;
  const rate = toCents(c.rate_eur);
  if (c.pricing_model === "flat") {
    const run = runDays(c);
    if (!run || throughDay < run.first) return 0;
    const elapsed = Math.min(daysInclusive(run.first, throughDay), run.total);
    return divRoundHalfEven(rate * elapsed, run.total);
  }
  const usage = uncappedUsageCents(c, sumThrough(stats, throughDay, "views"), sumThrough(stats, throughDay, "clicks"));
  const cap = c.budget_cap_eur == null || c.budget_cap_eur === "" ? null : toCents(c.budget_cap_eur);
  return cap != null && cap > 0 ? Math.min(usage, cap) : usage;
}

/** Earned in cents between two UTC days, inclusive. */
export function earnedBetweenCents(c: CampaignMoney, stats: readonly DailyStat[], fromDay: string, toDay: string): number {
  if (toDay < fromDay) return 0;
  return cumulativeEarnedCents(c, stats, toDay) - cumulativeEarnedCents(c, stats, addDays(fromDay, -1));
}

/** The whole contract as it stands: flat → the rate; cpm/cpc → the cap, or what's earned if uncapped. */
export function bookedCents(c: CampaignMoney, stats: readonly DailyStat[], asOf: Date): number {
  if (!hasBeenApproved(c)) return 0;
  if (c.pricing_model === "flat") return toCents(c.rate_eur);
  const cap = c.budget_cap_eur == null || c.budget_cap_eur === "" ? 0 : toCents(c.budget_cap_eur);
  return cap > 0 ? cap : cumulativeEarnedCents(c, stats, utcDay(asOf));
}

export type CampaignSummary = {
  views: number;
  clicks: number;
  dismisses: number;
  anonViews: number;
  /** clicks ÷ views, 0–1, or null with no views. */
  ctr: number | null;
  earnedEur: number;
  bookedEur: number;
  paidEur: number;
  outstandingEur: number;
  /** earned ÷ views × 1000, or null with no views. */
  effectiveCpmEur: number | null;
  capReached: boolean;
};

export function summarizeCampaign(c: CampaignMoney, stats: readonly DailyStat[], asOf: Date = new Date()): CampaignSummary {
  const today = utcDay(asOf);
  let views = 0;
  let clicks = 0;
  let dismisses = 0;
  let anonViews = 0;
  for (const s of stats) {
    if (s.day > today) continue;
    views += Number(s.views) || 0;
    clicks += Number(s.clicks) || 0;
    dismisses += Number(s.dismisses) || 0;
    anonViews += Number(s.anon_views) || 0;
  }
  const earned = cumulativeEarnedCents(c, stats, today);
  const booked = bookedCents(c, stats, asOf);
  const paid = c.payment_status === "paid" ? booked : 0;
  const outstanding = c.payment_status === "waived" ? 0 : Math.max(0, earned - paid);
  return {
    views,
    clicks,
    dismisses,
    anonViews,
    ctr: views > 0 ? clicks / views : null,
    earnedEur: centsToEur(earned),
    bookedEur: centsToEur(booked),
    paidEur: centsToEur(paid),
    outstandingEur: centsToEur(outstanding),
    effectiveCpmEur: views > 0 ? centsToEur(divRoundHalfEven(earned * 1000, views)) : null,
    capReached: isCapReached(c, stats),
  };
}

export type ReportDay = {
  day: string;
  views: number;
  clicks: number;
  dismisses: number;
  anonViews: number;
  earnedEur: number;
};

/**
 * One row per UTC day from the campaign's start day to min(its last day,
 * today) — zero-traffic days included, so the advertiser's report has no
 * gaps. Days with stats outside that window (shouldn't happen) are added too.
 */
export function dailyReport(c: CampaignMoney, stats: readonly DailyStat[], asOf: Date = new Date()): ReportDay[] {
  const today = utcDay(asOf);
  const first = utcDay(c.starts_at);
  const endDay = c.ends_at ? utcDay(new Date(new Date(c.ends_at).getTime() - 1)) : today;
  const last = endDay < today ? endDay : today;
  const byDay = new Map(stats.map((s) => [s.day, s]));
  const days = new Set<string>();
  for (let d = first; d <= last; d = addDays(d, 1)) days.add(d);
  for (const s of stats) if (s.day <= today) days.add(s.day);
  return [...days].sort().map((day) => {
    const s = byDay.get(day);
    return {
      day,
      views: Number(s?.views) || 0,
      clicks: Number(s?.clicks) || 0,
      dismisses: Number(s?.dismisses) || 0,
      anonViews: Number(s?.anon_views) || 0,
      earnedEur: centsToEur(earnedBetweenCents(c, stats, day, day)),
    };
  });
}

export type MonthTotals = {
  month: string; // YYYY-MM
  earnedEur: number;
  views: number;
  clicks: number;
  ctr: number | null;
  outstandingEur: number;
};

/** The overview cards: this month's earned across campaigns, month-to-date. */
export function monthTotals(
  campaigns: readonly { campaign: CampaignMoney; stats: readonly DailyStat[] }[],
  asOf: Date = new Date()
): MonthTotals {
  const { first, last } = monthBounds(asOf);
  const today = utcDay(asOf);
  const to = last < today ? last : today;
  let earned = 0;
  let outstanding = 0;
  let views = 0;
  let clicks = 0;
  for (const { campaign, stats } of campaigns) {
    earned += earnedBetweenCents(campaign, stats, first, to);
    outstanding += Math.round(summarizeCampaign(campaign, stats, asOf).outstandingEur * 100);
    for (const s of stats) {
      if (s.day >= first && s.day <= to) {
        views += Number(s.views) || 0;
        clicks += Number(s.clicks) || 0;
      }
    }
  }
  return {
    month: first.slice(0, 7),
    earnedEur: centsToEur(earned),
    views,
    clicks,
    ctr: views > 0 ? clicks / views : null,
    outstandingEur: centsToEur(outstanding),
  };
}

/** 0.0123 → "1.2%", null → "—". */
export function formatRate(ctr: number | null): string {
  return ctr == null ? "—" : `${(ctr * 100).toFixed(1)}%`;
}
