"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS, roundCoord } from "@/lib/geo";

/**
 * "Tee times near me" — asks the browser for the member's position and
 * re-runs the search around it.
 *
 * A client component because geolocation only exists in the browser, and it
 * is deliberately the *only* client code in this feature: the position goes
 * straight into the URL and everything downstream (the query, the distances,
 * the sort) happens on the server like the rest of the page.
 *
 * The position is rounded to ~1 km before it goes anywhere — see the long
 * note in src/lib/geo.ts on why. Nothing is stored: the coordinate lives in
 * one URL and is gone when the member navigates away. The browser remembers
 * that they granted permission; this app doesn't remember where they were.
 *
 * Every other filter in the bar is preserved when this runs, so "near me" is
 * a filter alongside county and date rather than a mode that replaces them.
 */
export default function NearbySearch({ activeRadiusKm }: { activeRadiusKm: number | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radius, setRadius] = useState(activeRadiusKm ?? DEFAULT_RADIUS_KM);

  function search(radiusKm: number) {
    if (!("geolocation" in navigator)) {
      setError("This browser can't share a location.");
      return;
    }

    setPending(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("lat", String(roundCoord(position.coords.latitude)));
        params.set("lng", String(roundCoord(position.coords.longitude)));
        params.set("radius", String(radiusKm));
        router.push(`/tee-times?${params.toString()}`);
        setPending(false);
      },
      (err) => {
        setPending(false);
        // Named separately because they need different things from the
        // member: turning the permission back on, versus just trying again.
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked for this site — you can turn it back on in your browser's settings."
            : "Couldn't get your location just now. Try again, or filter by county instead."
        );
      },
      // A stale fix from an hour ago is fine for a 30 km search and much
      // faster than waking the GPS chip; 10s stops it hanging indefinitely
      // indoors, where a precise fix may never arrive.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 3_600_000 }
    );
  }

  function clear() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lat");
    params.delete("lng");
    params.delete("radius");
    const query = params.toString();
    router.push(query ? `/tee-times?${query}` : "/tee-times");
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => search(radius)}
          disabled={pending}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border-[1.5px] border-green-700 text-green-700 font-bold text-sm hover:bg-green-100 transition disabled:opacity-60"
        >
          <PinIcon />
          {pending ? "Finding you…" : activeRadiusKm ? "Update my location" : "Tee times near me"}
        </button>

        <label className="text-sm text-ink-500">
          <span className="sr-only">Search radius</span>
          <select
            value={radius}
            onChange={(e) => {
              const next = Number(e.target.value);
              setRadius(next);
              // Re-runs immediately when a search is already active: changing
              // "within 30 km" to "within 50 km" and then having to press the
              // button again would be a step that does nothing but wait.
              if (activeRadiusKm) search(next);
            }}
            className="px-3 py-2 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold"
          >
            {RADIUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                Within {option} km
              </option>
            ))}
          </select>
        </label>

        {activeRadiusKm && (
          <button
            type="button"
            onClick={clear}
            className="text-sm font-semibold text-ink-500 hover:text-green-700 transition"
          >
            Clear location
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mt-2.5">{error}</p>}

      {!error && !activeRadiusKm && (
        <p className="text-xs text-ink-500 mt-2">
          Your browser will ask permission first. We round your position to about a kilometre
          and don&rsquo;t store it.
        </p>
      )}
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}
