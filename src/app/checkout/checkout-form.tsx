"use client";

import { CARD_TITLE, GOLD_BUTTON, SOFT_CARD } from "@/components/marketplace/buy-styles";
import { shortClub } from "@/lib/marketplace-growth";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/format";
import { computeCheckoutTotal, formatAddress, ADDRESS_FIELD_LIMITS, DELIVERY_FEE_EUR } from "@/lib/orders";
import { createAddress } from "./actions";
import type { Address, DeliveryOption } from "@/lib/types";

const DELIVERY_LABELS: Record<DeliveryOption, string> = {
  collection: "Collect in person",
  post: `Post (+${formatPrice(DELIVERY_FEE_EUR)})`,
};

export type CheckoutItemSummary = {
  title: string;
  imageUrl: string | null;
  sellerName: string;
  priceEur: number;
  /** Sold new by a pro shop (0115): no Buyer Protection fee, the shop pays commission. */
  isShop?: boolean;
  /** Where a collection happens — the shop's club or the seller's home club. */
  meetAt?: string | null;
};

/**
 * Shared by both checkout entry points (src/app/marketplace/[id]/checkout/
 * and src/app/dashboard/orders/[id]/checkout/) — this phase's spec calls for
 * the same surface either way: item/seller summary, a delivery/collection
 * choice scoped to what THIS listing actually offers, an address picker
 * (with inline "add a new one" — the checkout-time entry point into
 * ../checkout/actions.ts's createAddress()) once 'post' is chosen, a
 * transparent line-item total recomputed live via computeCheckoutTotal()
 * (src/lib/orders.ts — a display hint only; create_purchase_order()/
 * finalize_offer_checkout(), 0050, are what's actually trusted), a buyer
 * protection/terms checkbox gating the submit button, and a duplicate-
 * submit-proof, recoverable-on-failure submit (disabled while `pending`,
 * re-enabled with the error still visible on failure — never a dead end).
 *
 * `onSubmit` is a Server Action already bound to the specific listing/order
 * id by the calling page (a Server Component) — this component only ever
 * supplies the two things the buyer actually chose here.
 */
