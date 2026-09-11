import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { listReviews } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import { EXPORT_MAX_ROWS, csvFilename, csvResponse, exportTruncated } from "@/lib/admin/export";
import { personName } from "@/lib/admin/format";

/**
 * CSV export of /admin/reviews — the review moderation queue, one row per
 * review. Open to any active staff member, the same gate as the page, and
 * carrying no email addresses (see the gating rule in
 * src/lib/admin/export.ts).
 *
 * The review body IS exported, unlike a report's description: a review is
 * something a member wrote for publication, visible to anyone browsing the
 * seller's profile, so a file of them adds nothing that isn't already
 * public. `hidden_reason` — written by a moderator, about a moderation
 * decision — is exported for the same reason a report's resolution is.
 *
 * A hidden review still appears in this file. It has to: the queue's whole
 * job is the hidden ones, and the "Hidden at" column says plainly which is
 * which.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "Review ID",
  "Order ID",
  "Rating",
  "Body",
  "Reviewer ID",
  "Reviewer name",
  "Reviewee ID",
  "Reviewee name",
  "Hidden",
  "Hidden at",
  "Hidden by",
  "Hidden reason",
  "Left at",
  "Updated at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff();

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const reviewIdParam = sp.get("reviewId") ?? "";

  const parsedReviewId = reviewIdParam ? Number(reviewIdParam) : undefined;

  const { rows, total } = await listReviews(
    {
      status: status === "hidden" || status === "visible" ? status : undefined,
      reviewId: parsedReviewId && !Number.isNaN(parsedReviewId) ? parsedReviewId : undefined,
    },
    1,
    EXPORT_MAX_ROWS
  );

  const body: CsvValue[][] = rows.map((r) => [
    r.id,
    r.order_id,
    r.rating,
    r.body,
    r.reviewer_id,
    r.reviewer ? personName(r.reviewer) : null,
    r.reviewee_id,
    r.reviewee ? personName(r.reviewee) : null,
    r.hidden_at != null,
    r.hidden_at,
    r.hidden_by,
    r.hidden_reason,
    r.created_at,
    r.updated_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.reviews",
    targetType: "review",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      includesEmail: false,
      filters: { status, reviewId: reviewIdParam },
    },
  });

  return csvResponse(csvFilename("reviews"), toCsv(HEADERS, body));
}
