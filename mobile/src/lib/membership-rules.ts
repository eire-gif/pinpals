/**
 * Memberships: Basic / Premium / Pro (claude/memberships.md, needs 0156).
 *
 * Pure — the plan copy, prices, the button wording and the access answer —
 * so it's tested without a phone. The database decides who may use what
 * (my_feature_access()); this only reads its answer and FAILS OPEN: no
 * answer, an error, or the `memberships` flag off means "allowed". A
 * paywall that breaks must never lock a member out of their round.
 */

export type Tier = "basic" | "premium" | "pro";
export type Billing = "monthly" | "annual";

export type Membership = {
  tier: Tier;
  paidPlansEnabled: boolean;
  freeUntil: string | null;
  billing: Billing | null;
  source: "app_store" | "play_store" | "staff_grant" | null;
  expiresAt: string | null;
  inTrial: boolean;
  willRenew: boolean;
  prices: { premium: { monthly: string; annual: string }; pro: { monthly: string; annual: string } };
  trialDays: { premium: number; pro: number };
};

export type FeatureAccess = { allowed: boolean; whenLocked: "upsell" | "hide"; access: "off" | "free" | "premium" | "pro" };

export const DEFAULT_MEMBERSHIP: Membership = {
  tier: "basic",
  paidPlansEnabled: false,
  freeUntil: null,
  billing: null,
  source: null,
  expiresAt: null,
  inTrial: false,
  willRenew: false,
  prices: { premium: { monthly: "€4.99", annual: "€34.99" }, pro: { monthly: "€9.99", annual: "€69.99" } },
  trialDays: { premium: 7, pro: 7 },
};

/** One row of my_membership() → Membership. Unknown values fall back to Basic. */
export function parseMembership(row: Record<string, unknown> | null | undefined): Membership {
  if (!row) return DEFAULT_MEMBERSHIP;
  const s = (k: string, d: string) => (typeof row[k] === "string" && row[k] ? (row[k] as string) : d);
  const tier = row.tier === "premium" || row.tier === "pro" ? row.tier : "basic";
  const billing = row.billing === "monthly" || row.billing === "annual" ? row.billing : null;
  const source = row.source === "app_store" || row.source === "play_store" || row.source === "staff_grant" ? row.source : null;
  const d = DEFAULT_MEMBERSHIP;
  return {
    tier,
    paidPlansEnabled: row.paid_plans_enabled === true,
    freeUntil: typeof row.free_until === "string" ? row.free_until : null,
    billing,
    source,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    inTrial: row.in_trial === true,
    willRenew: row.will_renew === true,
    prices: {
      premium: { monthly: s("premium_monthly_price", d.prices.premium.monthly), annual: s("premium_annual_price", d.prices.premium.annual) },
      pro: { monthly: s("pro_monthly_price", d.prices.pro.monthly), annual: s("pro_annual_price", d.prices.pro.annual) },
    },
    trialDays: {
      premium: Number(row.premium_trial_days ?? d.trialDays.premium) || 0,
      pro: Number(row.pro_trial_days ?? d.trialDays.pro) || 0,
    },
  };
}

/** Rows of my_feature_access() → a map by feature key. Bad rows are skipped. */
export function parseFeatureAccess(rows: unknown): Record<string, FeatureAccess> {
  const out: Record<string, FeatureAccess> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r?.key !== "string" || typeof r.allowed !== "boolean") continue;
    const access = r.access === "off" || r.access === "premium" || r.access === "pro" ? r.access : "free";
    out[r.key] = { allowed: r.allowed, whenLocked: r.when_locked === "hide" ? "hide" : "upsell", access };
  }
  return out;
}

/**
 * What a screen does with a feature: "show" it, show it "locked" with an
 * upgrade prompt, or "hide" it. Unknown features and missing answers show.
 */
