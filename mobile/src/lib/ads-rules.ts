/**
 * In-app advertising (0139): the pure rules — which advert goes where, when
 * a takeover may show, and the "Why am I seeing this?" wording. No React, no
 * Supabase, so the mobile vitest project can test it (ads-rules.test.ts).
 * The server applies targeting, the new-member quiet period and the takeover
 * frequency cap in ads_for_me(); these repeat the parts the phone can see
 * for itself, so a stale list never over-shows.
 */

export type AdFormat = "takeover" | "banner" | "feed" | "course_partner";
export type TakeoverTrigger = "app_open" | "after_round";

export type Ad = {
  id: number;
  format: AdFormat;
  displayStyle: "artwork" | "photo_headline";
  countdownSeconds: 3 | 5;
  takeoverPlacement: "app_open" | "after_round" | "both";
  imageUrl: string;
  imageWideUrl: string | null;
  imageSquareUrl: string | null;
  headline: string | null;
  body: string | null;
  buttonText: string | null;
  linkUrl: string;
  advertiserName: string;
  advertiserLogoUrl: string | null;
  weight: number;
  countries: string[];
  regions: string[];
  takeoverGapHours: number;
};

/** The row ads_for_me() returns. */
export type AdRow = {
  id: number | string;
  format: string;
  display_style: string;
  countdown_seconds: number | null;
  takeover_placement: string | null;
  image_url: string | null;
  image_wide_url: string | null;
  image_square_url: string | null;
  headline: string | null;
  body: string | null;
  button_text: string | null;
  link_url: string | null;
  advertiser_name: string | null;
  advertiser_logo_url: string | null;
  weight: number | null;
  countries: string[] | null;
  regions: string[] | null;
  takeover_gap_hours: number | null;
};

const FORMATS: readonly string[] = ["takeover", "banner", "feed", "course_partner"];
const isHttps = (u: string | null | undefined): u is string => typeof u === "string" && /^https:\/\/\S+$/.test(u);

/** A row → an advert the app can draw, or null if anything it needs is missing or unsafe. */
export function rowToAd(r: AdRow): Ad | null {
  const id = Number(r.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!FORMATS.includes(r.format)) return null;
  if (!isHttps(r.image_url) || !isHttps(r.link_url)) return null;
  return {
    id,
    format: r.format as AdFormat,
    displayStyle: r.display_style === "photo_headline" ? "photo_headline" : "artwork",
    countdownSeconds: r.countdown_seconds === 3 ? 3 : 5,
    takeoverPlacement: r.takeover_placement === "after_round" || r.takeover_placement === "both" ? r.takeover_placement : "app_open",
    imageUrl: r.image_url,
    imageWideUrl: isHttps(r.image_wide_url) ? r.image_wide_url : null,
    imageSquareUrl: isHttps(r.image_square_url) ? r.image_square_url : null,
    headline: r.headline?.trim() || null,
    body: r.body?.trim() || null,
    buttonText: r.button_text?.trim() || null,
    linkUrl: r.link_url,
    advertiserName: r.advertiser_name?.trim() || "Sponsor",
    advertiserLogoUrl: isHttps(r.advertiser_logo_url) ? r.advertiser_logo_url : null,
    weight: Math.max(1, Number(r.weight) || 1),
    countries: r.countries ?? [],
    regions: r.regions ?? [],
    takeoverGapHours: Math.max(0, Number(r.takeover_gap_hours ?? 4)),
  };
}

/** Adverts of one format the member hasn't hidden. */
export function adsOf(ads: readonly Ad[], format: AdFormat, hidden: ReadonlySet<number> = new Set()): Ad[] {
  return ads.filter((a) => a.format === format && !hidden.has(a.id));
}

/**
 * One advert, chosen in proportion to its weight. `random` is in [0, 1)
 * (Math.random() in the app; fixed in tests).
 */
export function pickWeighted<T extends { weight: number }>(items: readonly T[], random: number): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + Math.max(1, i.weight), 0);
  let target = Math.min(Math.max(random, 0), 0.999999) * total;
  for (const item of items) {
    target -= Math.max(1, item.weight);
    if (target < 0) return item;
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

/** After the 4th post, then every 12th. */
export const FEED_AD_FIRST = 4;
export const FEED_AD_EVERY = 12;

/** Which sponsored slot (0, 1, 2…) follows the item at `index`, or null for none. Never after the last item. */
export function feedAdSlot(index: number, total: number): number | null {
  if (index >= total - 1) return null;
  const n = index + 1 - FEED_AD_FIRST;
  if (n < 0 || n % FEED_AD_EVERY !== 0) return null;
  return n / FEED_AD_EVERY;
}

/** The advert for a slot: rotates through the list so consecutive slots differ. */
export function feedAdFor(ads: readonly Ad[], slot: number): Ad | null {
  return ads.length ? ads[slot % ads.length] : null;
}

// ---------------------------------------------------------------------------
// Takeover
// ---------------------------------------------------------------------------

/**
 * Screens a takeover never covers: signing in, onboarding (which also means
 * a brand-new member), live scoring, the hole map (GPS), checkout and the
 * web view (which carries Stripe Checkout), and scorecard entry. Matched on
 * expo-router segments.
 */
const BLOCKED_FIRST = new Set(["login", "signup", "auth-confirm", "onboarding", "hole-map", "checkout", "web", "card-link", "join", "tee-link"]);

export function takeoverBlockedAt(segments: readonly string[]): boolean {
  const [first, second] = segments;
  if (!first) return true; // still starting up
  if (BLOCKED_FIRST.has(first)) return true;
  if (first === "(tabs)" && second === "live") return true;
  if (first === "scorecards" && (second === "new" || second === "certify")) return true;
  return false;
}

export function takeoverFits(ad: Ad, trigger: TakeoverTrigger): boolean {
  return ad.format === "takeover" && (ad.takeoverPlacement === "both" || ad.takeoverPlacement === trigger);
}

/** Whether enough time has passed since the last takeover this phone showed. */
export function takeoverDue(lastShownAt: number | null, gapHours: number, now: number): boolean {
  if (lastShownAt == null) return true;
  return now - lastShownAt >= gapHours * 3_600_000;
}

/** Coming back to the app counts as "opening" it only after this long away (not after following an advert's link). */
export const REOPEN_AFTER_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "Why am I seeing this?" — from what the advert targets and where the member says they are. */
export function whyText(ad: Pick<Ad, "countries" | "regions">, me: { countryName: string | null; county: string | null }): string {
  const place =
    ad.regions.length > 0 && me.county
      ? me.county
      : ad.countries.length > 0 && me.countryName
        ? me.countryName
        : null;
  const first = place ? `Shown to golfers in ${place}.` : "Shown to all PinPals golfers.";
  return `${first} PinPals doesn't track you across other apps.`;
}
