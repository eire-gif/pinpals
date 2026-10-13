"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, regionsForCountry } from "@/lib/regions";
import type { Club } from "@/lib/types";
import { createClub, updateClub, type ClubEditState, type ClubCreateState } from "../actions";

type FormState = ClubEditState & ClubCreateState;
const initialState: FormState = {};

/** A blank course, for "Add course". */
export const EMPTY_CLUB = {
  id: 0,
  name: "",
  country: "ireland",
  region: null,
  town: null,
  holes: null,
  website: null,
  latitude: null,
  longitude: null,
  verified_at: null,
} as unknown as Club;

const field =
  "px-3.5 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-[15px] focus:outline-none focus:border-green-600";

/** The course form. `mode="create"` (Add course) posts to createClub and
 * opens the new course when it's saved; otherwise it edits `club`. */
export default function EditClubForm({ club, mode = "edit" }: { club: Club; mode?: "edit" | "create" }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, fd: FormData): Promise<FormState> =>
      mode === "create" ? createClub(prev, fd) : updateClub(prev, fd),
    initialState
  );
  useEffect(() => {
    if (state.createdId) router.push(`/admin/clubs/${state.createdId}`);
  }, [state.createdId, router]);
  const [country, setCountry] = useState(club.country);
  const regions = regionsForCountry(country);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="id" value={club.id} />

      <div className="grid gap-1.5">
        <label htmlFor="name" className="text-[13.5px] font-bold">Course name</label>
        <input id="name" name="name" required defaultValue={club.name} className={field} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="country" className="text-[13.5px] font-bold">Country</label>
          <select
            id="country"
            name="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={field}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="region" className="text-[13.5px] font-bold">County / region</label>
          {/* Keyed on country so switching country rebuilds the select rather
              than leaving a county from the old country selected in a list
              that no longer offers it. */}
          <select
            key={country}
            id="region"
            name="region"
            defaultValue={club.region && regions.includes(club.region) ? club.region : ""}
            className={field}
          >
            <option value="">Not set</option>
            {regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="town" className="text-[13.5px] font-bold">Town</label>
          <input id="town" name="town" defaultValue={club.town ?? ""} className={field} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="holes" className="text-[13.5px] font-bold">Holes</label>
          <input
            id="holes"
            name="holes"
            type="number"
            min="1"
            max="200"
            defaultValue={club.holes ?? ""}
            className={field}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="website" className="text-[13.5px] font-bold">Website</label>
        <input
          id="website"
          name="website"
          defaultValue={club.website ?? ""}
          placeholder="lahinchgolf.com"
          className={field}
        />
        <span className="text-xs text-ink-500">
          The club&rsquo;s own site. Leave empty if it hasn&rsquo;t got one — a dead link is worse
          than no link.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="latitude" className="text-[13.5px] font-bold">Latitude</label>
          <input
            id="latitude"
            name="latitude"
            defaultValue={club.latitude ?? ""}
            placeholder="52.9331"
            className={field}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="longitude" className="text-[13.5px] font-bold">Longitude</label>
          <input
            id="longitude"
            name="longitude"
            defaultValue={club.longitude ?? ""}
            placeholder="-9.3450"
            className={field}
          />
        </div>
        <p className="sm:col-span-2 text-xs text-ink-500 -mt-2">
          Both or neither. These drive the &ldquo;Open in maps&rdquo; link on the course page; with
          no coordinates it falls back to searching the course&rsquo;s name.
        </p>
      </div>

      <label className="flex items-start gap-2.5 text-sm bg-cream-100 rounded-lg px-3.5 py-3">
        <input
          type="checkbox"
          name="verified"
          defaultChecked={Boolean(club.verified_at)}
          className="w-4 h-4 accent-green-700 mt-0.5"
        />
        <span>
          <span className="font-bold">Verified by staff</span>
          <span className="block text-xs text-ink-500 mt-0.5">
            Future OpenStreetMap imports will leave this course&rsquo;s website, county, town and
            coordinates alone. Only its country can still be corrected.
            {club.verified_at
              ? ` Currently verified on ${new Date(club.verified_at).toLocaleDateString("en-IE")}.`
              : ""}
          </span>
        </span>
      </label>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}
      {state.saved && (
        <p className="text-sm text-green-800 bg-green-100 rounded-lg px-3.5 py-2.5">Saved.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="justify-self-start px-6 py-2.5 rounded-full font-bold bg-navy-900 text-cream-50 hover:bg-navy-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : mode === "create" ? "Add course" : "Save course"}
      </button>
    </form>
  );
}
