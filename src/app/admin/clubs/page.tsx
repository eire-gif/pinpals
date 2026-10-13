import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { COUNTRIES, countryName, isCountryCode } from "@/lib/regions";
import type { Club } from "@/lib/types";
import ImportControls from "./import-controls";
import AdminPageHeader from "@/components/admin/page-header";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { BulkProvider, BulkBar, SelectAll, SelectRow } from "@/components/admin/controls/bulk";
import { ShowHiddenToggle, PrimaryLink, Pill } from "@/components/admin/table";
import { bulkBarProps, canEdit, rowActionProps } from "@/lib/admin/controls";

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
  searchParams: Promise<{ q?: string; country?: string; gap?: string; page?: string; hidden?: string }>;
}) {
  const { staff } = await requireStaff();
  const { q = "", country = "", gap = "", page = "1", hidden = "" } = await searchParams;
  const showHidden = hidden === "1";
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  // Service role, like every other admin read: staff must see hidden
  // courses (0140) to add them back.
  const supabase = createAdminClient();

  let query = supabase
    .from("clubs")
    .select("id, slug, name, country, region, town, website, latitude, longitude, holes, source, verified_at, updated_at, hidden_at", {
      count: "exact",
    });

  if (!showHidden) query = query.is("hidden_at", null);

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
    .returns<(Club & { updated_at: string; hidden_at: string | null })[]>();

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
    if (showHidden) params.set("hidden", "1");
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    return query ? `/admin/clubs?${query}` : "/admin/clubs";
  };

  return (
    <div>
      <AdminPageHeader
        title="Courses"
        description={`${total.toLocaleString("en-IE")} ${total === 1 ? "course" : "courses"} matching. Tick “verified” on a course to stop imports overwriting it.`}
        actions={canEdit(staff, "club") && <PrimaryLink href="/admin/clubs/new">Add course</PrimaryLink>}
      />

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
        <ShowHiddenToggle checked={showHidden} />
        <button type="submit" className="px-4 py-2 rounded-full text-sm font-bold bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
          Filter
        </button>
      </form>

      <BulkProvider>
        <div className="bg-surface border border-line rounded-2xl overflow-x-auto shadow-sm">
          {(clubs ?? []).length === 0 ? (
            <div className="text-center py-16 text-ink-500">No courses match that search.</div>
          ) : (
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                  <th className="w-10 pl-4 pr-1 py-3">
                    <SelectAll ids={(clubs ?? []).map((c) => c.id)} />
                  </th>
                  <th className="px-4 py-3 font-semibold">Course</th>
                  <th className="px-4 py-3 font-semibold">Country</th>
                  <th className="px-4 py-3 font-semibold">County</th>
                  <th className="px-4 py-3 font-semibold">Website</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="w-12 px-2 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(clubs ?? []).map((club) => (
                  <tr key={club.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="w-10 pl-4 pr-1 py-3">
                      <SelectRow id={club.id} label={`Select ${club.name}`} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/clubs/${club.id}`} className="font-semibold text-ink-900 hover:underline">
                        {club.name}
                      </Link>
                      {club.town && <span className="text-ink-500"> · {club.town}</span>}
                      {club.hidden_at && (
                        <span className="ml-2">
                          <Pill tone="bad">Hidden</Pill>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{countryName(club.country)}</td>
                    <td className="px-4 py-3">{club.region ?? <span className="text-gold-600">—</span>}</td>
                    <td className="px-4 py-3">
                      {club.website ? (
                        <a href={club.website} target="_blank" rel="noopener noreferrer nofollow" className="text-green-700 underline">
                          Link
                        </a>
                      ) : (
                        <span className="text-gold-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={club.verified_at ? "good" : club.source === "seed" ? "warn" : "neutral"}>
                        {club.verified_at ? "Verified" : club.source}
                      </Pill>
                    </td>
                    <td className="w-12 px-2 py-3 text-right">
                      <AdminRowActions {...rowActionProps(staff, "club", club.id, { hidden: !!club.hidden_at }, club.name)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <BulkBar {...bulkBarProps(staff, "club")} />
      </BulkProvider>

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
