"use client";

import { useActionState } from "react";

import ClubCombobox from "@/components/club-combobox";
import { GOLD_BUTTON, SOFT_CARD } from "@/components/marketplace/buy-styles";
import { applyForShop, type ShopFormState } from "../actions";

const FIELD = "w-full rounded-xl border-[1.5px] border-line bg-surface px-4 py-3 text-ink-900 focus:border-navy-900 outline-none";
const LABEL = "block text-sm font-semibold text-ink-900 mb-1.5";

export default function ApplyForm({ country }: { country: string }) {
  const [state, action, pending] = useActionState<ShopFormState, FormData>(applyForShop, {});
  return (
    <form action={action} className={`${SOFT_CARD} space-y-5`}>
      <div>
        <label className={LABEL} htmlFor="name">Shop name</label>
        <input id="name" name="name" required maxLength={80} className={FIELD} placeholder="e.g. The Island Golf Club Pro Shop" />
      </div>
      <div>
        <span className={LABEL}>Club</span>
        <ClubCombobox name="club" country={country} required />
      </div>
      <div>
        <label className={LABEL} htmlFor="description">About the shop</label>
        <textarea id="description" name="description" rows={4} maxLength={1000} className={FIELD} placeholder="Brands you stock, opening hours, the PGA pro who runs it…" />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL} htmlFor="phone">Phone</label>
          <input id="phone" name="phone" maxLength={40} className={FIELD} autoComplete="tel" />
        </div>
        <div>
          <label className={LABEL} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" maxLength={200} className={FIELD} autoComplete="email" />
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold text-ink-900">
        <input type="checkbox" name="fittings" className="w-5 h-5 accent-navy-900" /> We offer custom fittings
      </label>
      <label className="flex items-start gap-3 text-sm text-ink-900">
        <input type="checkbox" name="agree" required className="w-5 h-5 mt-0.5 accent-navy-900" />
        <span>
          I run or manage this pro shop. I agree to the PinPals Terms and Marketplace Rules, to sell only new and genuine
          stock, and to PinPals&rsquo; 8% commission on each sale, taken before payout.
        </span>
      </label>
      {state.error ? <p className="text-sm font-semibold text-red-600">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
        {pending ? "Sending…" : "Apply to sell on PinPals"}
      </button>
      <p className="text-xs text-ink-500 text-center">
        We check every shop before it goes live — usually within two working days.
      </p>
    </form>
  );
}
