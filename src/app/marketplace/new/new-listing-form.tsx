"use client";

import { useActionState, useState } from "react";
import { COUNTIES } from "@/lib/clubs";
import { CATEGORIES, CONDITIONS } from "@/lib/marketplace";
import { createListing, type ListingFormState } from "./actions";

const initialState: ListingFormState = {};

export default function NewListingForm() {
  const [state, formAction, pending] = useActionState(createListing, initialState);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="title" className="text-[13.5px] font-bold">Title</label>
        <input id="title" name="title" required placeholder="e.g. TaylorMade Stealth 2 Driver, 10.5°"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="photo" className="text-[13.5px] font-bold">Photo</label>
        <input
          id="photo"
          name="photo"
          type="file"
          accept="image/png, image/jpeg, image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
          className="text-sm file:mr-3 file:px-4 file:py-2.5 file:rounded-full file:border-0 file:font-bold file:bg-green-700 file:text-cream-50 hover:file:bg-green-600"
        />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Preview" className="mt-2 h-40 w-40 object-cover rounded-lg border border-line" />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="category" className="text-[13.5px] font-bold">Category</label>
          <select id="category" name="category" required defaultValue=""
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface">
            <option value="" disabled>Select a category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="condition" className="text-[13.5px] font-bold">Condition</label>
          <select id="condition" name="condition" required defaultValue=""
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface">
            <option value="" disabled>Select a condition</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="price" className="text-[13.5px] font-bold">Price (EUR)</label>
          <input id="price" name="price" type="number" step="1" min="0" required placeholder="e.g. 220"
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="county" className="text-[13.5px] font-bold">County (for collection)</label>
          <select id="county" name="county" defaultValue=""
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface">
            <option value="">Select a county</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="description" className="text-[13.5px] font-bold">Description</label>
        <textarea id="description" name="description" rows={4}
          placeholder="Condition details, why you're selling, any extras included…"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 resize-y" />
      </div>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Publishing…" : "Publish listing"}
      </button>
    </form>
  );
}
