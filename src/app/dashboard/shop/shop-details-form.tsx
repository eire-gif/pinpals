"use client";

import { useActionState } from "react";

import { GOLD_BUTTON, SOFT_CARD } from "@/components/marketplace/buy-styles";
import type { Store } from "@/lib/marketplace-growth";
import { updateShop, type ShopFormState } from "@/app/shops/actions";

const FIELD = "w-full rounded-xl border-[1.5px] border-line bg-surface px-4 py-3 text-ink-900 focus:border-navy-900 outline-none";
const LABEL = "block text-sm font-semibold text-ink-900 mb-1.5";

export default function ShopDetailsForm({ store }: { store: Store }) {
  const [state, action, pending] = useActionState<ShopFormState, FormData>(updateShop, {});
  return (
    <form action={action} className={`${SOFT_CARD} space-y-4`}>
      <input type="hidden" name="storeId" value={store.id} />
      <div>
        <label className={LABEL} htmlFor="description">About the shop</label>
        <textarea id="description" name="description" rows={4} maxLength={1000} defaultValue={store.description ?? ""} className={FIELD} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL} htmlFor="phone">Phone</label>
          <input id="phone" name="phone" maxLength={40} defaultValue={store.phone ?? ""} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" maxLength={200} defaultValue={store.email ?? ""} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="logoUrl">Logo image link (https://)</label>
          <input id="logoUrl" name="logoUrl" type="url" maxLength={500} defaultValue={store.logo_url ?? ""} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="coverUrl">Cover photo link (https://)</label>
          <input id="coverUrl" name="coverUrl" type="url" maxLength={500} defaultValue={store.cover_url ?? ""} className={FIELD} />
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold text-ink-900">
        <input type="checkbox" name="fittings" defaultChecked={store.offers_fittings} className="w-5 h-5 accent-navy-900" /> We offer custom fittings
      </label>
      {state.error ? <p className="text-sm font-semibold text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm font-semibold text-green-700">Saved.</p> : null}
      <button type="submit" disabled={pending} className={GOLD_BUTTON}>
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
