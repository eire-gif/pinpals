"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { COUNTRIES, regionsForCountry } from "@/lib/regions";
import { saveLocation, saveGame, type OnboardingState } from "./actions";

const initialState: OnboardingState = {};

const inputClass =
  "px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface focus:outline-none focus:border-green-600";

function FormError({ state }: { state: OnboardingState }) {
  if (!state.error) return null;
  return <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>;
}

export function LocationStep({
  initialCountry,
  initialCounty,
}: {
  initialCountry: string;
  initialCounty: string;
}) {
  const [state, formAction, pending] = useActionState(saveLocation, initialState);
  // Country drives the county list — a flat county dropdown would offer
  // "Down" and "Durham" side by side with no way to tell which is which.
  // See the note at the top of src/lib/regions.ts.
  const [country, setCountry] = useState(initialCountry || "ireland");

  const counties = regionsForCountry(country);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="country" className="text-[13.5px] font-bold">Where do you play?</label>
        <select
          id="country"
          name="country"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          className={inputClass}
        >
          {COUNTRIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="county" className="text-[13.5px] font-bold">
          County or area <span className="font-normal text-ink-500">— optional</span>
        </label>
        <select
          id="county"
          name="county"
          defaultValue={initialCounty}
          key={country}
          className={inputClass}
        >
          <option value="">Choose one</option>
          {counties.map((county) => (
            <option key={county} value={county}>
              {county}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-500">
          This is how other golfers near you will find you.
        </span>
      </div>

      <FormError state={state} />

      <div className="flex items-center gap-4 mt-1">
        <button
          type="submit"
          disabled={pending}
          className="px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : "Continue"}
        </button>
        <Link href="/onboarding?step=2" className="text-sm text-ink-500 hover:text-ink-900">
          Skip for now
        </Link>
      </div>
    </form>
  );
}

export function GameStep({
  initialHandicap,
  initialVisible,
}: {
  initialHandicap: string;
  initialVisible: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveGame, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="handicap" className="text-[13.5px] font-bold">
          Handicap index <span className="font-normal text-ink-500">— optional</span>
        </label>
        <input
          id="handicap"
          name="handicap"
          type="number"
          step="0.1"
          min="-10"
          max="54"
          defaultValue={initialHandicap}
          placeholder="e.g. 14.2"
          className={inputClass}
        />
        <span className="text-xs text-ink-500">
          Every standard is welcome here. An honest number is what makes a fourball work.
        </span>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="handicapVisible"
          defaultChecked={initialVisible}
          className="mt-0.5 w-4 h-4 accent-green-700 shrink-0"
        />
        <span className="text-sm leading-snug">
          Show my handicap on my profile.
          <span className="block text-xs text-ink-500 mt-0.5">
            Off by default. You can change this any time.
          </span>
        </span>
      </label>

      <FormError state={state} />

      <div className="flex items-center gap-4 mt-1">
        <button
          type="submit"
          disabled={pending}
          className="px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : "Continue"}
        </button>
        <Link href="/onboarding?step=3" className="text-sm text-ink-500 hover:text-ink-900">
          Skip for now
        </Link>
      </div>
    </form>
  );
}
