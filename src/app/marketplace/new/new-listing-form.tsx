"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { COUNTIES } from "@/lib/clubs";
import {
  CATEGORIES,
  CONDITIONS,
  SUBCATEGORIES,
  SALE_TYPES,
  DELIVERY_OPTIONS,
  MAX_COLLECTION_NOTES_LENGTH,
  MIN_AUCTION_DURATION_HOURS,
  MAX_AUCTION_DURATION_DAYS,
} from "@/lib/marketplace";
import { SALE_TYPE_LABELS, DELIVERY_OPTION_LABELS } from "@/lib/format";
import { createListing, type ListingFormState } from "./actions";
import ImageUploader from "./image-uploader";

const initialState: ListingFormState = {};

const inputClass =
  "px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 mt-1">{message}</p>;
}

export default function NewListingForm() {
  const [state, formAction, pending] = useActionState(createListing, initialState);

  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  // Defaults to accepting offers rather than "fixed_price" — a seller who
  // wants a firm price still opts out in one click, but the common case
  // (a used club, a buyer who wants to haggle) no longer depends on the
  // seller noticing this select at all. Sale type is immutable after
  // creation (see the edit form), so this default is the only chance a
  // seller gets at it.
  const [saleType, setSaleType] = useState<(typeof SALE_TYPES)[number]>("offers_allowed");
  const [dirty, setDirty] = useState(false);

  const subcategoryOptions = useMemo(
    () => (category ? SUBCATEGORIES[category as (typeof CATEGORIES)[number]] : undefined),
    [category]
  );

  // Warn on an actual browser-level navigation away (closing the tab, typing
  // a new URL, the back button) while there's unsaved work — a photo
  // already uploaded to Storage, or any field touched. Doesn't fire for the
  // form's own successful submit: createListing's redirect() is a Next.js
  // client-side navigation, not a full page unload, and this listener is
  // torn down (dirty -> false, set in the form's onSubmit below) before that
  // navigation ever happens.
  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const fieldErrors = state.fieldErrors || {};
  const isAuction = saleType === "auction" || saleType === "auction_with_buy_now";

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="grid gap-4"
    >
      <div className="grid gap-1.5">
        <label htmlFor="title" className="text-[13.5px] font-bold">Title</label>
        <input
          id="title"
          name="title"
          required
          placeholder="e.g. TaylorMade Stealth 2 Driver, 10.5°"
          className={inputClass}
        />
        <FieldError message={fieldErrors.title} />
      </div>

      <ImageUploader />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="category" className="text-[13.5px] font-bold">Category</label>
          <select
            id="category"
            name="category"
            required
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubcategory("");
            }}
            className={inputClass}
          >
            <option value="" disabled>Select a category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <FieldError message={fieldErrors.category} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="subcategory" className="text-[13.5px] font-bold">
            Subcategory <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <select
            id="subcategory"
            name="subcategory"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            disabled={!subcategoryOptions}
            className={`${inputClass} disabled:opacity-50`}
          >
            <option value="">{subcategoryOptions ? "Select a subcategory" : "Choose a category first"}</option>
            {subcategoryOptions?.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <FieldError message={fieldErrors.subcategory} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="condition" className="text-[13.5px] font-bold">Condition</label>
          <select id="condition" name="condition" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select a condition</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <FieldError message={fieldErrors.condition} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="county" className="text-[13.5px] font-bold">County (location)</label>
          <select id="county" name="county" defaultValue="" className={inputClass}>
            <option value="">Select a county</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <FieldError message={fieldErrors.county} />
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="description" className="text-[13.5px] font-bold">Description</label>
        <textarea
          id="description"
          name="description"
          rows={4}
          placeholder="Condition details, why you're selling, any extras included…"
          className={`${inputClass} resize-y`}
        />
        <FieldError message={fieldErrors.description} />
      </div>

      <div className="border-t border-line pt-4 grid gap-1.5">
        <label htmlFor="saleType" className="text-[13.5px] font-bold">How are you selling it?</label>
        <select
          id="saleType"
          name="saleType"
          required
          value={saleType}
          onChange={(e) => setSaleType(e.target.value as (typeof SALE_TYPES)[number])}
          className={inputClass}
        >
          {SALE_TYPES.map((t) => <option key={t} value={t}>{SALE_TYPE_LABELS[t]}</option>)}
        </select>
        <p className="text-xs text-ink-500">
          {saleType === "offers_allowed"
            ? "Buyers see both Buy Now and Make an offer. You can accept, decline or counter any offer — nothing is agreed until you do."
            : saleType === "fixed_price"
              ? "Buyers can only pay your asking price. No one will be able to make you an offer."
              : "You can't change the sale type after the listing is created."}
        </p>
        <FieldError message={fieldErrors.saleType} />
      </div>

      {!isAuction ? (
        <div className="grid gap-1.5 max-w-[220px]">
          <label htmlFor="priceEur" className="text-[13.5px] font-bold">Price (EUR)</label>
          <input
            id="priceEur"
            name="priceEur"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="e.g. 220"
            className={inputClass}
          />
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
              <input
                id="startingPriceEur"
                name="startingPriceEur"
                type="number"
                step="0.01"
                min="0.01"
                required
                className={inputClass}
              />
              <FieldError message={fieldErrors.startingPriceEur} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="minIncrementEur" className="text-[13.5px] font-bold">Minimum bid increment (EUR)</label>
              <input
                id="minIncrementEur"
                name="minIncrementEur"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue="1"
                required
                className={inputClass}
              />
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
                <input
                  id="buyNowPriceEur"
                  name="buyNowPriceEur"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className={inputClass}
                />
                <FieldError message={fieldErrors.buyNowPriceEur} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="startsAt" className="text-[13.5px] font-bold">Starts</label>
              <input id="startsAt" name="startsAt" type="datetime-local" required className={inputClass} />
              <FieldError message={fieldErrors.startsAt} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="endsAt" className="text-[13.5px] font-bold">Ends</label>
              <input id="endsAt" name="endsAt" type="datetime-local" required className={inputClass} />
              <FieldError message={fieldErrors.endsAt} />
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-line pt-4 grid gap-2">
        <span className="text-[13.5px] font-bold">Delivery</span>
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

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save as draft"}
      </button>
      <p className="text-xs text-ink-500 text-center -mt-2">
        You&apos;ll preview it and confirm before it goes live.
      </p>
    </form>
  );
}
