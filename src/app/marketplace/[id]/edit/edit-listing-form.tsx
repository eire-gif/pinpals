"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import RegionSelect from "@/components/region-select";
import {
  CATEGORIES,
  CONDITIONS,
  SUBCATEGORIES,
  DELIVERY_OPTIONS,
  MAX_COLLECTION_NOTES_LENGTH,
  MIN_AUCTION_DURATION_HOURS,
  MAX_AUCTION_DURATION_DAYS,
  centsToEur,
  isAuctionSaleType,
} from "@/lib/marketplace";
import { SALE_TYPE_LABELS, DELIVERY_OPTION_LABELS } from "@/lib/format";
import ItemDetailsFields from "@/components/marketplace/item-details-fields";
import DescriptionField from "@/components/marketplace/description-field";
import type { Listing, ListingImage, Auction, SaleType } from "@/lib/types";
import { updateListing, type UpdateListingState } from "./actions";
import EditImageManager from "./edit-image-manager";

const initialState: UpdateListingState = {};

const inputClass =
  "px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 mt-1">{message}</p>;
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time, not an ISO string
 * (which is UTC, and would silently shift the displayed value for anyone
 * not in UTC+0) — this reformats a stored timestamp for the input's own
 * defaultValue. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditListingForm({
  listing,
  images,
  auction,
}: {
  listing: Listing;
  images: ListingImage[];
  auction: Auction | null;
}) {
  const updateListingForThisListing = updateListing.bind(null, listing.id);
  const [state, formAction, pending] = useActionState(updateListingForThisListing, initialState);

  const [category, setCategory] = useState<string>(listing.category);
  const [subcategory, setSubcategory] = useState<string>(listing.subcategory || "");
  const [brand, setBrand] = useState<string>(listing.brand || "");
  const [dirty, setDirty] = useState(false);

  const subcategoryOptions = useMemo(
    () => (category ? SUBCATEGORIES[category as (typeof CATEGORIES)[number]] : undefined),
    [category]
  );

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const fieldErrors = state.fieldErrors || {};
  const isAuction = isAuctionSaleType(listing.sale_type);
  // Once an auction has moved past `scheduled` (its first accepted bid —
  // see apply_new_bid(), 0039), prevent_auction_edit_after_first_bid()
  // (0046) rejects any change to its price/timing fields at the DB layer no
  // matter what this form sends. Disabling the inputs here is purely a
  // "don't invite an error the seller can't act on" nicety — the actual
  // enforcement is the trigger (and, one layer further out, `auctions`
  // having no seller-facing UPDATE grant at all).
  const auctionLocked = isAuction && auction !== null && auction.status !== "scheduled";

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="grid gap-4"
    >
      {state.success && (
        <p className="text-sm text-green-800 bg-green-100 rounded-lg px-3.5 py-2.5">Changes saved.</p>
      )}

      {auctionLocked && (
        <p className="text-sm text-ink-900 bg-cream-100 rounded-lg px-3.5 py-2.5">
          This auction has already received a bid, so the title, photos, description, category and condition are
          locked — they&apos;re part of what a bidder is bidding on. Location, delivery and collection notes can
          still be changed.
        </p>
      )}

      <div className="grid gap-1.5">
        <label htmlFor="title" className="text-[13.5px] font-bold">Title</label>
        <input
          id="title"
          name="title"
          required
          disabled={auctionLocked}
          defaultValue={listing.title}
          className={`${inputClass} disabled:opacity-60`}
        />
        <FieldError message={fieldErrors.title} />
      </div>

      <EditImageManager initialImages={images} locked={auctionLocked} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="category" className="text-[13.5px] font-bold">Category</label>
          <select
            id="category"
            name="category"
            required
            value={category}
            disabled={auctionLocked}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubcategory("");
            }}
            className={`${inputClass} disabled:opacity-60`}
          >
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
            disabled={!subcategoryOptions || auctionLocked}
            className={`${inputClass} disabled:opacity-50`}
          >
            <option value="">{subcategoryOptions ? "Select a subcategory" : "Choose a category first"}</option>
            {subcategoryOptions?.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <FieldError message={fieldErrors.subcategory} />
        </div>
      </div>

      <ItemDetailsFields
        category={category}
        subcategory={subcategory}
        brand={brand}
        onBrandChange={setBrand}
        defaults={listing}
        disabled={auctionLocked}
        fieldErrors={fieldErrors}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="condition" className="text-[13.5px] font-bold">Condition</label>
          <select
            id="condition"
            name="condition"
            required
            disabled={auctionLocked}
            defaultValue={listing.condition}
            className={`${inputClass} disabled:opacity-60`}
          >
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <FieldError message={fieldErrors.condition} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="county" className="text-[13.5px] font-bold">County (location)</label>
          <RegionSelect
            id="county"
            name="county"
            defaultValue={listing.county || ""}
            placeholder="Select a county"
            className={inputClass}
          />
          <FieldError message={fieldErrors.county} />
        </div>
      </div>

      <DescriptionField
        defaultValue={listing.description || ""}
        disabled={auctionLocked}
        error={fieldErrors.description}
      />

      <div className="border-t border-line pt-4 grid gap-1.5">
        <span className="text-[13.5px] font-bold">How it&apos;s being sold</span>
        <p className="text-sm text-ink-900 bg-cream-100 rounded-lg px-3.5 py-2.5">
          {SALE_TYPE_LABELS[listing.sale_type as SaleType]}
          <span className="block text-xs text-ink-500 font-normal mt-0.5">
            The sale type can&apos;t be changed after a listing is created — remove this listing and create a new one
            if you need to switch between fixed price, offers, or auction.
          </span>
        </p>
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
            defaultValue={listing.price_eur ?? undefined}
            className={inputClass}
          />
          <FieldError message={fieldErrors.priceEur} />
        </div>
      ) : (
        <div className="grid gap-4 bg-cream-100 rounded-xl p-4">
          {auctionLocked ? (
            <p className="text-sm text-ink-900 font-semibold">
              This auction has already received a bid, so its price and timing are locked.
            </p>
          ) : (
            <p className="text-xs text-ink-500 -mt-1">
              Auctions run for at least {MIN_AUCTION_DURATION_HOURS} hour and at most {MAX_AUCTION_DURATION_DAYS} days.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="startingPriceEur" className="text-[13.5px] font-bold">Starting bid (EUR)</label>
              <input
                id="startingPriceEur"
                name="startingPriceEur"
                type="number"
                step="0.01"
                min="0.01"
                disabled={auctionLocked}
                defaultValue={auction ? centsToEur(auction.starting_price_cents) : undefined}
                className={`${inputClass} disabled:opacity-60`}
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
                disabled={auctionLocked}
                defaultValue={auction ? centsToEur(auction.min_increment_cents) : undefined}
                className={`${inputClass} disabled:opacity-60`}
              />
              <FieldError message={fieldErrors.minIncrementEur} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="reservePriceEur" className="text-[13.5px] font-bold">
                Reserve price (EUR) <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <input
                id="reservePriceEur"
                name="reservePriceEur"
                type="number"
                step="0.01"
                min="0.01"
                disabled={auctionLocked}
                defaultValue={auction?.reserve_price_cents != null ? centsToEur(auction.reserve_price_cents) : undefined}
                className={`${inputClass} disabled:opacity-60`}
              />
              <FieldError message={fieldErrors.reservePriceEur} />
            </div>
            {listing.sale_type === "auction_with_buy_now" && (
              <div className="grid gap-1.5">
                <label htmlFor="buyNowPriceEur" className="text-[13.5px] font-bold">Buy It Now price (EUR)</label>
                <input
                  id="buyNowPriceEur"
                  name="buyNowPriceEur"
                  type="number"
                  step="0.01"
                  min="0.01"
                  disabled={auctionLocked}
                  defaultValue={auction?.buy_now_price_cents != null ? centsToEur(auction.buy_now_price_cents) : undefined}
                  className={`${inputClass} disabled:opacity-60`}
                />
                <FieldError message={fieldErrors.buyNowPriceEur} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="startsAt" className="text-[13.5px] font-bold">Starts</label>
              <input
                id="startsAt"
                name="startsAt"
                type="datetime-local"
                disabled={auctionLocked}
                defaultValue={auction ? toDatetimeLocalValue(auction.starts_at) : undefined}
                className={`${inputClass} disabled:opacity-60`}
              />
              <FieldError message={fieldErrors.startsAt} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="endsAt" className="text-[13.5px] font-bold">Ends</label>
              <input
                id="endsAt"
                name="endsAt"
                type="datetime-local"
                disabled={auctionLocked}
                defaultValue={auction ? toDatetimeLocalValue(auction.ends_at) : undefined}
                className={`${inputClass} disabled:opacity-60`}
              />
              <FieldError message={fieldErrors.endsAt} />
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-line pt-4 grid gap-2">
        <span className="text-[13.5px] font-bold">Delivery</span>
        <input type="hidden" name="deliveryOptionsTouched" value="1" />
        <div className="flex gap-4 flex-wrap">
          {DELIVERY_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="deliveryOptions"
                value={opt}
                defaultChecked={listing.delivery_options.includes(opt)}
              />
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
          defaultValue={listing.collection_notes || ""}
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
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
