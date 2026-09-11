"use client";

import { useActionState, useState } from "react";
import ClubCombobox from "@/components/club-combobox";
import { COUNTRIES, regionsForCountry } from "@/lib/regions";
import type { ModerationState } from "@/lib/admin/moderation";

const initialState: ModerationState = {};

/**
 * The super-admin editor for a member's own profile details.
 *
 * A separate component from ModerationForm rather than another prop on it:
 * that one is a reason box and a button, shared by eight actions that all
 * change a status. This is nine fields, two of which depend on a third
 * (country scopes both the club picker and the county list), so it needs
 * client state that ModerationForm has no business carrying.
 *
 * It reuses the member's own ClubCombobox unchanged — same endpoint, same
 * "country first, then club" flow, same two hidden fields — so a staff edit
 * and a member edit can never pick from different club lists.
 *
 * The reason box sits at the bottom and is required, exactly as it is on
 * every other admin mutation: this one writes a `user.profile_edited` row
 * carrying a before/after for each field that moved.
 */
export default function MemberProfileForm({
  action,
  userId,
  defaultValues,
}: {
  action: (state: ModerationState, formData: FormData) => Promise<ModerationState>;
  userId: string;
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
  };
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Country is the field the other two hang off, same as the member's own
  // form. A member who has never set one starts on Ireland rather than on an
  // empty select, because an empty country disables the club picker and the
  // county list with no explanation.
  const [country, setCountry] = useState(defaultValues.country || "ireland");
  const regions = regionsForCountry(country);

  return (
    <form action={formAction} className="p-5 grid gap-4">
      <input type="hidden" name="userId" value={userId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="admin-first">
          <input
            id="admin-first"
            name="first"
            required
            defaultValue={defaultValues.first}
            className={INPUT}
          />
        </Field>
        <Field label="Last name" htmlFor="admin-last">
          <input id="admin-last" name="last" required defaultValue={defaultValues.last} className={INPUT} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor="admin-country">
          <select
            id="admin-country"
            name="country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className={INPUT}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="County / area" htmlFor="admin-county">
          {/* Keyed on country so React rebuilds the list when the country
              changes — otherwise "Kerry" would survive a switch to Scotland
              as a stale selection the server then has to reject. */}
          <select
            key={country}
            id="admin-county"
            name="county"
            defaultValue={regions.includes(defaultValues.county) ? defaultValues.county : ""}
            className={INPUT}
          >
            <option value="">Not set</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Not a <Field>: ClubCombobox renders its own input and takes no id,
          so a `for` attribute here would point at nothing. A wrapping label
          associates the text with the control it contains instead. */}
      <label className="grid gap-1.5 min-w-0">
        <span className="text-[13px] font-bold">Home club</span>
        <ClubCombobox
          name="club"
          country={country}
          defaultClubId={defaultValues.clubId}
          defaultValue={defaultValues.club}
        />
        <span className="text-xs text-ink-500">
          Leave empty to clear this member&rsquo;s home club. Only clubs in the country above are offered.
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Handicap index" htmlFor="admin-handicap">
          <input
            id="admin-handicap"
            name="handicap"
            type="number"
            step="0.1"
            min="-10"
            max="54"
            defaultValue={defaultValues.handicap}
            placeholder="Not set"
            className={INPUT}
          />
          <label className="flex items-center gap-2 text-xs text-ink-500 font-semibold mt-2">
            <input
              type="checkbox"
              name="handicapVisible"
              defaultChecked={defaultValues.handicapVisible}
              className="w-3.5 h-3.5 accent-green-700"
            />
            Show their handicap to other golfers
          </label>
          <p className="text-xs text-ink-500 mt-1">
            {/* Said out loud because it is the member's own privacy choice,
                not an admin setting — changing it is recorded in the audit
                log like everything else here. */}
            This is the member&rsquo;s own privacy setting.
          </p>
        </Field>
        <Field label="GUI / Golf Ireland number" htmlFor="admin-gui">
          <input
            id="admin-gui"
            name="guiNumber"
            defaultValue={defaultValues.guiNumber}
            placeholder="Not set"
            className={INPUT}
          />
        </Field>
      </div>

      <Field label="Bio" htmlFor="admin-bio">
        <textarea
          id="admin-bio"
          name="bio"
          rows={3}
          defaultValue={defaultValues.bio}
          placeholder="Not set"
          className={`${INPUT} resize-y`}
        />
      </Field>

      <div className="border-t border-line pt-4">
        <Field label="Reason for this edit" htmlFor="admin-reason">
          <textarea
            id="admin-reason"
            name="reason"
            required
            rows={2}
            placeholder="e.g. Member rang in — club was set to the wrong Woodbrook"
            className={`${INPUT} resize-none`}
          />
        </Field>

        {state.error && (
          <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2 mt-3">{state.error}</p>
        )}
        {state.success && (
          <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2 mt-3">
            Saved — the member&rsquo;s profile has been updated.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-3 px-4 py-2 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save member details"}
        </button>
      </div>
    </form>
  );
}

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm focus:outline-none focus:border-green-600";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 min-w-0">
      <label htmlFor={htmlFor} className="text-[13px] font-bold">
        {label}
      </label>
      {children}
    </div>
  );
}
