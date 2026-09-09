import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { countryName, isCountryCode } from "@/lib/regions";
import {
  getCourseBySlug,
  listMembersAtCourse,
  countMembersAtCourse,
  listTeeTimesAtCourse,
  mapsUrlFor,
  locationLine,
} from "@/lib/courses";
import MemberAvatar from "@/components/member-avatar";
import OsmAttribution from "@/components/osm-attribution";
import SetHomeClubButton from "./set-home-club-button";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await getCourseBySlug(slug);
  if (!course) return {};

  const where = [course.town, course.region, countryName(course.country)].filter(Boolean).join(", ");
  return {
    title: `${course.name} — Pinpals`,
    description: `${course.name}${where ? `, ${where}` : ""}. Find the Pinpals members who play here and the tee times going.`,
  };
}

/**
 * A single course.
 *
 * Two jobs, in this order:
 *
 *   1. The reference facts — where it is, and how to reach it. This is what
 *      the page was asked for: a website link where one exists, and a
 *      location link that opens in maps.
 *   2. The Pinpals part — who plays here, what tee times are going, and a
 *      one-click way to make it your home club. Without this the page is a
 *      directory entry that a search engine already does better.
 */
export default async function CoursePage({
  params,
}: {
  params: Promise<{ country: string; slug: string }>;
}) {
  const { country, slug } = await params;
  const course = await getCourseBySlug(slug);

  if (!course) notFound();

  // The country lives in the URL for readability, but the slug is what
  // actually identifies the course. If they disagree — a bookmark from
  // before an import corrected a club's country, most likely a Northern
  // Ireland club that was provisionally filed under Ireland — redirect to
  // the canonical URL rather than 404ing on a link that used to work.
  if (course.country !== country) {
    redirect(`/courses/${course.country}/${course.slug}`);
  }
  if (!isCountryCode(course.country)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [memberCount, members, teeTimes] = await Promise.all([
    countMembersAtCourse(course.id),
    user ? listMembersAtCourse(course.id) : Promise.resolve([]),
    listTeeTimesAtCourse(course),
  ]);

  const where = locationLine(course);

  return (
    <div>
      <div className="bg-navy-900 text-white pt-10 pb-12">
        <div className="max-w-4xl mx-auto px-6">
          <Link
            href={`/courses/${course.country}`}
            className="inline-flex items-center gap-1.5 text-xs font-bold tracking-widest uppercase text-gold-500 hover:text-gold-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {countryName(course.country)}
          </Link>

          <h1 className="font-display font-bold text-4xl md:text-5xl mt-2.5">{course.name}</h1>

          <p className="text-white/80 mt-3">
            {where ? `${where}, ` : ""}
            {countryName(course.country)}
            {course.holes ? ` · ${course.holes} holes` : ""}
          </p>

          {/* The two links this page exists for. The maps link is always
              offered — with coordinates it points at the course itself, and
              without them it falls back to a name search, which is still
              more useful than nothing (see mapsUrlFor). The website link is
              only rendered when there is one: a dead "Visit website" button
              is worse than its absence. */}
          <div className="flex flex-wrap gap-3 mt-6">
            {course.website && (
              <a
                href={course.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
              >
                Visit club website
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}

            <a
              href={mapsUrlFor(course)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full font-bold bg-white/10 text-white hover:bg-white/20 transition"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" strokeLinejoin="round" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {course.latitude != null ? "Open in maps" : "Find on maps"}
            </a>

            {user && <SetHomeClubButton clubId={course.id} clubName={course.name} />}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 grid gap-10">
        <section>
          <h2 className="font-display font-bold text-2xl mb-4">
            {memberCount === 0
              ? "No Pinpals members here yet"
              : `${memberCount} ${memberCount === 1 ? "member plays" : "members play"} here`}
          </h2>

          {!user ? (
            <div className="bg-surface border border-line rounded-2xl p-8 text-center">
              <p className="text-ink-500 mb-5">
                Join Pinpals to see who plays at {course.name} and to set it as your home club.
              </p>
              <Link
                href="/signup"
                className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
              >
                Join Pinpals
              </Link>
            </div>
          ) : members.length === 0 ? (
            <p className="text-ink-500">
              Be the first — set {course.name} as your home club and members searching this club
              will find you.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Cards, not links: there is no per-member page on this site —
                  the directory at /community is where you act on a member
                  (connect, message), and inventing a dead link here would be
                  worse than showing who's here and pointing at the place
                  that can do something about it. */}
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 bg-surface border border-line rounded-xl p-3.5"
                >
                  <MemberAvatar
                    name={`${member.first_name} ${member.last_name}`}
                    avatarUrl={member.avatar_url}
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-[15px] truncate">
                      {member.first_name} {member.last_name}
                    </p>
                    <p className="text-[13px] text-ink-500">
                      {member.handicap_visible && member.handicap != null
                        ? `Handicap ${member.handicap}`
                        : "Handicap not shared"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {user && members.length > 0 && (
            <Link
              href={`/community?q=${encodeURIComponent(course.name)}`}
              className="inline-block mt-4 text-sm font-bold text-green-700 hover:text-green-800"
            >
              See all members at {course.name} →
            </Link>
          )}
        </section>

        <section>
          <h2 className="font-display font-bold text-2xl mb-4">Tee times here</h2>
          {teeTimes.length === 0 ? (
            <p className="text-ink-500">
              Nobody has posted a tee time at {course.name} yet.{" "}
              {user ? (
                <Link href="/dashboard/availability/new" className="text-green-700 font-semibold">
                  Post your availability →
                </Link>
              ) : null}
            </p>
          ) : (
            <div className="grid gap-3">
              {teeTimes.map((teeTime) => (
                <Link
                  key={teeTime.id}
                  href={`/tee-times#invite-${teeTime.id}`}
                  className="bg-surface border border-line rounded-xl p-4 hover:border-green-600 transition flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-semibold text-[15px]">
                      {new Date(teeTime.play_date).toLocaleDateString("en-IE", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </p>
                    <p className="text-[13px] text-ink-500">
                      {teeTime.exact_tee_time ?? `${teeTime.time_from ?? ""}–${teeTime.time_to ?? ""}`}
                    </p>
                  </div>
                  <span className="text-[13px] font-bold text-green-800 bg-green-100 rounded-full px-3 py-1 shrink-0">
                    {teeTime.spaces_available}{" "}
                    {teeTime.spaces_available === 1 ? "space" : "spaces"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <OsmAttribution />
      </div>
    </div>
  );
}
