"use client";

import { useActionState } from "react";
import ClubCombobox from "@/components/club-combobox";
import { COUNTIES } from "@/lib/clubs";
import { updateProfile, type ProfileFormState } from "./actions";

const initialState: ProfileFormState = {};

export default function EditProfileForm({
  defaultValues,
}: {
  defaultValues: {
    first: string;
    last: string;
    club: string;
    county: string;
    handicap: string;
    handicapVisible: boolean;
    bio: string;
    guiNumber: string;
  };
}) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState);

  return (
    <form action={formAction} className="grid gap-4">
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

      <div className="grid gap-1.5">
        <label htmlFor="club" className="text-[13.5px] font-bold">Home golf club</label>
        <ClubCombobox name="club" defaultValue={defaultValues.club} required={false} />
        <span className="text-xs text-ink-500">Searchable list of 373 Irish clubs across all 32 counties.</span>
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
          <label htmlFor="county" className="text-[13.5px] font-bold">County you play in most</label>
          <select id="county" name="county" defaultValue={defaultValues.county}
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface">
            <option value="">Select a county</option>
            {COUNTIES.map((c) => (
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
