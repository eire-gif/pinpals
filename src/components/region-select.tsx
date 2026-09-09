import { REGION_GROUPS } from "@/lib/regions";

/**
 * One county/region select covering all five countries, grouped by country.
 *
 * Used wherever a location field has to stay a single control — the
 * marketplace filter bar, a listing form, the tee-time browse filters — and
 * can't afford a country dropdown next to it. The `<optgroup>` headings do
 * the work a second control otherwise would: a seller in Surrey scrolls to
 * "England" and finds it, and an Irish seller's list is unchanged at the top.
 *
 * The country is never asked for, because it never has to be: region names
 * are unique across the five lists, so countryForRegion() recovers it
 * server-side from whatever was chosen.
 */
export default function RegionSelect({
  name,
  defaultValue = "",
  id,
  required = false,
  className = "",
  placeholder = "All counties",
  ariaLabel,
}: {
  name: string;
  defaultValue?: string;
  id?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      required={required}
      aria-label={ariaLabel}
      className={className}
    >
      <option value="">{placeholder}</option>
      {REGION_GROUPS.map((group) => (
        <optgroup key={group.country} label={group.label}>
          {group.regions.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
