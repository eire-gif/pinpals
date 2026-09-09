import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listReviews } from "@/lib/admin/queries";
import { formatDateTime, personName } from "@/lib/admin/format";
import ModerationForm from "@/components/admin/moderation-form";
import AdminPagination from "@/components/admin/pagination";
import { hideReview, restoreReview } from "./actions";

/**
 * The review moderation queue — "support report/moderation without silent
 * deletion" for reviews. A single filterable list (same shape as
 * /admin/risk-flags) rather than a list + detail page pair: a review has no
 * other admin-relevant sub-state to drill into (no notes, no assignment, no
 * status workflow the way a report has) — hide/restore, with a required
 * reason recorded to the audit log, is the entire moderation surface. Linked
 * to from a reports-queue row via ?reviewId= (see resolveTargetSummaries()'s
 * "review" branch in src/lib/admin/queries.ts) since there's no dedicated
 * detail page to send that link to instead.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reviewId?: string; page?: string }>;
}) {
  await requireStaff();
  const { status = "", reviewId, page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const parsedReviewId = reviewId ? Number(reviewId) : undefined;

  const { rows, total, pageSize } = await listReviews(
    {
      status: status === "hidden" || status === "visible" ? status : undefined,
      reviewId: parsedReviewId && !Number.isNaN(parsedReviewId) ? parsedReviewId : undefined,
    },
    page
  );

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (reviewId) params.set("reviewId", reviewId);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/reviews?${qs}` : "/admin/reviews";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Reviews</h1>
      <p className="text-ink-500 mb-6">
        {total} {total === 1 ? "review" : "reviews"}
        {status && <> · {status === "hidden" ? "Hidden only" : "Visible only"}</>}.
      </p>

      {reviewId && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="bg-navy-900 text-cream-50 font-semibold px-3 py-1.5 rounded-full">
            Review #{reviewId}
          </span>
          <Link href="/admin/reviews" className="text-ink-500 hover:text-ink-900">
            Clear
          </Link>
        </div>
      )}

      <form className="flex flex-wrap gap-3 mb-6">
        <select name="status" defaultValue={status} className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
          <option value="">All reviews</option>
          <option value="visible">Visible only</option>
          <option value="hidden">Hidden only</option>
        </select>
        <button type="submit" className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl text-center py-16 text-ink-500">
          No reviews match that filter.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((review) => (
            <div key={review.id} className="bg-surface border border-line rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-bold text-ink-900">
                    {personName(review.reviewer)} &rarr; {personName(review.reviewee)}
                  </div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    Order #{review.order_id} · {review.rating}★ · {formatDateTime(review.created_at)}
                  </div>
                </div>
                {review.hidden_at ? (
                  <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">Hidden</span>
                ) : (
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">Visible</span>
                )}
              </div>

              {review.body && <p className="text-sm text-ink-900 mt-3 whitespace-pre-wrap">{review.body}</p>}

              {review.hidden_at && (
                <p className="text-xs text-ink-500 mt-3 bg-cream-100 rounded-lg px-3 py-2">
                  Hidden {formatDateTime(review.hidden_at)}
                  {review.hidden_reason && <> — &ldquo;{review.hidden_reason}&rdquo;</>}
                </p>
              )}

              <div className="mt-4">
                {review.hidden_at ? (
                  <ModerationForm
                    action={restoreReview}
                    idField="reviewId"
                    id={review.id}
                    submitLabel="Restore"
                    pendingLabel="Restoring…"
                    placeholder="Reason for restoring (recorded in the audit log)"
                  />
                ) : (
                  <ModerationForm
                    action={hideReview}
                    idField="reviewId"
                    id={review.id}
                    submitLabel="Hide"
                    pendingLabel="Hiding…"
                    tone="danger"
                    placeholder="Reason for hiding (recorded in the audit log)"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AdminPagination page={page} pageSize={pageSize} total={total} hrefForPage={pageHref} />
    </div>
  );
}
