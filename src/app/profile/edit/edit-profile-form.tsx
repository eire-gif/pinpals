"use client";

import { useActionState, useState } from "react";
import ClubCombobox from "@/components/club-combobox";
import { COUNTRIES, regionsForCountry } from "@/lib/regions";
import MemberAvatar from "@/components/member-avatar";
import { ALLOWED_AVATAR_TYPES } from "@/lib/avatar";
import { ageBandForDate, AGE_BAND_NOT_SHARED } from "@/lib/age";
import { updateProfile, type ProfileFormState } from "./actions";

const initialState: ProfileFormState = {};

export default function EditProfileForm({
  defaultValues,
}: {
  defaultValues: {
    first: string;
    last: string;
    club: string;
    clubId: number | null;
    country: string;
    county: string;
    handicap: string;
    handicapVisible: boolean;
    bio: string;
    guiNumber: string;
    avatarUrl: string | null;
    dob: string;
    ageRangeVisible: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState);

  const todayIso = new Date().toISOString().slice(0, 10);
  // Local state purely so the band preview below updates as they type — the
  // value that matters is still the input's own, read from FormData on
  // submit.
  const [dob, setDob] = useState(defaultValues.dob);
  const previewBand = ageBandForDate(dob);

  // Country is the field the other two hang off: it scopes which clubs the
  // picker offers and which counties the select lists. Holding it in state
  // rather than reading it on submit is what lets both react as soon as it
  // changes, instead of after a round trip.
  const [country, setCountry] = useState(defaultValues.country);
  const regions = regionsForCountry(country);

  return (
    <form action={formAction} className="grid gap-4">
      {/* Photo first: it's the one field with a visible before/after, and
          burying it under the text inputs made it easy to miss entirely. */}
      <div className="grid gap-1.5">
        <span className="text-[13.5px] font-bold">Profile photo</span>
        <div className="flex items-center gap-4">
          <MemberAvatar
            name={`${defaultValues.first} ${defaultValues.last}`}
            avatarUrl={defaultValues.avatarUrl}
            size="xl"
          />
          <div className="grid gap-1.5 min-w-0">
            <input
              type="file"
              name="avatar"
              accept={ALLOWED_AVATAR_TYPES.join(",")}
              className="text-sm file:mr-3 file:px-3.5 file:py-2 file:rounded-full file:border-[1.5px] file:border-line file:bg-surface file:text-sm file:font-bold file:text-ink-900 hover:file:bg-cream-100"
            />
            <p className="text-xs text-ink-500">JPEG, PNG or WebP, up to 2MB. Leave empty to keep your current photo.</p>
            {defaultValues.avatarUrl && (
              <label className="flex items-center gap-2 text-xs text-ink-500 font-semibold">
                <input type="checkbox" name="removeAvatar" className="w-3.5 h-3.5 accent-green-700" />
                Remove my photo and go back to my initials
              </label>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="first" className="text-[13.5px] font-bold">First name</label>
          <input id="first" name="first" required defaultValue={defaultValues.first}
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="last" className="text-[13.5px] font-bold">Last name</label>
          <input id="last" name="last" required defaultValue={defaultValues.last}
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
      </div>

      {/* Country first, then club. With ~3,000 clubs across five countries a
          single searchable list offers two "Woodbrook"s and no way to tell
          them apart; narrowing by country first is what makes the picker
          usable and what makes the saved club unambiguous. */}
      <div className="grid gap-1.5">
        <label htmlFor="country" className="text-[13.5px] font-bold">Country you play in</label>
        <select
          id="country"
          name="country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface text-[15px] focus:outline-none focus:border-green-600"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <span className="text-xs text-ink-500">
          Shown on your profile so golfers searching another country can tell you apart.
        </span>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="club" className="text-[13.5px] font-bold">Home golf club</label>
        <ClubCombobox
          name="club"
          country={country}
          defaultClubId={defaultValues.clubId}
          defaultValue={defaultValues.club}
        />
        <span className="text-xs text-ink-500">
          Can&rsquo;t find it?{" "}
          <a href={`/courses/${country}`} className="text-green-700 font-semibold">
            Browse every club there
          </a>{" "}
          — you can set your home club from a club&rsquo;s own page too.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="handicap" className="text-[13.5px] font-bold">Handicap index</label>
          <input id="handicap" name="handicap" type="number" step="0.1" min="-10" max="54"
            defaultValue={defaultValues.handicap} placeholder="e.g. 14.2"
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
          <label className="flex items-center gap-2 text-xs text-ink-500 font-semibold mt-0.5">
            <input
              type="checkbox"
              name="handicapVisible"
              defaultChecked={defaultValues.handicapVisible}
              className="w-3.5 h-3.5 accent-green-700"
            />
            Show my handicap on my tee-time invites
          </label>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="dob" className="text-[13.5px] font-bold">Date of birth</label>
          <input
            id="dob"
            name="dob"
            type="date"
            max={todayIso}
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600"
          />
          <p className="text-xs text-ink-500">
            {/* Says plainly what is and isn't published — the whole reason
                the date lives in its own private table. */}
            Never shown to anyone. Other golfers only ever see an age range
            {previewBand ? <>, and yours would show as <strong className="text-ink-900">{previewBand}</strong></> : null}.
          </p>
          <label className="flex items-center gap-2 text-xs text-ink-500 font-semibold mt-0.5">
            <input
              type="checkbox"
              name="ageRangeVisible"
              defaultChecked={defaultValues.ageRangeVisible}
              className="w-3.5 h-3.5 accent-green-700"
            />
            Show my age range on my profile
          </label>
          {!defaultValues.ageRangeVisible && (
            <p className="text-xs text-ink-500">
              Currently shows as &ldquo;{AGE_BAND_NOT_SHARED}&rdquo; to other golfers.
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="county" className="text-[13.5px] font-bold">
            {country === "scotland"
              ? "Council area you play in most"
              : country === "wales"
                ? "Area you play in most"
                : "County you play in most"}
          </label>
          {/* Keyed on country so React rebuilds the select when the country
              changes — otherwise a defaultValue of "Kerry" would survive a
              switch to Scotland as a stale selection in a list that no longer
              contains it. */}
          <select
            key={country}
            id="county"
            name="county"
            defaultValue={regions.includes(defaultValues.county) ? defaultValues.county : ""}
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface"
          >
            <option value="">
              {country === "scotland" ? "Select a council area" : "Select a county"}
            </option>
            {regions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="bio" className="text-[13.5px] font-bold">A line about yourself</label>
        <textarea id="bio" name="bio" rows={3} defaultValue={defaultValues.bio}
          placeholder="e.g. Weekend golfer, happy to play any course within an hour of Dublin."
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 resize-y" />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="guiNumber" className="text-[13.5px] font-bold">
          GUI / Golf Ireland membership number <span className="font-normal text-ink-500">(optional)</span>
        </label>
        <input id="guiNumber" name="guiNumber" defaultValue={defaultValues.guiNumber}
          placeholder="e.g. 1234567"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        <span className="text-xs text-ink-500">
          Only if you have one — it&rsquo;s never required to join or use Pinpals.
        </span>
      </div>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
