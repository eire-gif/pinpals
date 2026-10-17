"use client";

import { useActionState } from "react";

import { CATEGORIES } from "@/lib/marketplace";
import { addBrandModel, removeBrandLogo, setBrandModelActive, uploadBrandLogo, type BrandActionState } from "./actions";

const initial: BrandActionState = {};

function Note({ state }: { state: BrandActionState }) {
  if (state.error) return <p className="text-xs font-semibold text-red-600" role="alert">{state.error}</p>;
  if (state.saved) return <p className="text-xs font-semibold text-green-700">{state.saved}</p>;
  return null;
}

export function LogoForm({ brandId, hasLogo }: { brandId: string; hasLogo: boolean }) {
  const [state, action, pending] = useActionState(uploadBrandLogo, initial);
  const [removeState, remove, removing] = useActionState(removeBrandLogo, initial);
  return (
    <div className="grid gap-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="brandId" value={brandId} />
        <input
          type="file"
          name="logo"
          accept="image/png,image/svg+xml,image/webp,image/jpeg"
          required
          className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-cream-100 file:px-3 file:py-1.5 file:font-semibold"
        />
        <button type="submit" disabled={pending} className="px-4 py-2 rounded-full bg-navy-900 text-cream-50 text-sm font-bold disabled:opacity-60">
          {pending ? "Uploading…" : hasLogo ? "Replace logo" : "Upload logo"}
        </button>
      </form>
      {hasLogo ? (
        <form action={remove}>
          <input type="hidden" name="brandId" value={brandId} />
          <button type="submit" disabled={removing} className="text-xs font-bold text-red-600">
            Remove logo
          </button>
        </form>
      ) : null}
      <Note state={state} />
      <Note state={removeState} />
      <p className="text-xs text-ink-500">
        Use the brand&rsquo;s official logo from its media or press kit. PNG or SVG with a transparent background works best; it&rsquo;s
        shown on white, up to 1 MB.
      </p>
    </div>
  );
}

export function AddModelForm({ brandId, category }: { brandId: string; category: string }) {
  const [state, action, pending] = useActionState(addBrandModel, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1.2fr_1.5fr_0.6fr] items-end">
      <input type="hidden" name="brandId" value={brandId} />
      <label className="grid gap-1 text-sm font-semibold">
        Category
        <select name="category" defaultValue={category} className="rounded-xl border border-line px-3 py-2 bg-surface">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Model
        <input name="family" required maxLength={60} placeholder="e.g. Qi4D" className="rounded-xl border border-line px-3 py-2" />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Year
        <input name="year" inputMode="numeric" maxLength={4} placeholder="2026" className="rounded-xl border border-line px-3 py-2" />
      </label>
      <label className="grid gap-1 text-sm font-semibold sm:col-span-3">
        Versions <span className="font-normal text-ink-500">(comma-separated)</span>
        <input name="versions" placeholder="Qi4D, Qi4D LS, Qi4D Max" className="rounded-xl border border-line px-3 py-2" />
      </label>
      <div className="sm:col-span-3 flex items-center gap-3">
        <button type="submit" disabled={pending} className="px-4 py-2 rounded-full bg-navy-900 text-cream-50 text-sm font-bold disabled:opacity-60">
          {pending ? "Adding…" : "Add model"}
        </button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function ModelToggle({ modelId, active }: { modelId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setBrandModelActive, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="modelId" value={modelId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button type="submit" disabled={pending} className="text-xs font-bold text-green-700 disabled:opacity-60">
        {active ? "Hide" : "Show"}
      </button>
      {state.error ? <span className="text-xs text-red-600">{state.error}</span> : null}
    </form>
  );
}
