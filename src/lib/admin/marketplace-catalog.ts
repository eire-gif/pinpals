// Pure form validation for /admin/marketplace's "Retail & ads" tab — the
// affiliate_products and marketplace_banners editors (0115). No Supabase,
// no Next.js; tested in marketplace-catalog.test.ts. The database has its
// own check constraints (url ~ '^https://', lengths); these mirror them so
// staff get a readable message instead of a constraint-violation string,
// and so a non-https link can never reach the insert at all.

type FormLike = { get(name: string): FormDataEntryValue | null };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function text(form: FormLike, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function optionalText(form: FormLike, name: string): string | null {
  const v = text(form, name);
  return v === "" ? null : v;
}

/** An absolute https:// URL with a host — what the DB's url/link_url checks require. */
export function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** "" → null; otherwise a non-negative euro amount with at most 2 decimals, or undefined if invalid. */
export function parseOptionalEur(raw: string): number | null | undefined {
  const v = raw.replace(/^€/, "").trim();
  if (v === "") return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(v)) return undefined;
  return Number(v);
}

/**
 * A datetime-local value ("2026-10-10T09:30") or ISO string → ISO, or
 * undefined if invalid. A value with no zone is read as UTC (the admin form
 * labels its date fields UTC), never as the server's local time.
 */
export function parseDateTimeInput(raw: string): string | undefined {
  if (!raw) return undefined;
  const zoneless = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw);
  const d = new Date(zoneless ? `${raw}Z` : raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function lengthBetween(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max;
}

export type AffiliateProductInput = {
  title: string;
  brand: string | null;
  category: string | null;
  price_eur: number | null;
  was_price_eur: number | null;
  image_url: string | null;
  retailer: string;
  url: string;
  sort_order: number;
  active: boolean;
};

export function parseAffiliateProductForm(form: FormLike): ParseResult<AffiliateProductInput> {
  const title = text(form, "title");
  if (!lengthBetween(title, 2, 120)) return { ok: false, error: "Title must be 2–120 characters." };

  const retailer = text(form, "retailer");
  if (!lengthBetween(retailer, 2, 80)) return { ok: false, error: "Retailer must be 2–80 characters." };

  const url = text(form, "url");
  if (!isHttpsUrl(url) || url.length > 1000) return { ok: false, error: "Product link must be a full https:// URL." };

  const imageUrl = optionalText(form, "image_url");
  if (imageUrl && (!isHttpsUrl(imageUrl) || imageUrl.length > 500)) {
    return { ok: false, error: "Image URL must be a full https:// URL (500 characters max)." };
  }

  const brand = optionalText(form, "brand");
  if (brand && brand.length > 60) return { ok: false, error: "Brand is 60 characters max." };
  const category = optionalText(form, "category");
  if (category && category.length > 60) return { ok: false, error: "Category is 60 characters max." };

  const price = parseOptionalEur(text(form, "price_eur"));
  if (price === undefined) return { ok: false, error: "Price must be a euro amount like 349 or 349.99." };
  const was = parseOptionalEur(text(form, "was_price_eur"));
  if (was === undefined) return { ok: false, error: "Was-price must be a euro amount like 399 or 399.99." };

  const sortRaw = text(form, "sort_order");
  const sortOrder = sortRaw === "" ? 0 : Number(sortRaw);
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100000) {
    return { ok: false, error: "Sort order must be a whole number." };
  }

  return {
    ok: true,
    value: {
      title,
      brand,
      category,
      price_eur: price,
      was_price_eur: was,
      image_url: imageUrl,
      retailer,
      url,
      sort_order: sortOrder,
      active: form.get("active") != null,
    },
  };
}

export const BANNER_PLACEMENTS = ["new_gear", "used_gear"] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];
export const BANNER_PLACEMENT_LABELS: Record<BannerPlacement, string> = {
  new_gear: "New Gear",
  used_gear: "Used Gear",
};

export type BannerInput = {
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string;
  sponsor: string;
  placement: BannerPlacement;
  starts_at: string;
  ends_at: string | null;
  fee_eur: number | null;
  active: boolean;
};

export function parseBannerForm(form: FormLike, now: Date = new Date()): ParseResult<BannerInput> {
  const title = text(form, "title");
  if (!lengthBetween(title, 2, 80)) return { ok: false, error: "Title must be 2–80 characters." };

  const sponsor = text(form, "sponsor");
  if (!lengthBetween(sponsor, 2, 80)) return { ok: false, error: "Sponsor must be 2–80 characters." };

  const eyebrow = optionalText(form, "eyebrow");
  if (eyebrow && eyebrow.length > 40) return { ok: false, error: "Eyebrow is 40 characters max." };
  const subtitle = optionalText(form, "subtitle");
  if (subtitle && subtitle.length > 140) return { ok: false, error: "Subtitle is 140 characters max." };

  const linkUrl = text(form, "link_url");
  if (!isHttpsUrl(linkUrl) || linkUrl.length > 1000) return { ok: false, error: "Banner link must be a full https:// URL." };

  const imageUrl = optionalText(form, "image_url");
  if (imageUrl && (!isHttpsUrl(imageUrl) || imageUrl.length > 500)) {
    return { ok: false, error: "Image URL must be a full https:// URL (500 characters max)." };
  }

  const placement = text(form, "placement") || "new_gear";
  if (!(BANNER_PLACEMENTS as readonly string[]).includes(placement)) return { ok: false, error: "Pick a placement." };

  const startsRaw = text(form, "starts_at");
  const startsAt = startsRaw === "" ? now.toISOString() : parseDateTimeInput(startsRaw);
  if (!startsAt) return { ok: false, error: "Start date isn't a valid date." };

  const endsRaw = text(form, "ends_at");
  const endsAt = endsRaw === "" ? null : parseDateTimeInput(endsRaw);
  if (endsAt === undefined) return { ok: false, error: "End date isn't a valid date." };
  if (endsAt && new Date(endsAt) <= new Date(startsAt)) return { ok: false, error: "End date must be after the start." };

  const fee = parseOptionalEur(text(form, "fee_eur"));
  if (fee === undefined) return { ok: false, error: "Sponsor fee must be a euro amount like 250 or 250.00." };

  return {
    ok: true,
    value: {
      eyebrow,
      title,
      subtitle,
      image_url: imageUrl,
      link_url: linkUrl,
      sponsor,
      placement: placement as BannerPlacement,
      starts_at: startsAt,
      ends_at: endsAt,
      fee_eur: fee,
      active: form.get("active") != null,
    },
  };
}

/** Which fields differ between a stored row and a validated edit — for the audit log's metadata. */
export function changedFields<T extends Record<string, unknown>>(before: Partial<T>, after: T): string[] {
  return Object.keys(after).filter((k) => {
    const a = before[k as keyof T];
    const b = after[k as keyof T];
    if (k.endsWith("_at") && a && b) return new Date(String(a)).getTime() !== new Date(String(b)).getTime();
    if (typeof b === "number" || (typeof a === "number" && b != null)) return Number(a) !== Number(b);
    return (a ?? null) !== (b ?? null);
  });
}
