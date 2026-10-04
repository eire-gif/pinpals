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
import { RatingLine, Stars } from "@/components/course-stars";
import {
  courseListCounts,
  listCourseReviews,
  myCourseState,
  REVIEW_TAG_LABELS,
  type ReviewTag,
} from "@/lib/course-reviews";
import { deleteReviewAction, toggleCourseListAction } from "./actions";
import { ReportReviewButton, ReviewForm } from "./review-form";

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

  const [memberCount, members, teeTimes, reviews, lists, mine] = await Promise.all([
    countMembersAtCourse(course.id),
    user ? listMembersAtCourse(course.id) : Promise.resolve([]),
    listTeeTimesAtCourse(course),
    // Reviews and the two lists are readable by signed-in members only (0093).
    // A signed-out visitor still gets the stars, from the summary on clubs.
    user ? listCourseReviews(supabase, course.id) : Promise.resolve([]),
    user ? courseListCounts(supabase, course.id) : Promise.resolve({ played: 0, bucket: 0 }),
    user ? myCourseState(supabase, user.id, course.id) : Promise.resolve({ played: false, bucket: false }),
  ]);
  const myReview = user ? reviews.find((r) => r.member_id === user.id) ?? null : null;
  const otherReviews = reviews.filter((r) => r !== myReview);

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
          <RatingLine avg={course.rating_avg} count={course.rating_count} size={16} className="text-white mt-2" />

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
          <h2 className="font-display font-bold text-2xl mb-4">Ratings &amp; reviews</h2>

          <div className="grid gap-6 md:grid-cols-[220px_1fr] items-start">
            {course.rating_count > 0 && course.rating_avg !== null ? (
              <div className="bg-surface border border-line rounded-2xl p-5 text-center md:text-left">
                <p className="font-display font-bold text-5xl leading-none">{Number(course.rating_avg).toFixed(1)}</p>
                <div className="mt-2">
                  <Stars value={Number(course.rating_avg)} size={18} />
                </div>
                <p className="text-sm text-ink-500 mt-1">
                  {course.rating_count} {course.rating_count === 1 ? "rating" : "ratings"}
                </p>
                <div className="grid gap-1.5 mt-4">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const c = course.rating_dist?.[n - 1] ?? 0;
                    const pct = course.rating_count ? Math.round((c / course.rating_count) * 100) : 0;
                    return (
                      <div key={n} className="flex items-center gap-2 text-xs text-ink-500">
                        <span className="w-2">{n}</span>
                        <span className="flex-1 h-2 rounded bg-cream-100 overflow-hidden">
                          <span className="block h-2 rounded" style={{ width: `${pct}%`, background: "#c99a2e" }} />
                        </span>
                        <span className="w-6 text-right">{c}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-surface border border-line rounded-2xl p-5 text-ink-500 text-sm">
                Nobody has rated {course.name} yet.{user ? " Played it? Be the first." : ""}
              </div>
            )}

            <div className="grid gap-4">
              {user ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <form action={toggleCourseListAction}>
                      <input type="hidden" name="clubId" value={course.id} />
                      <input type="hidden" name="kind" value="played" />
                      <input type="hidden" name="on" value={mine.played ? "0" : "1"} />
                      <button
                        type="submit"
                        className={`px-4 py-2.5 rounded-full text-sm font-bold border-[1.5px] transition ${
                          mine.played ? "bg-green-100 border-green-700 text-green-800" : "bg-surface border-line hover:border-green-600"
                        }`}
                      >
                        {mine.played ? "✓ Played it" : "I've played it"}
                      </button>
                    </form>
                    <form action={toggleCourseListAction}>
                      <input type="hidden" name="clubId" value={course.id} />
                      <input type="hidden" name="kind" value="bucket" />
                      <input type="hidden" name="on" value={mine.bucket ? "0" : "1"} />
                      <button
                        type="submit"
                        className={`px-4 py-2.5 rounded-full text-sm font-bold border-[1.5px] transition ${
                          mine.bucket ? "bg-red-100 border-red-600 text-red-600" : "bg-surface border-line hover:border-green-600"
                        }`}
                      >
                        {mine.bucket ? "♥ On my bucket list" : "♡ Bucket list"}
                      </button>
                    </form>
                  </div>
                  <p className="text-sm text-ink-500">
                    {lists.played} {lists.played === 1 ? "member has" : "members have"} played here ·{" "}
                    {lists.bucket} {lists.bucket === 1 ? "has" : "have"} it on their bucket list
                  </p>

                  <ReviewForm
                    clubId={course.id}
                    existing={
                      myReview
                        ? { rating: myReview.rating, body: myReview.body, tags: myReview.tags, played_month: myReview.played_month }
                        : null
                    }
                  />
                  {myReview && (
                    <form action={deleteReviewAction}>
                      <input type="hidden" name="clubId" value={course.id} />
                      <button type="submit" className="text-xs text-ink-500 hover:text-red-600 underline">
                        Delete my review
                      </button>
                    </form>
                  )}
                  {myReview?.hidden_at && (
                    <p className="text-sm bg-cream-100 rounded-xl px-4 py-3 text-ink-900">
                      Your review has been hidden by PinPals and isn&apos;t shown to other members.
                    </p>
                  )}
                </>
              ) : (
                <div className="bg-surface border border-line rounded-2xl p-6 text-center">
                  <p className="text-ink-500 mb-4">Join PinPals to read reviews of {course.name} and rate the courses you&apos;ve played.</p>
                  <Link href="/signup" className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition">
                    Join PinPals
                  </Link>
                </div>
              )}
            </div>
          </div>

          {otherReviews.length > 0 && (
            <ul className="grid gap-3 mt-6">
              {otherReviews.map((review) => (
                <li key={review.id} className="bg-surface border border-line rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <MemberAvatar
                      name={`${review.member?.first_name ?? ""} ${review.member?.last_name ?? ""}`}
                      avatarUrl={review.member?.avatar_url ?? null}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[15px] truncate">
                        {review.member ? `${review.member.first_name} ${review.member.last_name}` : "A member"}
                      </p>
                      <p className="text-[13px] text-ink-500">
                        {[
                          review.member?.home_club,
                          review.played_month
                            ? `played ${new Date(review.played_month).toLocaleDateString("en-IE", { month: "short", year: "numeric" })}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Stars value={review.rating} size={15} />
                  </div>
                  {review.body && <p className="text-[15px] leading-relaxed mt-3 whitespace-pre-wrap">{review.body}</p>}
                  {review.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {review.tags.map((t) => (
                        <span key={t} className="text-[11.5px] font-bold text-green-800 bg-green-100 rounded-full px-2 py-0.5">
                          {REVIEW_TAG_LABELS[t as ReviewTag] ?? t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-right">
                    <ReportReviewButton reviewId={review.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

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
