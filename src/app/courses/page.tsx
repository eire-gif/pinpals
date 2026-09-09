import Image from "next/image";
import Link from "next/link";
import { COUNTRIES } from "@/lib/regions";
import { countCoursesByCountry } from "@/lib/courses";
import OsmAttribution from "@/components/osm-attribution";

export const metadata = {
  title: "Golf courses in Ireland and the UK — Pinpals",
  description:
    "Every golf club in Ireland, Northern Ireland, England, Scotland and Wales — with websites, locations and the Pinpals members who play there.",
};

/**
 * The Courses landing page.
 *
 * It used to be the directory itself: one alphabetical list of 373 Irish club
 * names, filtered in the browser. At ~3,000 clubs across five countries a
 * single list is no longer something anyone can use, so this page's job is
 * now to ask one question — which country — and get out of the way.
 */
export default async function CoursesPage() {
  const counts = await countCoursesByCountry();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div>
      <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
        <Image
          src="/images/courses-header.jpg"
          alt="Aerial view of a links golf course"
          fill
          className="object-cover -z-10 opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.92)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Course directory
          </span>
          <h1 className="font-display font-bold text-4xl md:text-5xl mt-2.5">
            {total.toLocaleString("en-IE")} clubs across Ireland and the UK.
          </h1>
          <p className="text-white/80 mt-3 max-w-[54ch]">
            Pick a country to browse its clubs — then set one as your home club and find the
            members who already play there.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {COUNTRIES.map((country) => (
            <Link
              key={country.code}
              href={`/courses/${country.code}`}
              className="group bg-surface border border-line rounded-2xl p-6 shadow-sm hover:shadow-lg hover:border-green-600 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display font-bold text-2xl group-hover:text-green-800 transition">
                  {country.name}
                </h2>
                <svg
                  className="w-5 h-5 text-ink-500 group-hover:text-green-700 shrink-0 mt-1.5 transition"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-ink-500 mt-1.5 text-[14.5px]">
                {counts[country.code].toLocaleString("en-IE")}{" "}
                {counts[country.code] === 1 ? "club" : "clubs"}
              </p>
            </Link>
          ))}
        </div>

        {/* Ireland and Northern Ireland are listed separately above, which is
            not how the sport is organised here — Golf Ireland covers all 32
            counties. Saying so plainly is cheaper than an argument in the
            inbox, and it doubles as the cross-link between the two pages. */}
        <p className="text-sm text-ink-500 mt-8 max-w-[70ch]">
          Northern Ireland is listed as its own country so the UK reads correctly by country.
          Golf Ireland governs the game across all 32 counties, so if you play on the island
          you may want{" "}
          <Link href="/courses/ireland" className="text-green-700 font-semibold">
            Ireland
          </Link>{" "}
          and{" "}
          <Link href="/courses/northern-ireland" className="text-green-700 font-semibold">
            Northern Ireland
          </Link>{" "}
          both.
        </p>

        <OsmAttribution className="mt-6" />
      </div>
    </div>
  );
}
