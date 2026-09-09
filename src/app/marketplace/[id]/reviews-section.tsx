import { initials } from "@/lib/format";
import { formatDateTime } from "@/lib/admin/format";
import ReportReviewButton from "./report-review-button";

type ReviewItem = {
  id: number;
  rating: number;
  body: string | null;
  createdAt: string;
  reviewer: { id: string; first_name: string; last_name: string; avatar_color: string | null } | null;
};

/**
 * "Seller reviews" — the individual-review display the task's review
 * requirements assume exists (structured rating + short text, per review),
 * distinct from the aggregate "★ 4.7 (12 reviews)" badge SellerCard already
 * showed before this phase. Reused for both a listing's own seller and (via
 * the same component, different caller) anywhere else a member's review
 * history is worth showing — currently just this page, since no other
 * reviews-list surface exists yet. Hidden reviews never reach this
 * component in the first place: `reviews`' own RLS policy (0056) already
 * excludes them from the public SELECT this page's data-fetch runs, so
 * there's no hidden-state branch to render here at all.
 */
export default function ReviewsSection({
  sellerName,
  rating,
  reviews,
  viewerIsSignedIn,
}: {
  sellerName: string;
  rating: { average: number; count: number } | null;
  reviews: ReviewItem[];
  viewerIsSignedIn: boolean;
}) {
  if (!rating || reviews.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface border border-line rounded-2xl p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-display font-bold text-xl">Reviews of {sellerName}</h2>
        <span className="text-sm font-bold text-ink-900">
          ★ {rating.average} · {rating.count} review{rating.count === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="mt-5 flex flex-col gap-5">
        {reviews.map((review) => {
          const reviewerName = review.reviewer
            ? `${review.reviewer.first_name} ${review.reviewer.last_name}`.trim()
            : "A Pinpals member";
          return (
            <li key={review.id} className="border-t border-line pt-5 first:border-0 first:pt-0">
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-display font-bold shrink-0"
                  style={{ background: review.reviewer?.avatar_color ?? "#1f5c2e" }}
                  aria-hidden="true"
                >
                  {initials(reviewerName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm">{reviewerName}</span>
                    <span className="text-gold-500 text-sm" aria-label={`${review.rating} out of 5 stars`}>
                      {"★".repeat(review.rating)}
                      <span className="text-ink-300">{"★".repeat(5 - review.rating)}</span>
                    </span>
                  </div>
                  <p className="text-xs text-ink-500 mt-0.5">{formatDateTime(review.createdAt)}</p>
                  {review.body && <p className="text-sm text-ink-900 mt-2 whitespace-pre-wrap">{review.body}</p>}
                  {viewerIsSignedIn && (
                    <div className="mt-2">
                      <ReportReviewButton reviewId={review.id} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
