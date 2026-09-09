import Link from "next/link";
import type { ClubSummary } from "@/lib/types";

/**
 * One club in a directory list.
 *
 * The location line matters more than it looks. Club names stopped being
 * unique when the directory went past Ireland (0062) — there are several
 * "Manor Golf Club"s in England alone — so a card showing a bare name would
 * leave two different clubs indistinguishable in a search result. Where we
 * have a town or county it is shown; where we have neither, the card says so
 * rather than rendering an empty line, because "we don't know" and "it has no
 * location" should not look the same.
 */
export default function CourseCard({ course }: { course: ClubSummary }) {
  const location = [course.town, course.region].filter(Boolean).join(", ");

  return (
    <Link
      href={`/courses/${course.country}/${course.slug}`}
      className="group bg-surface border border-line rounded-xl p-4 shadow-sm hover:shadow-md hover:border-green-600 transition flex items-start gap-3"
    >
      <svg
        className="w-4 h-4 text-green-600 shrink-0 mt-1"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M5 21V4l13 4-13 4" />
      </svg>
      <div className="min-w-0">
        <h3 className="font-semibold text-[15px] leading-snug group-hover:text-green-800 transition">
          {course.name}
        </h3>
        <p className="text-[13px] text-ink-500 mt-0.5 truncate">
          {location || "Location not recorded yet"}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {course.holes ? (
            <span className="text-[11.5px] font-bold text-ink-500 bg-cream-100 rounded-full px-2 py-0.5">
              {course.holes} holes
            </span>
          ) : null}
          {course.website ? (
            <span className="text-[11.5px] font-bold text-green-800 bg-green-100 rounded-full px-2 py-0.5">
              Website
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