export function gateFor(map: Record<string, FeatureAccess> | null, key: string): "show" | "locked" | "hide" {
  const f = map?.[key];
  if (!f || f.allowed) return "show";
  if (f.access === "off") return "hide";
  return f.whenLocked === "hide" ? "hide" : "locked";
}

// ---------------------------------------------------------------------------
// The plans screen
// ---------------------------------------------------------------------------

export const PLAN_COPY: Record<Tier, { name: string; blurb: string; tag: string; features: string[] }> = {
  basic: {
    name: "Basic",
    blurb: "Scoring, societies, tee times, selling",
    tag: "Free",
    features: ["Live scoring in every format", "Join societies, golf buddies and trips", "Offer and book tee times", "Buy and sell golf gear"],
  },
  premium: {
    name: "Premium",
    blurb: "GPS, voice scoring, stats, no ads",
    tag: "Popular",
    features: [
      "GPS yardages & satellite hole maps",
      "Voice score entry + distance on the lock screen",
      "Stats: fairways, greens, putts, trends",
      "Unlimited round history",
      "No ads · featured marketplace listings",
    ],
  },
  pro: {
    name: "Pro",
    blurb: "Everything + society organiser tools",
    tag: "Organisers",
    features: [
      "Everything in Premium",
      "Competitions with countbacks & league tables",
      "Live TV leaderboard for the clubhouse",
      "Trip itineraries with PDF export",
      "Society fees, branding & member tools",
    ],
  },
};

/** "€34.99" → 34.99; null when it isn't a price. */
export function priceValue(label: string): number | null {
  const m = /^€\s?(\d{1,4}(?:\.\d{1,2})?)$/.exec(label.trim());
  return m ? Number(m[1]) : null;
}

/** Whole-percent saving of paying yearly over 12 monthly payments (0 when it can't be worked out). */
export function annualSaving(monthly: string, annual: string): number {
  const m = priceValue(monthly);
  const a = priceValue(annual);
  if (m == null || a == null || m <= 0) return 0;
  return Math.max(0, Math.floor((1 - a / (m * 12)) * 100));
}

/** "€34.99" a year → "€2.92/mo". */
export function perMonth(annual: string): string | null {
  const a = priceValue(annual);
  return a == null ? null : `€${(Math.floor((a / 12) * 100) / 100).toFixed(2)}/mo`;
}

/** The big button and the line under it, for the plan the member has picked. */
export function checkoutWording(
  pick: Tier,
  billing: Billing,
  m: Pick<Membership, "tier" | "prices" | "trialDays">
): { button: string; fine: string } {
  if (pick === "basic") return { button: m.tier === "basic" ? "Continue with Basic" : "Stay on your plan", fine: "Basic is free for ever. Upgrade any time from Settings." };
  if (pick === m.tier) return { button: "This is your plan", fine: "Manage or cancel it in your App Store or Google Play settings." };
  const price = m.prices[pick][billing];
  const trial = billing === "annual" ? m.trialDays[pick] : 0;
  const store = "your App Store or Google Play settings";
  if (trial > 0) {
    return {
      button: `Start ${trial}-day free trial`,
      fine: `Free for ${trial} days, then ${price} a year. Renews automatically — cancel any time in ${store}.`,
    };
  }
  return {
    button: `Subscribe for ${price} a ${billing === "annual" ? "year" : "month"}`,
    fine: `Renews ${billing === "annual" ? "yearly" : "monthly"} — cancel any time in ${store}.`,
  };
}

/** "Free trial ends 23 Oct 2026" / "Renews 16 Oct 2027" / "Ends 16 Oct 2027" / null. */
export function renewalLine(m: Pick<Membership, "expiresAt" | "inTrial" | "willRenew" | "source">): string | null {
  if (m.source === "staff_grant" && !m.expiresAt) return "Given by PinPals — no end date";
  if (!m.expiresAt) return null;
  const d = new Date(m.expiresAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
  if (m.inTrial) return `Free trial ends ${d}`;
  return m.willRenew ? `Renews ${d}` : `Ends ${d}`;
}
