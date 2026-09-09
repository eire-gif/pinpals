"use client";

import { useActionState, useState } from "react";
import ClubCombobox from "@/components/club-combobox";
import { COUNTRIES, regionsForCountry } from "@/lib/regions";
import {
  DEFAULT_VISIBILITY,
  SPACES_OPTIONS,
  VISIBILITY_DESCRIPTIONS,
  VISIBILITY_LABELS,
  VISIBILITY_OPTIONS,
} from "@/lib/tee-times";
import { postAvailability, type PostAvailabilityState } from "./actions";

const initialState: PostAvailabilityState = {};

export default function NewAvailabilityForm() {
  const [state, formAction, pending] = useActionState(postAvailability, initialState);
  const [hasTeeTime, setHasTeeTime] = useState(false);
  const [visibility, setVisibility] = useState<string>(DEFAULT_VISIBILITY);
  // Same country-then-club flow as the profile form, for the same reason:
  // the club list is ~3,000 courses across five countries and is only
  // skimmable once a country has narrowed it. Defaults to Ireland, where
  // almost every tee time posted so far has been.
  const [country, setCountry] = useState("ireland");
  const regions = regionsForCountry(country);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="country" className="text-[13.5px] font-bold">Country</label>
        <select
          id="country"
          name="country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="club" className="text-[13.5px] font-bold">Golf course / club</label>
        <ClubCombobox name="club" country={country} required />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="county" className="text-[13.5px] font-bold">County</label>
        <select key={country} id="county" name="county" defaultValue="" required
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface">
          <option value="" disabled>Select the county the course is in</option>
          {regions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="text-xs text-ink-500">Lets other members filter tee-time invites by county.</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5 min-w-0">
          <label htmlFor="playDate" className="text-[13.5px] font-bold">Date</label>
          <input id="playDate" name="playDate" type="date" required min={today}
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
        <div className="grid gap-1.5 min-w-0">
          <label htmlFor="spaces" className="text-[13.5px] font-bold">Spaces available</label>
          <select id="spaces" name="spaces" defaultValue="1" required
            className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface">
            {SPACES_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} {n === 1 ? "space" : "spaces"}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5 min-w-0">
          <label htmlFor="timeFrom" className="text-[13.5px] font-bold">
            Preferred time range <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <div className="flex items-center gap-2 min-w-0">
            <input id="timeFrom" name="timeFrom" type="time"
              className="min-w-0 flex-1 px-3 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
            <span className="shrink-0 text-ink-500 text-sm">to</span>
            <input id="timeTo" name="timeTo" type="time"
              className="min-w-0 flex-1 px-3 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
          </div>
        </div>
        <div className="grid gap-1.5 min-w-0">
          <label htmlFor="handicapLimit" className="text-[13.5px] font-bold">
            Handicap preference <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <input id="handicapLimit" name="handicapLimit" type="number" step="1" min="0" max="54"
            placeholder="e.g. 24"
            className="w-full min-w-0 px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
          <span className="text-xs text-ink-500">Leave blank if any handicap is welcome.</span>
        </div>
      </div>

      <div className="bg-surface-tint border border-line rounded-xl px-4 py-3.5">
        <label className="flex items-center gap-2.5 text-sm font-semibold">
          <input
            type="checkbox"
            name="hasTeeTime"
            checked={hasTeeTime}
            onChange={(e) => setHasTeeTime(e.target.checked)}
            className="w-4 h-4 accent-green-700"
          />
          I already have a tee time booked
        </label>
        {hasTeeTime && (
          <div className="grid gap-1.5 mt-3">
            <label htmlFor="exactTeeTime" className="text-[13.5px] font-bold">
              Exact tee time <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <input id="exactTeeTime" name="exactTeeTime" type="time"
              className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface" />
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="notes" className="text-[13.5px] font-bold">
          Message / notes <span className="font-normal text-ink-500">(optional)</span>
        </label>
        <textarea id="notes" name="notes" rows={3}
          placeholder="e.g. Looking for another Pinpals member to join me — happy to play any pace."
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 resize-y" />
      </div>

      {/* Last field before the button, deliberately: it is the one decision
          here that can't be undone by editing the post afterwards — once a
          round has gone out to everyone, it has been seen. Radios rather
          than a select so both answers and their consequences are readable
          without opening anything. */}
      <fieldset className="bg-surface-tint border border-line rounded-xl px-4 py-3.5">
        <legend className="text-[13.5px] font-bold px-1">Who can see this tee time?</legend>
        <div className="grid gap-2 mt-1">
          {VISIBILITY_OPTIONS.map((option) => (
            <label
              key={option}
              className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer border-[1.5px] transition ${
                visibility === option ? "border-green-600 bg-surface" : "border-transparent"
              }`}
            >
              <input
                type="radio"
                name="visibility"
                value={option}
                checked={visibility === option}
                onChange={(e) => setVisibility(e.target.value)}
                className="w-4 h-4 mt-0.5 accent-green-700 shrink-0"
              />
              <span>
                <span className="block text-sm font-semibold">{VISIBILITY_LABELS[option]}</span>
                <span className="block text-[13px] text-ink-500 mt-0.5">
                  {VISIBILITY_DESCRIPTIONS[option]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Posting…" : "Post availability"}
      </button>
    </form>
  );
}
