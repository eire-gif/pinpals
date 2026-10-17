"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import RegionSelect from "@/components/region-select";
import {
  CONDITIONS,
  SALE_TYPES,
  DELIVERY_OPTIONS,
  MAX_COLLECTION_NOTES_LENGTH,
  MIN_AUCTION_DURATION_HOURS,
  MAX_AUCTION_DURATION_DAYS,
} from "@/lib/marketplace";
import { DEXTERITIES, SHAFT_FLEXES, SHAFT_MATERIALS, MAX_SPEC_LENGTH, brandLabel as curatedBrandLabel, specFieldsFor } from "@/lib/marketplace-brands";
import { SALE_TYPE_LABELS, DELIVERY_OPTION_LABELS } from "@/lib/format";
import { FIELD_CLASS as inputClass, SELECT_CLASS } from "@/lib/ui";
import DescriptionField from "@/components/marketplace/description-field";
import type { FinderModel } from "@/lib/finder";
import {
  CONDITION_HINTS,
  LOFT_CHOICES,
  SELL_STEPS,
  SELL_TILES,
  modelQuestion,
  subcategoryFor,
  tileByKey,
  tileFor,
  writeTitle,
} from "@/lib/sell-flow";
import { createListing, type ListingFormState } from "./actions";
import ImageUploader from "./image-uploader";
import BrandStep from "./brand-step";
import ModelStep from "./model-step";

const initialState: ListingFormState = {};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 mt-1">{message}</p>;
}

/** Which step a server error belongs to, so the form opens there. */
const FIELD_STEP: Record<string, number> = {
  description: 0,
  images: 0,
  category: 1,
  subcategory: 1,
  brand: 2,
  brandOther: 2,
  model: 3,
  modelId: 3,
  condition: 4,
  dexterity: 4,
  shaftFlex: 4,
  shaftMaterial: 4,
  loft: 4,
  itemSize: 4,
};

const STEP_TITLES = ["Photos and a description", "What are you selling?", "Which brand?", "Which model?", "Tell buyers about it", "Price it and post it"];

const NEXT_LABEL = ["Next: what is it?", "Next: brand", "Next: model", "Next: details", "Next: price"];

/**
 * Selling, step by step (approved mock-ups "Selling, rebuilt", Website ·
 * Sell an item). Six steps, one question each, in the order buyers search —
 * so every ad lands in the right place in the finder:
 *
 *   1 Photos and a description · 2 What is it (clubs, and everything else
 *   golf) · 3 Brand · 4 Model · 5 Details · 6 Price and post.
 *
 * One <form> holds every step. Each step's fields are rendered once and
 * only hidden while the step is folded, so the photo uploader and the
 * pickers keep their state and a single submit sends everything to
 * createListing() exactly as before. Finished steps fold to one line with
 * Change; the ad's preview sits beside the form. The tiles and the title
 * rules are shared with the app (src/lib/sell-flow.ts).
 */
