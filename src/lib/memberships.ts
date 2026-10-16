// Memberships: Basic / Premium / Pro (0156, claude/memberships.md).
//
// Pure — no Supabase, no Next.js — so the rules are unit-tested and can be
// shared by the admin page and its Server Actions. featureAllowed() is the
// same rule as my_feature_access() in 0156_memberships.sql: change both
// together.

export const ACCESS_LEVELS = ["off", "free", "premium", "pro"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const TIERS = ["basic", "premium", "pro"] as const;
export type Tier = (typeof TIERS)[number];

export const WHEN_LOCKED = ["upsell", "hide"] as const;
export type WhenLocked = (typeof WHEN_LOCKED)[number];

export const FEATURE_GROUPS = ["scoring", "social", "societies"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export const ACCESS_LABELS: Record<AccessLevel, string> = {
  off: "Off",
  free: "Free",
  premium: "Premium",
  pro: "Pro",
};

export const TIER_LABELS: Record<Tier, string> = { basic: "Basic", premium: "Premium", pro: "Pro" };

export const GROUP_INFO: Record<FeatureGroup, { title: string; note: string }> = {
  scoring: { title: "Scoring & course", note: "What golfers use on the course" },
  social: { title: "Social & marketplace", note: "Extras for keen members" },
  societies: { title: "Societies & organisers", note: "Tools for captains and secretaries" },
};

export const WHEN_LOCKED_LABELS: Record<WhenLocked, string> = {
  upsell: "Show with upgrade",
  hide: "Hide",
};

/** Only a super admin may change what members pay for. */
export const MEMBERSHIP_EDIT_ROLES = ["super_admin"] as const;

export type MembershipSettings = {
  paid_plans_enabled: boolean;
  paid_plans_since: string | null;
  free_until: string | null; // yyyy-mm-dd, Irish date
  premium_monthly_price: string;
  premium_annual_price: string;
  pro_monthly_price: string;
  pro_annual_price: string;
  premium_trial_days: number;
  pro_trial_days: number;
  updated_at: string | null;
};

export const DEFAULT_MEMBERSHIP_SETTINGS: MembershipSettings = {
  paid_plans_enabled: false,
  paid_plans_since: null,
  free_until: null,
  premium_monthly_price: "€4.99",
  premium_annual_price: "€34.99",
  pro_monthly_price: "€9.99",
  pro_annual_price: "€69.99",
  premium_trial_days: 7,
  pro_trial_days: 7,
  updated_at: null,
};

export type MembershipFeature = {
  key: string;
  group_key: FeatureGroup;
  name: string;
  description: string;
  sort: number;
  access: AccessLevel;
  when_locked: WhenLocked;
  keep_for_existing: boolean;
  paywalled_at: string | null;
};

/** Today's date in Ireland, yyyy-mm-dd — the launch offer runs to the end of its day there. */
export function irishToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whether the launch offer is making everything free right now. */
export function launchOfferActive(settings: Pick<MembershipSettings, "free_until">, now: Date = new Date()): boolean {
  return !!settings.free_until && irishToday(now) <= settings.free_until;
}

/**
 * Can this member use this feature? Mirrors my_feature_access() (0156).
 *   off → nobody · free → everyone · paid plans off, or the launch offer
 *   running → free · keep_for_existing and joined before it went paid →
 *   allowed · premium → Premium or Pro · pro → Pro.
 */
export function featureAllowed(
  feature: Pick<MembershipFeature, "access" | "keep_for_existing" | "paywalled_at">,
  settings: Pick<MembershipSettings, "paid_plans_enabled" | "paid_plans_since" | "free_until">,
  member: { tier: Tier; joinedAt: string | null },
  now: Date = new Date()
): boolean {
  if (feature.access === "off") return false;
  if (feature.access === "free") return true;
  if (!settings.paid_plans_enabled) return true;
  if (launchOfferActive(settings, now)) return true;
  if (feature.keep_for_existing && member.joinedAt) {
    const cutoff = Math.max(
      feature.paywalled_at ? Date.parse(feature.paywalled_at) : -Infinity,
      settings.paid_plans_since ? Date.parse(settings.paid_plans_since) : -Infinity
    );
    if (Date.parse(member.joinedAt) < cutoff) return true;
  }
  if (feature.access === "premium") return member.tier === "premium" || member.tier === "pro";
  return member.tier === "pro";
}

/** What Basic members get today, in one line for the admin page. */
export function membershipStatusLine(settings: MembershipSettings, now: Date = new Date()): string {
  if (!settings.paid_plans_enabled) return "Off — every feature is free for everyone.";
  if (launchOfferActive(settings, now)) return `Live, but everything is free until ${formatIrishDate(settings.free_until!)} (launch offer).`;
  return "Live — members can subscribe, and locked features need Premium or Pro.";
}

export function formatIrishDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Form parsing (Server Actions)
// ---------------------------------------------------------------------------

type FormLike = { get(name: string): unknown };

const str = (f: FormLike, k: string) => String(f.get(k) ?? "").trim();

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** One feature's row: its level, what Basic members see, and keep-for-existing. */
export function parseFeatureForm(
  f: FormLike
): ParseResult<{ key: string; access: AccessLevel; when_locked: WhenLocked; keep_for_existing: boolean }> {
  const key = str(f, "key");
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) return { ok: false, error: "Unknown feature." };
  const access = str(f, "access") as AccessLevel;
  if (!ACCESS_LEVELS.includes(access)) return { ok: false, error: "Choose Off, Free, Premium or Pro." };
  const whenLocked = (str(f, "when_locked") || "upsell") as WhenLocked;
  if (!WHEN_LOCKED.includes(whenLocked)) return { ok: false, error: "Choose what Basic members see." };
  const keep = f.get("keep_for_existing");
  return { ok: true, value: { key, access, when_locked: whenLocked, keep_for_existing: keep === "on" || keep === "true" } };
}

const PRICE_RE = /^€\d{1,3}(\.\d{2})?$/;

/** "4.99", "€4.99" or "€ 4.99" → "€4.99"; null if it isn't a price. */
export function normalisePrice(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").replace(/^EUR/i, "€");
  const withSign = cleaned.startsWith("€") ? cleaned : `€${cleaned}`;
  return PRICE_RE.test(withSign) ? withSign : null;
}

const TRIALS = [0, 7, 14] as const;

export type MembershipSettingsPatch = Pick<
  MembershipSettings,
  | "free_until"
  | "premium_monthly_price"
  | "premium_annual_price"
  | "pro_monthly_price"
  | "pro_annual_price"
  | "premium_trial_days"
  | "pro_trial_days"
>;

/** Prices, trial lengths and the launch-offer date. */
export function parseSettingsForm(f: FormLike): ParseResult<MembershipSettingsPatch> {
  const prices = {} as Record<"premium_monthly_price" | "premium_annual_price" | "pro_monthly_price" | "pro_annual_price", string>;
  const labels = {
    premium_monthly_price: "Premium monthly",
    premium_annual_price: "Premium annual",
    pro_monthly_price: "Pro monthly",
    pro_annual_price: "Pro annual",
  } as const;
  for (const k of Object.keys(labels) as (keyof typeof labels)[]) {
    const p = normalisePrice(str(f, k));
    if (!p) return { ok: false, error: `${labels[k]} price: write it like €4.99.` };
    prices[k] = p;
  }
  const trial = (k: string): number | null => {
    const n = Number(str(f, k));
    return (TRIALS as readonly number[]).includes(n) ? n : null;
  };
  const premiumTrial = trial("premium_trial_days");
  const proTrial = trial("pro_trial_days");
  if (premiumTrial == null || proTrial == null) return { ok: false, error: "Free trial: none, 7 or 14 days." };
  const freeUntilRaw = str(f, "free_until");
  if (freeUntilRaw && !/^\d{4}-\d{2}-\d{2}$/.test(freeUntilRaw)) return { ok: false, error: "Launch offer date isn't a date." };
  if (freeUntilRaw && Number.isNaN(Date.parse(`${freeUntilRaw}T00:00:00Z`))) return { ok: false, error: "Launch offer date isn't a date." };
  return {
    ok: true,
    value: {
      ...prices,
      premium_trial_days: premiumTrial,
      pro_trial_days: proTrial,
      free_until: freeUntilRaw || null,
    },
  };
}
