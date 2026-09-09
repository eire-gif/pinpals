import Link from "next/link";
import { notFound } from "next/navigation";
import { COUNTRIES, countryName, isCountryCode } from "@/lib/regions";
import { listCourses, listRegionsWithCourses, COURSES_PER_PAGE } from "@/lib/courses";
import CourseCard from "@/components/course-card";
import OsmAttribution from "@/components/osm-attribution";

export async function generateMetadata({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  if (!isCountryCode(country)) return {};
  return {
    title: `Golf clubs in ${countryName(country)} — Pinpals`,
    description: `Every golf club in ${countryName(country)}, with websites, locations and the Pinpals members who play there.`,
  };
}

/**
 * One country's courses.
 *
 * Everything here is filtered and paged in the database rather than in the
 * browser. England is ~1,900 clubs; the old client-side approach would have
 * shipped all of them as JSON on first paint to support a search box.
 *
 * The region filter renders only the regions that actually have courses
 * behind them (see listRegionsWithCourses) — region comes from OpenStreetMap
 * address tags and is missing on plenty of rows, so offering all 48 English
 * counties would mostly offer empty results.
 */
export default async function CountryCoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ country: string }>;
  searchParams: Promise<{ q?: string; region?: string; page?: string }>;
}) {
  const { country } = await params;
  if (!isCountryCode(country)) notFound();

  const { q = "", region = "", page = "1" } = await searchParams;
  const pageNumber = Number.parseInt(page, 10) || 1;

  const [{ courses, total, pageCount }, regions] = await Promise.all([
    listCourses({ country, q, region, page: pageNumber }),
    listRegionsWithCourses(country),
  ]);

  const name = countryName(country);
  const filtered = Boolean(q || region);

  // Preserved across pagination links so "next page" doesn't silently drop
  // the search someone just typed.
  const queryFor = (next: number) => {
    const searchParams = new URLSearchParams();
    if (q) searchParams.set("q", q);
    if (region) searchParams.set("region", region);
    if (next > 1) searchParams.set("page", String(next));
    const query = searchParams.toString();
    return query ? `/courses/${country}?${query}` : `/courses/${country}`;
  };

  return (
    <div>
      <div className="bg-navy-900 text-white pt-12 pb-12">
        <div className="max-w-6xl mx-auto px-6">
          <Link
            href="/courses"
            className="inline-flex items-center gap-1.5 text-xs font-bold tracking-widest uppercase text-gold-500 hover:text-gold-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All countries
          </Link>
          <h1 className="font-display font-bold text-4xl md:text-5xl mt-2.5">{name}</h1>
          <p className="text-white/80 mt-3">
            {total.toLocaleString("en-IE")} {total === 1 ? "club" : "clubs"}
            {filtered ? " matching your search" : ""}.
          </p>

          <nav className="flex flex-wrap gap-2 mt-6" aria-label="Other countries">
            {COUNTRIES.filter((c) => c.code !== country).map((c) => (
              <Link
                key={c.code}
                href={`/courses/${c.code}`}
                className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition"
              >
                {c.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* A plain GET form: the results are server-rendered, so the URL is
            the state. That makes a filtered directory something you can
            bookmark, share and go Back out of. */}
        <form className="flex flex-wrap gap-3.5 items-center bg-surface border border-line rounded-2xl px-5 py-4 shadow-sm mb-8">
          <div className="relative flex-1 min-w-[220px]">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={`Search clubs and towns in ${name}…`}
              aria-label={`Search clubs in ${name}`}
              className="w-full pl-10 pr-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm"
            />
          </div>

          {regions.length > 0 && (
            <select
              name="region"
              defaultValue={region}
              aria-label="County or region"
              className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold"
            >
              <option value="">All counties</option>
              {regions.map((r) => (
                <option key={r.region} value={r.region}>
                  {r.region} ({r.count})
                </option>
              ))}
            </select>
          )}

          <button
            type="submit"
            className="px-5 py-2.5 rounded-full text-sm font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
          >
            Search
          </button>

          {filtered && (
            <Link href={`/courses/${country}`} className="text-sm font-semibold text-ink-500 hover:text-ink-900">
              Clear
            </Link>
          )}
        </form>

        {courses.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-display font-bold text-2xl mb-2">No clubs match that.</p>
            <p className="text-ink-500">
              Try a shorter search, or{" "}
              <Link href={`/courses/${country}`} className="text-green-700 font-semibold">
                browse all {name} clubs
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {courses.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>

            {pageCount > 1 && (
              <nav className="flex items-center justify-between gap-4 mt-10" aria-label="Pagination">
                {pageNumber > 1 ? (
                  <Link
                    href={queryFor(pageNumber - 1)}
                    className="px-5 py-2.5 rounded-full text-sm font-bold border-[1.5px] border-line bg-surface hover:border-green-600"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}

                <p className="text-sm text-ink-500">
                  Page {pageNumber} of {pageCount} · showing{" "}
                  {((pageNumber - 1) * COURSES_PER_PAGE + 1).toLocaleString("en-IE")}–
                  {Math.min(pageNumber * COURSES_PER_PAGE, total).toLocaleString("en-IE")} of{" "}
                  {total.toLocaleString("en-IE")}
                </p>

                {pageNumber < pageCount ? (
                  <Link
                    href={queryFor(pageNumber + 1)}
                    className="px-5 py-2.5 rounded-full text-sm font-bold border-[1.5px] border-line bg-surface hover:border-green-600"
                  >
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}

        <OsmAttribution className="mt-10" />
      </div>
    </div>
  );
}
