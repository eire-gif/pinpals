"use client";

import { useState } from "react";

import ClubCombobox from "@/components/club-combobox";
import { inputClass } from "@/components/society-console/forms";
import { COUNTRIES } from "@/lib/regions";

/** Country, then club — the site's own home-club picker. Submits `club` (the id; blank clears it). */
export default function HomeClubPicker({ clubId, clubName, country: initialCountry }: { clubId: number | null; clubName: string | null; country: string | null }) {
  const [country, setCountry] = useState(initialCountry ?? "ireland");
  return (
    <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
      <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country" className={inputClass}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      <ClubCombobox key={country} name="club" country={country} defaultClubId={country === initialCountry ? clubId : null} defaultValue={country === initialCountry ? (clubName ?? "") : ""} />
    </div>
  );
}
