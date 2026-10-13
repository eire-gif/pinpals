/**
 * Advertising (0139): the vocabulary, the creative specs, a campaign's
 * display state and the admin form's validation. Pure — unit-tested in
 * advertising.test.ts — and mirrored by the checks in 0139_advertising.sql,
 * which stay the real boundary.
 */
import type { CampaignStatus, PaymentStatus, PricingModel } from "./advertising-revenue";

export const AD_CATEGORIES = ["golf_travel", "equipment", "hospitality", "other", "alcohol", "betting"] as const;
export type AdCategory = (typeof AD_CATEGORIES)[number];

export const AD_CATEGORY_LABELS: Record<AdCategory, string> = {
  golf_travel: "Golf travel",
  equipment: "Equipment",
  hospitality: "Hospitality",
  other: "Other",
  alcohol: "Alcohol",
  betting: "Betting",
};

/** Categories a named staff member must confirm as suitable before approval. */
export const SENSITIVE_CATEGORIES: readonly AdCategory[] = ["alcohol", "betting"];
export const isSensitiveCategory = (c: string): boolean => (SENSITIVE_CATEGORIES as readonly string[]).includes(c);

export const AD_FORMATS = ["takeover", "banner", "feed", "course_partner"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

export const AD_FORMAT_INFO: Record<AdFormat, { label: string; where: string }> = {
  takeover: { label: "Full-screen takeover", where: "Opening the app, or after a round is certified. Closes after a 3 or 5 second countdown." },
  banner: { label: "Slide-up banner", where: "Above the tab bar on Courses and Marketplace. Hides itself after 8 seconds." },
  feed: { label: "Sponsored post", where: "In Social, after the 4th post and then every 12th." },
  course_partner: { label: "Course partner", where: "Under the course page's title and on its hole maps (“Yardages brought to you by…”)." },
};

export const DISPLAY_STYLES = ["artwork", "photo_headline"] as const;
export type DisplayStyle = (typeof DISPLAY_STYLES)[number];

export const TAKEOVER_PLACEMENTS = ["app_open", "after_round", "both"] as const;
export type TakeoverPlacement = (typeof TAKEOVER_PLACEMENTS)[number];

export const TAKEOVER_PLACEMENT_LABELS: Record<TakeoverPlacement, string> = {
  app_open: "Opening the app",
  after_round: "After a round is certified",
  both: "Both",
};

export const PRICING_LABELS: Record<PricingModel, string> = {
  flat: "Flat fee",
  cpm: "Per 1,000 views (CPM)",
  cpc: "Per click (CPC)",
};

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  invoiced: "Invoiced",
  paid: "Paid",
  waived: "Waived",
};

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  paused: "Paused",
  ended: "Ended",
  rejected: "Rejected",
};

// ---------------------------------------------------------------------------
// Creatives
// ---------------------------------------------------------------------------

/** The upload slots, by the shape they must be. */
export const CREATIVE_SLOTS = ["takeover", "banner", "feed", "logo"] as const;
export type CreativeSlot = (typeof CREATIVE_SLOTS)[number];

export const MAX_CREATIVE_BYTES = 2 * 1024 * 1024;

export const CREATIVE_SPECS: Record<CreativeSlot, { label: string; ratioW: number; ratioH: number; minWidth: number; recommended: string; hint: string }> = {
  takeover: { label: "Full-screen (9:16)", ratioW: 9, ratioH: 16, minWidth: 720, recommended: "1080 × 1920", hint: "Keep text clear of the top 12% (Sponsored label and countdown)." },
  banner: { label: "Banner (4:1)", ratioW: 4, ratioH: 1, minWidth: 800, recommended: "1200 × 300", hint: "Keep text out of the top 15% and right 15% — the close button and timer sit there." },
  feed: { label: "Square (1:1)", ratioW: 1, ratioH: 1, minWidth: 720, recommended: "1080 × 1080", hint: "Shown full width in Social." },
  logo: { label: "Logo (square)", ratioW: 1, ratioH: 1, minWidth: 200, recommended: "400 × 400", hint: "Shown small on a course page and its hole maps." },
};