export default function CheckoutForm({
  item,
  deliveryOptions,
  collectionNotes,
  addresses,
  submitLabel = "Confirm and reserve",
  onSubmit,
}: {
  item: CheckoutItemSummary;
  deliveryOptions: DeliveryOption[];
  collectionNotes: string | null;
  addresses: Address[];
  submitLabel?: string;
  onSubmit: (deliveryMethod: DeliveryOption, addressId: number | null) => Promise<{ error?: string } | void>;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<DeliveryOption>(deliveryOptions[0] ?? "collection");
  const [addressId, setAddressId] = useState<number | null>(addresses[0]?.id ?? null);
  const [showAddAddress, setShowAddAddress] = useState(addresses.length === 0);
  const [agreed, setAgreed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [addressPending, startAddressTransition] = useTransition();
  const [addressError, setAddressError] = useState<string | null>(null);

  // A newly-saved address only exists in this page's server-fetched
  // `addresses` prop after a refresh — router.refresh() re-runs the parent
  // Server Component and hands this component the real, DB-assigned row
  // (including its id), rather than this component guessing one locally.
  function handleAddAddress(formData: FormData) {
    setAddressError(null);
    startAddressTransition(async () => {
      const result = await createAddress({}, formData);
      if (result.error) {
        setAddressError(result.error);
      } else {
        setShowAddAddress(false);
        router.refresh();
      }
    });
  }

  const needsAddress = method === "post";
  const totals = computeCheckoutTotal(item.priceEur, method);
  // A shop sale carries no fee; orders_store_pricing() (0115) recomputes the
  // real total in the database either way — this is display only.
  const fee = item.isShop ? 0 : totals.fee;
  const delivery = totals.delivery;
  const total = Math.round((item.priceEur + fee + delivery) * 100) / 100;
  const canSubmit = agreed && !pending && (!needsAddress || addressId !== null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(method, needsAddress ? addressId : null);
      // A successful submit redirects server-side and never resolves here;
      // only a friendly error ever comes back to display.
      if (result && "error" in result && result.error) setError(result.error);
    });
  }

  return (
    <div className="grid gap-6">
      <div className={`${SOFT_CARD} flex items-center gap-4`}>
        {item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover border border-line shrink-0" />
        )}
        <div className="min-w-0">
          <h2 className="font-display font-bold text-lg truncate">{item.title}</h2>
          <p className="text-sm text-ink-500">Sold by {item.sellerName}</p>
          <p className="font-extrabold text-navy-900 text-lg mt-1">{formatPrice(item.priceEur)}</p>
        </div>
      </div>

      <div className={SOFT_CARD}>
        <h3 className={`${CARD_TITLE} mb-3`}>How you&rsquo;ll get it</h3>
        <div className="grid gap-2">
          {deliveryOptions.map((option) => (
            <label
              key={option}
              className={`flex items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 cursor-pointer transition ${
                method === option ? "border-navy-900 bg-[#f7f2e4]" : "border-line"
              }`}
            >
              <input type="radio" name="deliveryMethod" checked={method === option} onChange={() => setMethod(option)} className="accent-navy-900" />
              <span className="flex-1">
                <span className="block text-sm font-bold">
                  {option === "post" ? DELIVERY_LABELS.post.replace("Post", "Tracked post") : item.isShop ? "Collect from the pro shop" : "Meet at the club"}
                </span>
                <span className="block text-xs text-ink-500">
                  {option === "post"
                    ? "Posted with tracking. You confirm when it arrives."
                    : `${item.meetAt ? `${shortClub(item.meetAt)} · ` : ""}free${item.isShop ? "" : " · you show a handover code"}`}
                </span>
              </span>
            </label>
          ))}
        </div>
        {method === "collection" && collectionNotes && (
          <p className="text-xs text-ink-500 mt-3 bg-cream-100 rounded-lg px-3 py-2">{collectionNotes}</p>
        )}
      </div>

      {needsAddress && (
        <div className="bg-surface border border-line rounded-2xl shadow-sm p-5">
          <h3 className="font-bold text-sm mb-3">Delivery address</h3>
          {addresses.length > 0 && (
            <div className="grid gap-2 mb-3">
              {addresses.map((addr) => (
                <label
                  key={addr.id}
                  className={`flex items-start gap-3 rounded-xl border-[1.5px] px-4 py-3 cursor-pointer transition ${
                    addressId === addr.id ? "border-green-700 bg-green-100/40" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="addressId"
                    className="mt-1"
                    checked={addressId === addr.id}
                    onChange={() => setAddressId(addr.id)}
                  />
                  <span className="text-sm">
                    <span className="font-semibold block">{addr.label}</span>
                    <span className="text-ink-500">{formatAddress(addr)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {!showAddAddress ? (
            <button
              type="button"
              onClick={() => setShowAddAddress(true)}
              className="text-sm font-bold text-green-700 hover:text-green-600"
            >
              + Add a new address
            </button>
          ) : (
            <form action={handleAddAddress} className="grid gap-2.5 mt-2 border-t border-line pt-4">
              {addressError && <p className="text-xs text-red-600">{addressError}</p>}
              <input
                name="label"
                placeholder="Label (e.g. Home)"
                maxLength={ADDRESS_FIELD_LIMITS.label}
                required
                className="text-sm rounded-lg border border-line px-3 py-2"
              />
              <input
                name="recipientName"
                placeholder="Recipient name"
                maxLength={ADDRESS_FIELD_LIMITS.recipientName}
                required
                className="text-sm rounded-lg border border-line px-3 py-2"
              />
              <input
                name="line1"
                placeholder="Address line 1"
                maxLength={ADDRESS_FIELD_LIMITS.line1}
                required
                className="text-sm rounded-lg border border-line px-3 py-2"
              />
              <input
                name="line2"
                placeholder="Address line 2 (optional)"
                maxLength={ADDRESS_FIELD_LIMITS.line2}
                className="text-sm rounded-lg border border-line px-3 py-2"
              />
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  name="city"
                  placeholder="Town / city"
                  maxLength={ADDRESS_FIELD_LIMITS.city}
                  required
                  className="text-sm rounded-lg border border-line px-3 py-2"
                />
                <input
                  name="county"
                  placeholder="County"
                  maxLength={ADDRESS_FIELD_LIMITS.county}
                  className="text-sm rounded-lg border border-line px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  name="eircode"
                  placeholder="Eircode (optional)"
                  maxLength={ADDRESS_FIELD_LIMITS.eircode}
                  className="text-sm rounded-lg border border-line px-3 py-2"
                />
                <input
                  name="phone"
                  placeholder="Phone (optional)"
                  maxLength={ADDRESS_FIELD_LIMITS.phone}
                  className="text-sm rounded-lg border border-line px-3 py-2"
                />
              </div>
              <button
                type="submit"
                disabled={addressPending}
                className="justify-self-start px-4 py-2 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
              >
                {addressPending ? "Saving…" : "Save address"}
              </button>
            </form>
          )}
        </div>
      )}

      <div className={SOFT_CARD}>
        <h4 className={`${CARD_TITLE} mb-3`}>Order summary</h4>
        <div className="grid gap-1.5 text-sm">
          <Row label="Item price" value={formatPrice(item.priceEur)} />
          {item.isShop ? null : <Row label="🛡️ Buyer Protection" value={formatPrice(fee)} />}
          <Row label="Delivery" value={delivery > 0 ? formatPrice(delivery) : "Free"} />
        </div>
        <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-line">
          <span className="font-bold">Total</span>
          <span className="font-extrabold text-xl text-navy-900">{formatPrice(total)}</span>
        </div>
        {item.isShop ? null : (
          <p className="text-xs text-green-700 font-semibold mt-2">
            Your money is held by PinPals and only released to the seller once you have the item.
          </p>
        )}
      </div>

      <label className="flex items-start gap-2.5 text-sm text-ink-700">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
        <span>
          I understand Pinpals holds this item for a short payment window, and that Buyer Protection covers this
          purchase only when I pay and communicate through Pinpals.
        </span>
      </label>

      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`${GOLD_BUTTON} w-full`}
      >
        {pending ? "Reserving…" : `${submitLabel} · ${formatPrice(total)}`}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}
