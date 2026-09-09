import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { createClient } from "@/lib/supabase/server";
import { COUNTRIES, countryName, isCountryCode } from "@/lib/regions";
import type { Club } from "@/lib/types";
import ImportControls from "./import-controls";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The course directory, from the staff side.
 *
 * Its real job is not browsing — /courses does that better — but working the
 * gaps. The imported data is complete on names and positions and thin on
 * everything else, so the filters here are built around what's *missing*:
 * courses with no website, no county, no coordinates, and the seeded club
 * names that no OpenStreetMap record ever matched (`source = 'seed'`), which
 * are the ones most likely to be duplicates or closed clubs.
 */
export default async function AdminClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; country?: string; gap?: string; page?: string }>;
}) {
  const { staff } = await requireStaff();
  const { q = "", country = "", gap = "", page = "1" } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  const supabase = await createClient();

  let query = supabase
    .from("clubs")
    .select("id, slug, name, country, region, town, website, latitude, longitude, holes, source, verified_at, updated_at", {
      count: "exact",
    });

  if (isCountryCode(country)) query = query.eq("country", country);

  if (q.trim()) {
    const escaped = q.replace(/[%,()]/g, " ").trim();
    if (escaped) query = query.or(`name.ilike.%${escaped}%,town.ilike.%${escaped}%`);
  }

  if (gap === "no-website") query = query.is("website", null);
  if (gap === "no-region") query = query.is("region", null);
  if (gap === "no-coordinates") query = query.is("latitude", null);
  if (gap === "unmatched") query = query.eq("source", "seed");
  if (gap === "verified") query = query.not("verified_at", "is", null);

  const { data: clubs, count } = await query
    .order("name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1)
    .returns<(Club & { updated_at: string })[]>();

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Per-country totals and gap counts, so the state of the data is visible
  // before anyone filters anything.
  const summary = await Promise.all(
    COUNTRIES.map(async (c) => {
      const base = () => supabase.from("clubs").select("id", { count: "exact", head: true }).eq("country", c.code);
      const [{ count: all }, { count: noWebsite }, { count: noRegion }, { count: unmatched }] = await Promise.all([
        base(),
        base().is("website", null),
        base().is("region", null),
        base().eq("source", "seed"),
      ]);
      return {
        ...c,
        total: all ?? 0,
        noWebsite: noWebsite ?? 0,
        noRegion: noRegion ?? 0,
        unmatched: unmatched ?? 0,
      };
    })
  );

  const canImport = staff.role === "admin" || staff.role === "super_admin";

  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (country) params.set("country", country);
    if (gap) params.set("gap", gap);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    return query ? `/admin/clubs?${query}` : "/admin/clubs";
  };

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Courses</h1>
      <p className="text-sm text-ink-500 mb-6">
        {total.toLocaleString("en-IE")} {total === 1 ? "course" : "courses"} matching. Imported from
        OpenStreetMap — edit anything here and tick &ldquo;verified&rdquo; to stop future imports
        overwriting it.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {summary.map((c) => (
          <div key={c.code} className="bg-surface border border-line rounded-xl p-4">
            <p className="font-display font-bold text-lg">{c.name}</p>
            <p className="text-2xl font-bold text-green-800 mt-0.5">{c.total.toLocaleString("en-IE")}</p>
            <ul className="text-xs text-ink-500 mt-2 space-y-0.5">
              <li>{c.noWebsite.toLocaleString("en-IE")} without a website</li>
              <li>{c.noRegion.toLocaleString("en-IE")} without a county</li>
              {c.unmatched > 0 && (
                <li className="text-gold-600 font-semibold">
                  {c.unmatched.toLocaleString("en-IE")} unmatched seed names
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>

      {canImport && <ImportControls className="mb-6" />}

      <form className="flex flex-wrap gap-3 items-center bg-surface border border-line rounded-xl px-4 py-3 mb-5">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name or town…"
          className="flex-1 min-w-[200px] px-3.5 py-2 rounded-full border-[1.5px] border-line bg-surface-tint text-sm"
        />
        <select name="country" defaultValue={country} className="px-3.5 py-2 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
          <option value="">All countries</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <select name="gap" defaultValue={gap} className="px-3.5 py-2 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold">
          <option value="">Everything</option>
          <option value="no-website">Missing a website</option>
          <option value="no-region">Missing a county</option>
          <option value="no-coordinates">Missing coordinates</option>
          <option value="unmatched">Unmatched seed names</option>
          <option value="verified">Verified by staff</option>
        </select>
        <button type="submit" className="px-4 py-2 rounded-full text-sm font-bold bg-green-700 text-cream-50">
          Filter
        </button>
      </form>

      <div className="bg-surface border border-line rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cream-100 text-left">
            <tr>
              <th className="px-4 py-2.5 font-bold">Course</th>
              <th className="px-4 py-2.5 font-bold">Country</th>
              <th className="px-4 py-2.5 font-bold">County</th>
              <th className="px-4 py-2.5 font-bold">Website</th>
              <th className="px-4 py-2.5 font-bold">Source</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(clubs ?? []).map((club) => (
              <tr key={club.id} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <span className="font-semibold">{club.name}</span>
                  {club.town && <span className="text-ink-500"> · {club.town}</span>}
                </td>
                <td className="px-4 py-2.5">{countryName(club.country)}</td>
                <td className="px-4 py-2.5">
                  {club.region ?? <span className="text-gold-600">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {club.website ? (
                    <a
                      href={club.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-green-700 underline"
                    >
                      Link
                    </a>
                  ) : (
                    <span className="text-gold-600">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      club.verified_at
                        ? "bg-green-100 text-green-800"
                        : club.source === "seed"
                          ? "bg-gold-100 text-gold-600"
                          : "bg-cream-100 text-ink-500"
                    }`}
                  >
                    {club.verified_at ? "Verified" : club.source}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <Link href={`/admin/clubs/${club.id}`} className="text-green-700 font-bold">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <nav className="flex items-center justify-between mt-5" aria-label="Pagination">
          {pageNumber > 1 ? (
            <Link href={hrefFor(pageNumber - 1)} className="text-sm font-bold text-green-700">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-500">
            Page {pageNumber} of {pageCount}
          </span>
          {pageNumber < pageCount ? (
            <Link href={hrefFor(pageNumber + 1)} className="text-sm font-bold text-green-700">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