/** Which slot a campaign's main image fills. */
export function mainSlotFor(format: AdFormat): CreativeSlot {
  return format === "course_partner" ? "logo" : format;
}

/**
 * Checks an image's pixel size against a slot: the right shape (within 1%)
 * and at least the minimum width. Returns an error to show, or null.
 */
export function checkCreativeDimensions(slot: CreativeSlot, width: number, height: number): string | null {
  const spec = CREATIVE_SPECS[slot];
  if (!(width > 0 && height > 0)) return "Couldn't read that image's size.";
  const want = spec.ratioW / spec.ratioH;
  const got = width / height;
  if (Math.abs(got - want) / want > 0.01) {
    return `That image is ${width} × ${height}. ${spec.label} needs a ${spec.ratioW}:${spec.ratioH} image — ${spec.recommended} is ideal.`;
  }
  if (width < spec.minWidth) {
    return `That image is only ${width} px wide. ${spec.label} needs at least ${spec.minWidth} px — ${spec.recommended} is ideal.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Display state (filter chips)
// ---------------------------------------------------------------------------

export type CampaignView = "live" | "scheduled" | "pending" | "paused" | "ended" | "draft" | "rejected";
export const CAMPAIGN_FILTERS = ["all", "live", "scheduled", "pending", "ended"] as const;
export type CampaignFilter = (typeof CAMPAIGN_FILTERS)[number];

export const CAMPAIGN_VIEW_LABELS: Record<CampaignView, string> = {
  live: "Live",
  scheduled: "Scheduled",
  pending: "Pending approval",
  paused: "Paused",
  ended: "Ended",
  draft: "Draft",
  rejected: "Rejected",
};

/** What a campaign is doing right now, from its status and dates. Ignores the master switch. */
export function campaignView(
  c: { status: CampaignStatus; starts_at: string; ends_at: string | null },
  now: Date = new Date(),
  capReached = false
): CampaignView {
  switch (c.status) {
    case "draft":
      return "draft";
    case "pending_approval":
      return "pending";
    case "rejected":
      return "rejected";
    case "paused":
      return "paused";
    case "ended":
      return "ended";
    case "approved": {
      const t = now.getTime();
      if (c.ends_at && new Date(c.ends_at).getTime() <= t) return "ended";
      if (capReached) return "ended";
      if (new Date(c.starts_at).getTime() > t) return "scheduled";
      return "live";
    }
  }
}

export function parseCampaignFilter(value: string | null | undefined): CampaignFilter {
  return (CAMPAIGN_FILTERS as readonly string[]).includes(value ?? "") ? (value as CampaignFilter) : "all";
}

export function matchesFilter(view: CampaignView, filter: CampaignFilter): boolean {
  if (filter === "all") return true;
  return view === filter;
}

// ---------------------------------------------------------------------------
// The campaign form
// ---------------------------------------------------------------------------

export type CampaignInput = {
  advertiser_id: number;
  name: string;
  category: AdCategory;
  format: AdFormat;
  display_style: DisplayStyle;
  countdown_seconds: 3 | 5;
  takeover_placement: TakeoverPlacement;
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
  starts_at: string;
  ends_at: string | null;
  weight: number;
  pricing_model: PricingModel;
  rate_eur: number;
  budget_cap_eur: number | null;
  payment_status: PaymentStatus;
};

type Source = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

const str = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null): string | null => str(v) || null;
const isHttps = (u: string) => /^https:\/\/[^\s]+$/.test(u) && u.length <= 1000;

/** "1,250.5" / "€1250.50" → 1250.5; anything else null. Two decimals at most. */
export function parseEuro(input: string): number | null {
  const raw = input.replace(/[€\s,]/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) return null;
  return Number(raw);
}

/** A list field: several `name` entries, or one comma-separated value. Trimmed, de-duplicated. */
export function readList(form: Source, name: string): string[] {
  const values = form.getAll(name).flatMap((v) => (typeof v === "string" ? v.split(",") : []));
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

/** ISO → "YYYY-MM-DDTHH:mm" in UTC, for a datetime-local input that is read as UTC. */
export function toInputUtc(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 16) : "";
}

/** "2026-10-14T09:00" typed as UTC → ISO, or null. */
export function parseUtcInput(value: string): string | null {
  if (!value) return null;
  const withZone = /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Parses and validates the campaign form. `forSubmit` adds the checks that
 * only matter once it goes for approval (a creative, a headline for the
 * photo style, courses for a course partner) — a draft may be half-done.
 */
export function parseCampaignForm(form: Source, opts: { forSubmit: boolean; now?: Date }): { value: CampaignInput } | { error: string } {
  const advertiserId = Number(str(form.get("advertiser_id")));
  if (!Number.isInteger(advertiserId) || advertiserId <= 0) return { error: "Choose the advertiser." };

  const name = str(form.get("name"));
  if (name.length < 2 || name.length > 120) return { error: "Give the campaign a name (2–120 characters)." };

  const category = str(form.get("category")) as AdCategory;
  if (!AD_CATEGORIES.includes(category)) return { error: "Choose a category." };

  const format = str(form.get("format")) as AdFormat;
  if (!AD_FORMATS.includes(format)) return { error: "Choose a format." };

  const display_style = (str(form.get("display_style")) || "artwork") as DisplayStyle;
  if (!DISPLAY_STYLES.includes(display_style)) return { error: "Choose how the advert is shown." };

  const countdown = Number(str(form.get("countdown_seconds")) || 5);
  if (countdown !== 3 && countdown !== 5) return { error: "The countdown is 3 or 5 seconds." };

  const takeover_placement = (str(form.get("takeover_placement")) || "app_open") as TakeoverPlacement;
  if (!TAKEOVER_PLACEMENTS.includes(takeover_placement)) return { error: "Choose where the takeover appears." };

  const image_url = opt(form.get("image_url"));
  const image_wide_url = opt(form.get("image_wide_url"));
  const image_square_url = opt(form.get("image_square_url"));
  for (const u of [image_url, image_wide_url, image_square_url]) {
    if (u && !isHttps(u)) return { error: "Images must be uploaded here (https:// links only)." };
  }

  // Text only applies to the photo + headline style; artwork carries its own.
  const photo = display_style === "photo_headline";
  const headline = photo ? opt(form.get("headline")) : null;
  const body = photo ? opt(form.get("body")) : null;
  const button_text = photo ? opt(form.get("button_text")) : null;
  if (headline && headline.length > 60) return { error: "Headline: 60 characters at most." };
  if (body && body.length > 160) return { error: "Body: 160 characters at most." };
  if (button_text && button_text.length > 24) return { error: "Button: 24 characters at most." };

  const link_url = str(form.get("link_url"));
  if (!isHttps(link_url)) return { error: "The link must be a full https:// address." };

  const countries = readList(form, "countries");
  if (countries.some((c) => !/^[a-z][a-z-]{1,29}$/.test(c))) return { error: "Unknown country." };
  if (countries.length > 20) return { error: "Too many countries." };
  const regions = readList(form, "regions");
  if (regions.length > 80 || regions.some((r) => r.length > 60)) return { error: "Too many counties." };
  const clubStrings = readList(form, "club_ids");
  const club_ids = clubStrings.map(Number);
  if (club_ids.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "Unknown course." };
  if (club_ids.length > 200) return { error: "Too many courses." };

  const starts_at = parseUtcInput(str(form.get("starts_at"))) ?? (opts.now ?? new Date()).toISOString();
  const endsRaw = str(form.get("ends_at"));
  const ends_at = parseUtcInput(endsRaw);
  if (endsRaw && !ends_at) return { error: "The end date isn't a date." };
  if (ends_at && Date.parse(ends_at) <= Date.parse(starts_at)) return { error: "The advert must end after it starts." };

  const weightRaw = str(form.get("weight")) || "1";
  const weight = Number(weightRaw);
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) return { error: "Weight is a whole number from 1 to 100." };

  const pricing_model = (str(form.get("pricing_model")) || "flat") as PricingModel;
  if (!["flat", "cpm", "cpc"].includes(pricing_model)) return { error: "Choose how they pay." };
  if (pricing_model === "flat" && !ends_at) return { error: "A flat-fee deal needs an end date — the fee is spread over the run." };
  const rate = parseEuro(str(form.get("rate_eur")) || "0");
  if (rate == null) return { error: "Rate: an amount in euro, e.g. 450 or 12.50." };
  const capRaw = str(form.get("budget_cap_eur"));
  const budget_cap_eur = capRaw ? parseEuro(capRaw) : null;
  if (capRaw && (budget_cap_eur == null || budget_cap_eur <= 0)) return { error: "Budget cap: an amount in euro above 0, or leave it blank." };

  const payment_status = (str(form.get("payment_status")) || "unpaid") as PaymentStatus;
  if (!["unpaid", "invoiced", "paid", "waived"].includes(payment_status)) return { error: "Choose a payment status." };

  if (opts.forSubmit) {
    if (!image_url) return { error: "Upload the advert's image before sending it for approval." };
    if (photo && !headline) return { error: "The photo + headline style needs a headline." };
    if (format === "course_partner" && club_ids.length === 0) return { error: "Choose the course(s) this partner sponsors." };
    if (pricing_model !== "flat" && rate <= 0) return { error: "Set the rate." };
  }

  return {
    value: {
      advertiser_id: advertiserId,
      name,
      category,
      format,
      display_style,
      countdown_seconds: countdown as 3 | 5,
      takeover_placement,
      image_url,
      image_wide_url,
      image_square_url,
      headline,
      body,
      button_text,
      link_url,
      countries,
      regions,
      club_ids,
      starts_at,
      ends_at,
      weight,
      pricing_model,
      rate_eur: rate,
      budget_cap_eur,
      payment_status,
    },
  };
}

/** Fields whose change sends an approved advert back for approval: what members see, and who sees it. */
export const CONTENT_FIELDS = [
  "category",
  "format",
  "display_style",
  "image_url",
  "image_wide_url",
  "image_square_url",
  "headline",
  "body",
  "button_text",
  "link_url",
] as const;

export type AdvertiserInput = {
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  notes: string | null;
};

export function parseAdvertiserForm(form: Source): { value: AdvertiserInput } | { error: string } {
  const name = str(form.get("name"));
  if (name.length < 2 || name.length > 120) return { error: "Give the advertiser a name (2–120 characters)." };
  const email = opt(form.get("email"));
  if (email && (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return { error: "That email doesn't look right." };
  const website = opt(form.get("website"));
  if (website && (website.length > 500 || !/^https?:\/\//.test(website))) return { error: "Website: a full address starting https://" };
  const logo_url = opt(form.get("logo_url"));
  if (logo_url && !isHttps(logo_url)) return { error: "Logo: upload it here (https:// only)." };
  const contact_name = opt(form.get("contact_name"));
  if (contact_name && contact_name.length > 120) return { error: "Contact name is too long." };
  const phone = opt(form.get("phone"));
  if (phone && phone.length > 40) return { error: "Phone is too long." };
  const notes = opt(form.get("notes"));
  if (notes && notes.length > 4000) return { error: "Notes are too long." };
  return { value: { name, contact_name, email, phone, website, logo_url, notes } };
}

/**
 * Which keys of `after` differ from `before` — for the audit log and the
 * "content changed, needs approval again" rule. Arrays compare by value,
 * timestamps by instant, numbers numerically (numeric columns arrive as
 * strings), null and undefined alike.
 */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => {
    const a = before[k];
    const b = after[k];
    if (Array.isArray(a) || Array.isArray(b)) {
      const norm = (v: unknown) => JSON.stringify(((v as unknown[]) ?? []).map(String));
      return norm(a) !== norm(b);
    }
    if (k.endsWith("_at") && a && b) return new Date(String(a)).getTime() !== new Date(String(b)).getTime();
    if (typeof b === "number" || (typeof a === "number" && b != null)) return Number(a) !== Number(b);
    return (a ?? null) !== (b ?? null);
  });
}
