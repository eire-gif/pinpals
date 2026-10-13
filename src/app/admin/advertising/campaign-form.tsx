/* eslint-disable @next/next/no-img-element -- thumbnails of just-uploaded creatives */
"use client";

import { startTransition, useActionState, useState } from "react";
import ClubCombobox from "@/components/club-combobox";
import { COUNTRIES, REGIONS_BY_COUNTRY, type CountryCode } from "@/lib/regions";
import {
  AD_CATEGORIES,
  AD_CATEGORY_LABELS,
  AD_FORMATS,
  AD_FORMAT_INFO,
  CREATIVE_SPECS,
  MAX_CREATIVE_BYTES,
  PAYMENT_LABELS,
  PRICING_LABELS,
  TAKEOVER_PLACEMENTS,
  TAKEOVER_PLACEMENT_LABELS,
  isSensitiveCategory,
  mainSlotFor,
  type AdCategory,
  type AdFormat,
  type CreativeSlot,
  type DisplayStyle,
  type TakeoverPlacement,
} from "@/lib/advertising";
import type { PaymentStatus, PricingModel } from "@/lib/advertising-revenue";
import PhonePreview from "./phone-preview";
import type { AdActionState } from "./actions";

// The campaign form (create and edit), with the live phone preview beside
// it. Client-side only for what the preview and the uploads need; every
// value is validated again by saveCampaign() (src/lib/advertising.ts) and by
// the table's own checks (0139).

export type CampaignFormValues = {
  id: number | null;
  status: string;
  advertiser_id: number | null;
  name: string;
  category: AdCategory;
  format: AdFormat;
  display_style: DisplayStyle;
  countdown_seconds: number;
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
  clubs: { id: number; name: string }[];
  starts_at: string | null;
  ends_at: string | null;
  weight: number;
  pricing_model: PricingModel;
  rate_eur: string;
  budget_cap_eur: string;
  payment_status: PaymentStatus;
};

type Advertiser = { id: number; name: string; logo_url: string | null };

const inputCls = "w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface disabled:bg-cream-50";
const labelCls = "text-xs uppercase tracking-wide text-ink-500 font-semibold";