export default function NewListingForm({
  shop = null,
  start,
}: {
  shop?: { id: number; name: string } | null;
  /** Prefilled from the finder's "Sell yours" link (0163). */
  start?: { category: string; brand: string; modelId: string };
} = {}) {
  const [state, formAction, pending] = useActionState(createListing, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const startTile = start?.category ? tileFor(start.category) : undefined;
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [tileKey, setTileKey] = useState(startTile?.key ?? "");
  const [kind, setKind] = useState(startTile?.kinds?.[0]?.subcategory ?? "");
  const [brand, setBrand] = useState(start?.brand ?? "");
  const [brandOther, setBrandOther] = useState("");
  const [brandName, setBrandName] = useState("");
  const [modelId, setModelId] = useState(start?.modelId ?? "");
  const [model, setModel] = useState("");
  const [picked, setPicked] = useState<FinderModel | null>(null);
  const [condition, setCondition] = useState(shop ? "New / unused" : "");
  const [loft, setLoft] = useState("");
  const [flex, setFlex] = useState("");
  const [material, setMaterial] = useState("");
  const [hand, setHand] = useState("");
  const [size, setSize] = useState("");
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [price, setPrice] = useState("");
  const [saleType, setSaleType] = useState<(typeof SALE_TYPES)[number]>("offers_allowed");
  const [snapshot, setSnapshot] = useState<{ description: string; cover: string; photos: number }>({ description: "", cover: "", photos: 0 });
  const [dirty, setDirty] = useState(false);

  const tile = tileByKey(tileKey);
  const category = tile?.category ?? "";
  const subcategory = tile ? subcategoryFor(tile, kind) : "";
  const specs = category ? specFieldsFor(category).filter((f) => f !== "model") : [];
  const modelText = model && picked && !model.toLowerCase().includes(picked.family.toLowerCase()) ? `${picked.family} ${model}` : model || picked?.family || "";
  const brandLabel = brand === "other" ? brandOther : brand === "unknown" || brand === "mixed" ? "" : brandName || (brand ? curatedBrandLabel(brand) : "");
  const autoTitle = writeTitle({ brandLabel, model: modelText, tile, kind: subcategory, loft, flex, size, hand });
  const shownTitle = titleEdited ? title : autoTitle;

  // A server error opens the step it belongs to (derived during render, not an effect).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    const steps = Object.keys(state.fieldErrors ?? {}).map((k) => FIELD_STEP[k] ?? 5);
    if (steps.length) setStep(Math.min(...steps));
  }
  const fieldErrors = state.fieldErrors || {};

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function readSnapshot() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    let cover = "";
    let photos = 0;
    try {
      const imgs = JSON.parse(String(data.get("images") || "[]")) as { url: string; position: number }[];
      photos = imgs.length;
      cover = [...imgs].sort((a, b) => a.position - b.position)[0]?.url ?? "";
    } catch {
      // Nothing uploaded yet.
    }
    setSnapshot({ description: String(data.get("description") || ""), cover, photos });
  }

  function go(next: number) {
    readSnapshot();
    setStep(next);
    setReached((r) => Math.max(r, next));
    requestAnimationFrame(() => document.getElementById(`sell-step-${next}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const isAuction = saleType === "auction" || saleType === "auction_with_buy_now";
  const canNext = [true, !!tile, true, true, !!condition];

  const summaries = [
    snapshot.photos || snapshot.description
      ? `${snapshot.photos} photo${snapshot.photos === 1 ? "" : "s"}${snapshot.description ? ` · ${snapshot.description.slice(0, 90)}${snapshot.description.length > 90 ? "…" : ""}` : ""}`
      : "No photos yet",
    tile ? [tile.group === "clubs" ? "Clubs" : "Golf gear", tile.label, tile.kinds?.find((k) => k.subcategory === subcategory)?.label].filter(Boolean).join(" › ") : "",
    brand ? (brand === "other" ? brandOther || "Other" : brand === "unknown" ? "Unbranded" : brand === "mixed" ? "Mixed brands" : brandLabel) : "Skipped",
    modelText || "Skipped",
    [condition, loft, flex, material, hand === "Left-handed" ? "Left-handed" : "", size ? `Size ${size}` : ""].filter(Boolean).join(" · "),
    "",
  ];

  const chip = (on: boolean) =>
    `px-3.5 py-2 rounded-full text-sm font-bold border transition ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line hover:border-navy-900"}`;

  /**
   * One step: the open card, or a folded line (✓ with Change once reached,
   * dashed before). A plain function, not a component, so the children
   * keep their state as steps open and fold.
   */
  function frame(index: number, children: ReactNode, footer?: ReactNode) {
    const open = step === index;
    const done = !open && index <= reached;
    return (
      <section id={`sell-step-${index}`} className="scroll-mt-24" aria-labelledby={`sell-step-${index}-h`}>
        {!open ? (
          done ? (
            <div className="flex items-center gap-4 bg-surface border border-line rounded-2xl px-5 py-3.5">
              {index === 0 && snapshot.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={snapshot.cover} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
              ) : (
                <span className="w-8 h-8 shrink-0 rounded-full bg-green-700 text-white text-sm font-extrabold flex items-center justify-center" aria-hidden>
                  ✓
                </span>
              )}
              <span className="flex-1 min-w-0">
                <span id={`sell-step-${index}-h`} className="block text-[11.5px] font-extrabold uppercase tracking-wider text-ink-500">
                  {SELL_STEPS[index]}
                </span>
                <span className="block font-bold truncate">{summaries[index] || "—"}</span>
              </span>
              <button type="button" onClick={() => go(index)} className="text-sm font-bold text-green-700">
                Change
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-4 border border-dashed border-[#d8ccb0] rounded-2xl px-5 py-3.5 text-ink-500">
              <span className="w-8 h-8 shrink-0 rounded-full border-[1.5px] border-[#c9bfa8] text-sm font-extrabold flex items-center justify-center">{index + 1}</span>
              <span id={`sell-step-${index}-h`} className="font-bold">
                {STEP_TITLES[index]}
              </span>
            </div>
          )
        ) : null}
        <div className={open ? "bg-surface border-2 border-navy-900 rounded-2xl p-5 sm:p-6 grid grid-cols-1 gap-5 min-w-0" : "hidden"}>
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 shrink-0 rounded-full bg-navy-900 text-cream-50 text-sm font-extrabold flex items-center justify-center">{index + 1}</span>
            <h2 id={open ? `sell-step-${index}-h` : undefined} className="font-display font-semibold text-2xl text-navy-900">
              {index === 3 ? modelQuestion(brandLabel, tile) : STEP_TITLES[index]}
            </h2>
          </div>
          {children}
          {footer ?? (
            <div className="flex items-center justify-between gap-3 pt-1">
              {index > 0 ? (
                <button type="button" onClick={() => go(index - 1)} className="text-sm font-bold text-ink-500 hover:text-ink-900">
                  ← Back
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => go(index + 1)}
                disabled={!canNext[index]}
                className="px-6 py-3 rounded-xl bg-green-700 text-cream-50 font-extrabold hover:bg-green-600 transition disabled:opacity-50"
              >
                {(index === 2 && !brand) || (index === 3 && !modelText) ? "Skip" : NEXT_LABEL[index]}
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-wrap gap-7 items-start">
      <form
        ref={formRef}
        action={formAction}
        noValidate
        onChange={() => setDirty(true)}
        onSubmit={() => setDirty(false)}
        className="flex-[3_1_520px] min-w-0 grid grid-cols-1 gap-3"
      >
        {/* What the steps decide, as the fields createListing() reads. */}
        <input type="hidden" name="category" value={category} />
        <input type="hidden" name="subcategory" value={subcategory} />
        <input type="hidden" name="brand" value={brand} />
        <input type="hidden" name="brandOther" value={brand === "other" ? brandOther : ""} />
        <input type="hidden" name="model" value={modelText} />
        <input type="hidden" name="modelId" value={modelId} />
        <input type="hidden" name="condition" value={condition} />
        <input type="hidden" name="title" value={shownTitle} />
        <input type="hidden" name="shaftFlex" value={specs.includes("shaftFlex") ? flex : ""} />
        <input type="hidden" name="shaftMaterial" value={specs.includes("shaftMaterial") ? material : ""} />
        <input type="hidden" name="dexterity" value={specs.includes("dexterity") ? hand : ""} />
        <input type="hidden" name="loft" value={specs.includes("loft") ? loft : ""} />
        <input type="hidden" name="itemSize" value={specs.includes("itemSize") ? size : ""} />

        {shop ? (
          <div className="rounded-2xl bg-navy-900 text-cream-50 p-4 grid gap-3">
            <input type="hidden" name="storeId" value={shop.id} />
            <p className="text-sm">
              Listing as <span className="font-extrabold text-gold-400">{shop.name}</span> — new stock, click &amp; collect at the shop.
            </p>
            <label className="grid gap-1.5 text-sm font-bold">
              How many in stock?
              <input name="stockQuantity" type="number" min={1} max={9999} defaultValue={1} className="w-32 rounded-xl px-3 py-2 text-ink-900 bg-surface" />
            </label>
          </div>
        ) : null}

        {frame(
          0,
          <>
            <ImageUploader />
            <DescriptionField error={fieldErrors.description} />
          </>
        )}

        {frame(
          1,
          <div className="grid gap-4">
            {(["clubs", "other"] as const).map((group) => (
              <div key={group}>
                <p className="text-xs font-extrabold uppercase tracking-wider text-ink-500 mb-2">{group === "clubs" ? "Clubs" : "Everything else golf"}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SELL_TILES.filter((t) => t.group === group).map((t) => {
                    const on = t.key === tileKey;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setTileKey(t.key);
                          setKind(t.kinds?.[0]?.subcategory ?? "");
                          if (t.category !== category) {
                            setBrand("");
                            setBrandOther("");
                            setModelId("");
                            setModel("");
                            setPicked(null);
                          }
                        }}
                        className={`h-14 rounded-xl px-3 text-left font-bold text-[15px] transition ${on ? "border-2 border-green-700 bg-green-100" : "border border-line bg-surface hover:border-navy-900"}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {tile?.kinds ? (
              <div className="rounded-2xl border border-line bg-cream-50 p-4 grid gap-2">
                <span className="text-sm font-extrabold text-navy-900">Which kind?</span>
                <div className="flex flex-wrap gap-2">
                  {tile.kinds.map((k) => (
                    <button key={k.subcategory} type="button" aria-pressed={subcategory === k.subcategory} onClick={() => setKind(k.subcategory)} className={chip(subcategory === k.subcategory)}>
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <FieldError message={fieldErrors.category || fieldErrors.subcategory} />
          </div>
        )}

        {frame(
          2,
          <>
            {category ? (
              <BrandStep
                category={category}
                subcategory={subcategory}
                brand={brand}
                brandOther={brandOther}
                onPick={(id, other, label) => {
                  if (id !== brand) {
                    setModelId("");
                    setModel("");
                    setPicked(null);
                  }
                  setBrand(id);
                  setBrandOther(other);
                  setBrandName(label);
                }}
              />
            ) : (
              <p className="text-ink-500">Pick what it is first.</p>
            )}
            <FieldError message={fieldErrors.brand || fieldErrors.brandOther} />
          </>
        )}

        {frame(
          3,
          <>
            <ModelStep
              brand={brand}
              category={category}
              modelId={modelId}
              model={model}
              onChange={(next) => {
                setModelId(next.modelId);
                setModel(next.model);
                setPicked(next.picked);
              }}
            />
            <FieldError message={fieldErrors.model || fieldErrors.modelId} />
          </>
        )}

        {frame(
          4,
          <>
            <div className="grid gap-2">
              <span className="text-sm font-extrabold text-navy-900">Condition</span>
              <div className="grid sm:grid-cols-2 gap-2">
                {CONDITIONS.map((c) => {
                  const on = condition === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      disabled={!!shop}
                      onClick={() => setCondition(c)}
                      className={`text-left rounded-xl px-4 py-3 transition ${on ? "border-2 border-green-700 bg-green-100" : "border border-line bg-surface hover:border-navy-900"} disabled:opacity-60`}
                    >
                      <span className="block font-extrabold">{c}</span>
                      <span className="block text-xs text-ink-500">{CONDITION_HINTS[c]}</span>
                    </button>
                  );
                })}
              </div>
              <FieldError message={fieldErrors.condition} />
            </div>

            {specs.includes("loft") ? (
              <div className="grid gap-2">
                <label htmlFor="loft-input" className="text-sm font-extrabold text-navy-900">
                  Loft <span className="font-normal text-ink-500">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-2 items-center">
                  {(LOFT_CHOICES[category] ?? []).map((l) => (
                    <button key={l} type="button" aria-pressed={loft === l} onClick={() => setLoft(loft === l ? "" : l)} className={chip(loft === l)}>
                      {l}
                    </button>
                  ))}
                  <input id="loft-input" value={loft} onChange={(e) => setLoft(e.target.value)} maxLength={MAX_SPEC_LENGTH} placeholder="Other" className={`${inputClass} max-w-[140px]`} />
                </div>
                <FieldError message={fieldErrors.loft} />
              </div>
            ) : null}

            {specs.includes("shaftFlex") ? (
              <div className="grid gap-2">
                <span className="text-sm font-extrabold text-navy-900">
                  Shaft flex <span className="font-normal text-ink-500">(optional)</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  {SHAFT_FLEXES.map((f) => (
                    <button key={f} type="button" aria-pressed={flex === f} onClick={() => setFlex(flex === f ? "" : f)} className={chip(flex === f)}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {specs.includes("shaftMaterial") ? (
              <div className="grid gap-2">
                <span className="text-sm font-extrabold text-navy-900">
                  Shaft <span className="font-normal text-ink-500">(optional)</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  {SHAFT_MATERIALS.map((m) => (
                    <button key={m} type="button" aria-pressed={material === m} onClick={() => setMaterial(material === m ? "" : m)} className={chip(material === m)}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {specs.includes("dexterity") ? (
              <div className="grid gap-2">
                <span className="text-sm font-extrabold text-navy-900">
                  Hand <span className="font-normal text-ink-500">(optional)</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  {DEXTERITIES.map((d) => (
                    <button key={d} type="button" aria-pressed={hand === d} onClick={() => setHand(hand === d ? "" : d)} className={chip(hand === d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {specs.includes("itemSize") ? (
              <label className="grid gap-1.5 text-sm font-extrabold text-navy-900">
                <span>
                  Size <span className="font-normal text-ink-500">(optional)</span>
                </span>
                <input value={size} onChange={(e) => setSize(e.target.value)} maxLength={MAX_SPEC_LENGTH} placeholder={tileKey === "shoes" ? "e.g. UK 9" : "e.g. M, L, XL"} className={`${inputClass} max-w-[200px]`} />
                <FieldError message={fieldErrors.itemSize} />
              </label>
            ) : null}
          </>
        )}

        {frame(
          5,
          <>
            <label className="grid gap-1.5 text-[13.5px] font-bold">
              <span>
                Title <span className="font-normal text-ink-500">— written for you, change it if you like</span>
              </span>
              <input
                value={shownTitle}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleEdited(true);
                }}
                maxLength={120}
                placeholder="e.g. TaylorMade Qi10 driver, 10.5° Stiff"
                className={inputClass}
              />
              <FieldError message={fieldErrors.title} />
            </label>

            <div className="grid gap-1.5">
              <label htmlFor="saleType" className="text-[13.5px] font-bold">How are you selling it?</label>
              <select id="saleType" name="saleType" value={saleType} onChange={(e) => setSaleType(e.target.value as (typeof SALE_TYPES)[number])} className={SELECT_CLASS}>
                {SALE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SALE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors.saleType} />
            </div>

            {!isAuction ? (
              <div className="grid gap-1.5 max-w-[220px]">
                <label htmlFor="priceEur" className="text-[13.5px] font-bold">Price (EUR)</label>
                <input id="priceEur" name="priceEur" type="number" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 220" className={inputClass} />
                <FieldError message={fieldErrors.priceEur} />
              </div>
            ) : (
              <div className="grid gap-4 bg-cream-100 rounded-xl p-4">
                <p className="text-xs text-ink-500 -mt-1">
                  Auctions run for at least {MIN_AUCTION_DURATION_HOURS} hour and at most {MAX_AUCTION_DURATION_DAYS} days.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <label htmlFor="startingPriceEur" className="text-[13.5px] font-bold">Starting bid (EUR)</label>
                    <input id="startingPriceEur" name="startingPriceEur" type="number" step="0.01" min="0.01" className={inputClass} />
                    <FieldError message={fieldErrors.startingPriceEur} />
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor="minIncrementEur" className="text-[13.5px] font-bold">Minimum bid increment (EUR)</label>
                    <input id="minIncrementEur" name="minIncrementEur" type="number" step="0.01" min="0.01" defaultValue="1" className={inputClass} />
                    <FieldError message={fieldErrors.minIncrementEur} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <label htmlFor="reservePriceEur" className="text-[13.5px] font-bold">
                      Reserve price (EUR) <span className="font-normal text-ink-500">(optional)</span>
                    </label>
                    <input id="reservePriceEur" name="reservePriceEur" type="number" step="0.01" min="0.01" className={inputClass} />
                    <FieldError message={fieldErrors.reservePriceEur} />
                  </div>
                  {saleType === "auction_with_buy_now" && (
                    <div className="grid gap-1.5">
                      <label htmlFor="buyNowPriceEur" className="text-[13.5px] font-bold">Buy It Now price (EUR)</label>
                      <input id="buyNowPriceEur" name="buyNowPriceEur" type="number" step="0.01" min="0.01" className={inputClass} />
                      <FieldError message={fieldErrors.buyNowPriceEur} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <label htmlFor="startsAt" className="text-[13.5px] font-bold">Starts</label>
                    <input id="startsAt" name="startsAt" type="datetime-local" className={inputClass} />
                    <FieldError message={fieldErrors.startsAt} />
                  </div>
                  <div className="grid gap-1.5">
                    <label htmlFor="endsAt" className="text-[13.5px] font-bold">Ends</label>
                    <input id="endsAt" name="endsAt" type="datetime-local" className={inputClass} />
                    <FieldError message={fieldErrors.endsAt} />
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-1.5 max-w-sm">
              <label htmlFor="county" className="text-[13.5px] font-bold">Where is it?</label>
              <RegionSelect id="county" name="county" placeholder="Select a county" className={SELECT_CLASS} />
              <FieldError message={fieldErrors.county} />
            </div>

            <div className="grid gap-2">
              <span className="text-[13.5px] font-bold">Getting it to the buyer</span>
              <div className="flex gap-4 flex-wrap">
                {DELIVERY_OPTIONS.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="deliveryOptions" value={opt} defaultChecked={opt === "collection"} />
                    {DELIVERY_OPTION_LABELS[opt]}
                  </label>
                ))}
              </div>
              <FieldError message={fieldErrors.deliveryOptions} />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="collectionNotes" className="text-[13.5px] font-bold">
                Collection notes <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <textarea
                id="collectionNotes"
                name="collectionNotes"
                rows={2}
                maxLength={MAX_COLLECTION_NOTES_LENGTH}
                placeholder="e.g. Available evenings and weekends, meet at the clubhouse…"
                className={`${inputClass} resize-y`}
              />
              <FieldError message={fieldErrors.collectionNotes} />
            </div>

            {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>}
            {Object.keys(fieldErrors).length > 0 && !state.error ? (
              <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">A few things need fixing — they&rsquo;re marked in red.</p>
            ) : null}
          </>,
          <>
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => go(4)} className="text-sm font-bold text-ink-500 hover:text-ink-900">
                ← Back
              </button>
              <button
                type="submit"
                disabled={pending || !shownTitle.trim() || !category || !condition}
                className="px-7 py-3.5 rounded-xl font-extrabold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save and preview"}
              </button>
            </div>
            <p className="text-xs text-ink-500 text-right -mt-2">You&apos;ll see the listing and confirm before it goes live.</p>
          </>
        )}
      </form>

      <aside className="flex-[1_1_280px] lg:sticky lg:top-24 grid gap-3">
        <span className="text-xs font-extrabold uppercase tracking-wider text-ink-500">How buyers will see it</span>
        <div className="bg-surface rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(12,32,56,0.06),0_12px_30px_rgba(12,32,56,0.08)]">
          <div className="aspect-[4/3] bg-surface-tint">
            {snapshot.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={snapshot.cover} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-ink-500">Your cover photo</div>
            )}
          </div>
          <div className="p-4 grid gap-1">
            <span className="text-[11.5px] font-extrabold uppercase tracking-wider text-green-700 truncate">
              {[category || "—", brandLabel || (brand === "unknown" ? "Unbranded" : ""), picked?.family].filter(Boolean).join(" · ")}
            </span>
            <span className="font-display font-bold text-lg leading-snug">{shownTitle || "Your title"}</span>
            <span className="font-extrabold text-xl text-navy-900">{price ? `€${Number(price).toLocaleString("en-IE")}` : "€ —"}</span>
            {condition ? <span className="text-xs text-ink-500">{condition}</span> : null}
          </div>
        </div>
        {category ? (
          <p className="text-xs text-ink-500">
            Shows under <b>{[category, brandLabel, picked?.family].filter(Boolean).join(" › ")}</b> when buyers find gear.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