export default function CampaignForm({
  action,
  initial,
  advertisers,
  canEdit,
}: {
  action: (state: AdActionState, formData: FormData) => Promise<AdActionState>;
  initial: CampaignFormValues;
  advertisers: Advertiser[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [v, setV] = useState(initial);
  const set = <K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const [advertiserChoice, setAdvertiserChoice] = useState<string>(initial.advertiser_id ? String(initial.advertiser_id) : advertisers.length ? "" : "new");
  const [newAdvertiser, setNewAdvertiser] = useState("");
  const [clubCountry, setClubCountry] = useState<string>(initial.countries[0] ?? "ireland");

  const isNew = initial.id == null;
  const canSubmitForApproval = isNew || initial.status === "draft" || initial.status === "rejected";
  const ended = initial.status === "ended";
  const photo = v.display_style === "photo_headline";
  const chosenAdvertiser = advertisers.find((a) => String(a.id) === advertiserChoice);
  const mainSlot = mainSlotFor(v.format);

  const toggle = (key: "countries" | "regions", value: string) =>
    set(key, v[key].includes(value) ? v[key].filter((x) => x !== value) : [...v[key], value]);

  const regionChoices = (v.countries.length ? v.countries : COUNTRIES.map((c) => c.code)).flatMap((code) =>
    (REGIONS_BY_COUNTRY[code as CountryCode] ?? []).map((r) => ({ code, region: r }))
  );

  return (
    <div className="grid xl:grid-cols-[1fr_300px] gap-8 items-start">
      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          const formData = new FormData(event.currentTarget, submitter);
          startTransition(() => formAction(formData));
        }}
      >
        {initial.id != null && <input type="hidden" name="campaignId" value={initial.id} />}
        <fieldset disabled={!canEdit} className="grid gap-6 min-w-0">
          {/* 1 — Who and what */}
          <Section n={1} title="Who and what">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className={labelCls}>Advertiser *</span>
                <select
                  name="advertiser_id"
                  value={advertiserChoice}
                  onChange={(e) => setAdvertiserChoice(e.target.value)}
                  required
                  disabled={ended}
                  className={inputCls}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {advertisers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                  <option value="new">+ Add a new advertiser</option>
                </select>
              </label>
              {advertiserChoice === "new" ? (
                <label className="grid gap-1">
                  <span className={labelCls}>New advertiser&rsquo;s name *</span>
                  <input name="new_advertiser_name" value={newAdvertiser} onChange={(e) => setNewAdvertiser(e.target.value)} required minLength={2} maxLength={120} className={inputCls} placeholder="e.g. Atlantic Golf Breaks" />
                </label>
              ) : (
                <div />
              )}
              <label className="grid gap-1">
                <span className={labelCls}>Campaign name *</span>
                <input name="name" value={v.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} disabled={ended} className={inputCls} placeholder="e.g. Algarve spring breaks" />
              </label>
              <label className="grid gap-1">
                <span className={labelCls}>Category *</span>
                <select name="category" value={v.category} onChange={(e) => set("category", e.target.value as AdCategory)} disabled={ended} className={inputCls}>
                  {AD_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {AD_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {isSensitiveCategory(v.category) && (
              <p className="text-xs bg-red-100 text-red-600 rounded-lg px-3 py-2 mt-3">
                {AD_CATEGORY_LABELS[v.category]} adverts need explicit approval: the approver must confirm it&rsquo;s suitable for PinPals members (all 18+).
              </p>
            )}
          </Section>

          {/* 2 — Format */}
          <Section n={2} title="Format">
            <div className="grid sm:grid-cols-2 gap-3">
              {AD_FORMATS.map((f) => (
                <label
                  key={f}
                  className={`cursor-pointer rounded-xl border-[1.5px] p-4 transition ${
                    v.format === f ? "border-navy-900 bg-surface-tint ring-2 ring-gold-400" : "border-line bg-surface hover:border-ink-500"
                  }`}
                >
                  <input type="radio" name="format" value={f} checked={v.format === f} onChange={() => set("format", f)} disabled={ended} className="sr-only" />
                  <div className="font-display font-bold text-ink-900">{AD_FORMAT_INFO[f].label}</div>
                  <div className="text-xs text-ink-500 mt-1">{AD_FORMAT_INFO[f].where}</div>
                </label>
              ))}
            </div>
            {v.format === "takeover" && (
              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                <div className="grid gap-1">
                  <span className={labelCls}>Countdown before the close button</span>
                  <div className="flex gap-2">
                    {[3, 5].map((s) => (
                      <label key={s} className={`cursor-pointer px-4 py-2 rounded-full text-sm font-bold border ${v.countdown_seconds === s ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line bg-surface"}`}>
                        <input type="radio" name="countdown_seconds" value={s} checked={v.countdown_seconds === s} onChange={() => set("countdown_seconds", s)} className="sr-only" />
                        {s} seconds
                      </label>
                    ))}
                  </div>
                </div>
                <label className="grid gap-1">
                  <span className={labelCls}>Where it can appear</span>
                  <select name="takeover_placement" value={v.takeover_placement} onChange={(e) => set("takeover_placement", e.target.value as TakeoverPlacement)} className={inputCls}>
                    {TAKEOVER_PLACEMENTS.map((p) => (
                      <option key={p} value={p}>
                        {TAKEOVER_PLACEMENT_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </Section>

          {/* 3 — The advert */}
          <Section n={3} title="The advert">
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              {(
                [
                  ["artwork", "Use their artwork as is", "Their finished image. PinPals adds only the Sponsored label, countdown and close."],
                  ["photo_headline", "Photo + PinPals headline", "A plain photo; PinPals lays out the headline, text and button."],
                ] as const
              ).map(([value, title, hint]) => (
                <label key={value} className={`cursor-pointer rounded-xl border-[1.5px] p-3 flex gap-3 ${v.display_style === value ? "border-navy-900 bg-surface-tint" : "border-line bg-surface"}`}>
                  <input type="radio" name="display_style" value={value} checked={v.display_style === value} onChange={() => set("display_style", value)} disabled={ended} className="mt-1" />
                  <span>
                    <span className="block font-semibold text-sm text-ink-900">{title}</span>
                    <span className="block text-xs text-ink-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Upload slot={mainSlot} name="image_url" label={`${v.format === "course_partner" ? "Logo" : "Image"} *`} value={v.image_url} onChange={(u) => set("image_url", u)} disabled={!canEdit || ended} />
              {v.format === "banner" && (
                <Upload slot="feed" name="image_square_url" label="Square photo (optional — for the photo + headline style)" value={v.image_square_url} onChange={(u) => set("image_square_url", u)} disabled={!canEdit || ended} />
              )}
              {v.format === "feed" && (
                <Upload slot="banner" name="image_wide_url" label="Wide 4:1 version (optional)" value={v.image_wide_url} onChange={(u) => set("image_wide_url", u)} disabled={!canEdit || ended} />
              )}
              {v.format === "course_partner" && (
                <Upload slot="banner" name="image_wide_url" label="Wide 4:1 strip artwork (optional)" value={v.image_wide_url} onChange={(u) => set("image_wide_url", u)} disabled={!canEdit || ended} />
              )}
            </div>
            {/* Keep the other slots' values when the format changes, so nothing uploaded is lost. */}
            {v.format !== "banner" && v.image_square_url && <input type="hidden" name="image_square_url" value={v.image_square_url} />}
            {v.format !== "feed" && v.format !== "course_partner" && v.image_wide_url && <input type="hidden" name="image_wide_url" value={v.image_wide_url} />}

            {photo && (
              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                <label className="grid gap-1 sm:col-span-2">
                  <span className={labelCls}>Headline * <Count n={v.headline?.length ?? 0} max={60} /></span>
                  <input name="headline" value={v.headline ?? ""} onChange={(e) => set("headline", e.target.value)} maxLength={60} disabled={ended} className={inputCls} placeholder="e.g. Three nights in the Algarve from €399" />
                </label>
                <label className="grid gap-1 sm:col-span-2">
                  <span className={labelCls}>Text <Count n={v.body?.length ?? 0} max={160} /></span>
                  <textarea name="body" value={v.body ?? ""} onChange={(e) => set("body", e.target.value)} maxLength={160} rows={2} disabled={ended} className={inputCls} />
                </label>
                <label className="grid gap-1">
                  <span className={labelCls}>Button <Count n={v.button_text?.length ?? 0} max={24} /></span>
                  <input name="button_text" value={v.button_text ?? ""} onChange={(e) => set("button_text", e.target.value)} maxLength={24} disabled={ended} className={inputCls} placeholder="Book now" />
                </label>
              </div>
            )}

            <label className="grid gap-1 mt-4">
              <span className={labelCls}>Link (https://) *</span>
              <input name="link_url" type="url" value={v.link_url} onChange={(e) => set("link_url", e.target.value)} required pattern="https://.*" disabled={ended} className={inputCls} placeholder="https://" />
              <span className="text-xs text-ink-500">Opens in the app&rsquo;s browser. Add their tracking tags here if they want them.</span>
            </label>
          </Section>

          {/* 4 — Audience and timing */}
          <Section n={4} title="Audience and timing">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <span className={labelCls}>Countries · none ticked = everywhere</span>
                <div className="flex flex-wrap gap-2">
                  {COUNTRIES.map((c) => (
                    <Chip key={c.code} on={v.countries.includes(c.code)} onClick={() => toggle("countries", c.code)} disabled={!canEdit || ended}>
                      {c.name}
                    </Chip>
                  ))}
                </div>
                {v.countries.map((c) => (
                  <input key={c} type="hidden" name="countries" value={c} />
                ))}
              </div>
              <div className="grid gap-1.5">
                <span className={labelCls}>Counties · none ticked = all {v.countries.length ? "in those countries" : ""}</span>
                <details className="bg-surface-tint rounded-lg border border-line px-3 py-2">
                  <summary className="text-sm cursor-pointer">{v.regions.length ? v.regions.join(", ") : "All counties"}</summary>
                  <div className="flex flex-wrap gap-1.5 mt-2 max-h-56 overflow-y-auto">
                    {regionChoices.map(({ code, region }) => (
                      <Chip key={`${code}-${region}`} small on={v.regions.includes(region)} onClick={() => toggle("regions", region)} disabled={!canEdit || ended}>
                        {region}
                      </Chip>
                    ))}
                  </div>
                </details>
                {v.regions.map((r) => (
                  <input key={r} type="hidden" name="regions" value={r} />
                ))}
              </div>
              <div className="grid gap-1.5">
                <span className={labelCls}>
                  Courses {v.format === "course_partner" ? "it sponsors *" : "· members whose home club is one of these (optional)"}
                </span>
                {v.clubs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {v.clubs.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-navy-900 text-cream-50 rounded-full pl-3 pr-1.5 py-1">
                        {c.name}
                        {canEdit && !ended && (
                          <button type="button" onClick={() => set("clubs", v.clubs.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.name}`} className="w-5 h-5 rounded-full hover:bg-navy-800">
                            ×
                          </button>
                        )}
                        <input type="hidden" name="club_ids" value={c.id} />
                      </span>
                    ))}
                  </div>
                )}
                {canEdit && !ended && (
                  <div className="grid sm:grid-cols-[160px_1fr] gap-2">
                    <select value={clubCountry} onChange={(e) => setClubCountry(e.target.value)} className={inputCls} aria-label="Course country">
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <ClubCombobox
                      name="club_pick"
                      country={clubCountry}
                      onSelect={(club) => {
                        if (!v.clubs.some((c) => c.id === club.id)) set("clubs", [...v.clubs, club]);
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="grid gap-1">
                  <span className={labelCls}>Starts (Irish time)</span>
                  <input name="starts_at" type="datetime-local" value={v.starts_at ?? ""} onChange={(e) => set("starts_at", e.target.value)} disabled={ended} className={inputCls} />
                </label>
                <label className="grid gap-1">
                  <span className={labelCls}>Ends (Irish time){v.pricing_model === "flat" ? " *" : ""}</span>
                  <input name="ends_at" type="datetime-local" value={v.ends_at ?? ""} onChange={(e) => set("ends_at", e.target.value)} required={v.pricing_model === "flat"} disabled={ended} className={inputCls} />
                </label>
                <label className="grid gap-1">
                  <span className={labelCls}>Weight (1–100)</span>
                  <input name="weight" type="number" min={1} max={100} value={v.weight} onChange={(e) => set("weight", Number(e.target.value))} disabled={ended} className={inputCls} />
                </label>
              </div>
              <p className="text-xs text-ink-500 -mt-2">Weight: when several adverts fit the same spot, a weight-4 advert shows about four times as often as a weight-1.</p>
            </div>
          </Section>

          {/* 5 — What they pay */}
          <Section n={5} title="What they pay">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className={labelCls}>Pricing</span>
                <select name="pricing_model" value={v.pricing_model} onChange={(e) => set("pricing_model", e.target.value as PricingModel)} disabled={ended} className={inputCls}>
                  {(["flat", "cpm", "cpc"] as const).map((p) => (
                    <option key={p} value={p}>
                      {PRICING_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className={labelCls}>{v.pricing_model === "flat" ? "Total fee (€)" : v.pricing_model === "cpm" ? "€ per 1,000 views" : "€ per click"}</span>
                <input name="rate_eur" inputMode="decimal" value={v.rate_eur} onChange={(e) => set("rate_eur", e.target.value)} disabled={ended} className={inputCls} placeholder={v.pricing_model === "flat" ? "e.g. 450" : "e.g. 12.50"} />
              </label>
              {v.pricing_model !== "flat" && (
                <label className="grid gap-1">
                  <span className={labelCls}>Budget cap (€, optional)</span>
                  <input name="budget_cap_eur" inputMode="decimal" value={v.budget_cap_eur} onChange={(e) => set("budget_cap_eur", e.target.value)} disabled={ended} className={inputCls} placeholder="Stops the campaign when reached" />
                </label>
              )}
              <label className="grid gap-1">
                <span className={labelCls}>Payment</span>
                <select name="payment_status" value={v.payment_status} onChange={(e) => set("payment_status", e.target.value as PaymentStatus)} className={inputCls}>
                  {(["unpaid", "invoiced", "paid", "waived"] as const).map((p) => (
                    <option key={p} value={p}>
                      {PAYMENT_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-ink-500 mt-3">
              {v.pricing_model === "flat"
                ? "Earned evenly by day across the run. Booked in full once approved."
                : "Billed on de-duplicated views/clicks from signed-in members. With a cap, the campaign ends itself when it's spent."}
            </p>
          </Section>
        </fieldset>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3 sticky bottom-0 bg-cream-50/95 py-3 border-t border-line">
            {ended ? (
              <button type="submit" name="intent" value="draft" disabled={pending} className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 disabled:opacity-60">
                {pending ? "Saving…" : "Save payment status"}
              </button>
            ) : canSubmitForApproval ? (
              <>
                <button type="submit" name="intent" value="draft" disabled={pending} className="px-5 py-2.5 rounded-full font-bold text-sm border border-line bg-surface text-ink-900 hover:bg-cream-100 disabled:opacity-60">
                  {pending ? "Saving…" : "Save draft"}
                </button>
                <button type="submit" name="intent" value="submit" disabled={pending} className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 disabled:opacity-60">
                  {pending ? "Sending…" : "Submit for approval"}
                </button>
              </>
            ) : (
              <button type="submit" name="intent" value="draft" disabled={pending} className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 disabled:opacity-60">
                {pending ? "Saving…" : "Save changes"}
              </button>
            )}
            {!pending && state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
            {!pending && state.success && <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Saved.</p>}
            {!isNew && (initial.status === "approved" || initial.status === "paused") && (
              <p className="text-xs text-ink-500 basis-full">Changing what members see (creative, text, link, category or format) sends it back for approval.</p>
            )}
          </div>
        )}
      </form>

      <PhonePreview
        ad={{
          format: v.format,
          displayStyle: v.display_style,
          countdownSeconds: v.countdown_seconds,
          imageUrl: v.image_url,
          imageWideUrl: v.image_wide_url,
          imageSquareUrl: v.image_square_url,
          headline: v.headline ?? "",
          body: v.body ?? "",
          buttonText: v.button_text ?? "",
          advertiserName: advertiserChoice === "new" ? newAdvertiser : chosenAdvertiser?.name ?? "",
          advertiserLogoUrl: chosenAdvertiser?.logo_url ?? null,
        }}
      />
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-2xl p-5">
      <h2 className="font-display font-bold text-lg text-ink-900 mb-4 flex items-center gap-3">
        <span className="w-7 h-7 rounded-full bg-navy-900 text-gold-400 text-sm flex items-center justify-center font-sans">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Count({ n, max }: { n: number; max: number }) {
  return <span className={`normal-case tracking-normal font-normal ${n > max ? "text-red-600" : "text-ink-500"}`}>({n}/{max})</span>;
}

function Chip({ on, onClick, disabled, small = false, children }: { on: boolean; onClick: () => void; disabled?: boolean; small?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`rounded-full border font-semibold transition ${small ? "text-xs px-2.5 py-1" : "text-sm px-3 py-1.5"} ${
        on ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line text-ink-900 hover:border-ink-500"
      }`}
    >
      {children}
    </button>
  );
}

function Upload({
  slot,
  name,
  label,
  value,
  onChange,
  disabled,
}: {
  slot: CreativeSlot;
  name: string;
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const spec = CREATIVE_SPECS[slot];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_CREATIVE_BYTES) {
      setError("Advert images must be 2 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("slot", slot);
      body.append("file", file);
      const res = await fetch("/admin/advertising/upload", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Couldn't upload that image.");
      onChange(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <span className={labelCls}>{label}</span>
      <input type="hidden" name={name} value={value ?? ""} />
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-lg bg-cream-100 border border-line overflow-hidden flex items-center justify-center shrink-0">
          {value ? <img src={value} alt="" className="w-full h-full object-contain" /> : <span className="text-[10px] text-ink-500 text-center px-1">{spec.ratioW}:{spec.ratioH}</span>}
        </div>
        <div className="grid gap-1 text-xs text-ink-500">
          <span>
            {spec.label} · {spec.recommended} ideal · min {spec.minWidth} px wide · JPEG/PNG/WEBP ≤ 2 MB
          </span>
          <span>{spec.hint}</span>
          {!disabled && (
            <span className="flex gap-3">
              <label className="cursor-pointer font-bold text-green-700 underline">
                {busy ? "Uploading…" : value ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void upload(f);
                  }}
                />
              </label>
              {value && (
                <button type="button" className="underline" onClick={() => onChange(null)}>
                  Remove
                </button>
              )}
            </span>
          )}
          {error && <span className="text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
