import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/admin/format";
import AdminPageHeader from "@/components/admin/page-header";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { BulkProvider, BulkBar, SelectAll, SelectRow } from "@/components/admin/controls/bulk";
import { Pill } from "@/components/admin/table";
import { bulkBarProps, rowActionProps } from "@/lib/admin/controls";

type Row = {
  id: number;
  rating: number;
  body: string | null;
  created_at: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  club: { name: string; country: string; slug: string } | null;
  member: { first_name: string; last_name: string } | null;
};

const PAGE_SIZE = 50;

/**
 * Course reviews (0093). One list, newest first, with hide/restore — the
 * whole moderation surface, same as /admin/reviews. A reports-queue row for a
 * course review links here with ?reviewId=.
 *
 * Reviews with no comment are left out of the default view: a bare star
 * rating has nothing in it to moderate, and listing hundreds of them would
 * bury the ones that do.
 */
export default async function AdminCourseReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reviewId?: string }>;
}) {
  const { staff } = await requireStaff();
  const { status = "", reviewId } = await searchParams;
  const admin = createAdminClient();

  let query = admin
    .from("course_reviews")
    .select(
      `id, rating, body, created_at, hidden_at, hidden_reason,
       club:clubs ( name, country, slug ),
       member:profiles!course_reviews_member_id_fkey ( first_name, last_name )`
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const id = reviewId ? Number(reviewId) : NaN;
  if (Number.isInteger(id)) query = query.eq("id", id);
  else {
    query = query.not("body", "is", null);
    if (status === "hidden") query = query.not("hidden_at", "is", null);
    if (status === "visible") query = query.is("hidden_at", null);
  }

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div>
      <AdminPageHeader
        title="Course reviews"
        description="Reviews with a comment, newest first. Hiding one also takes it out of the course's average."
      />

      {reviewId ? (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="bg-navy-900 text-cream-50 font-semibold px-3 py-1.5 rounded-full">Review #{reviewId}</span>
          <Link href="/admin/course-reviews" className="text-ink-500 hover:text-ink-900">Clear</Link>
        </div>
      ) : (
        <form className="flex flex-wrap gap-3 mb-6">
          <select name="status" defaultValue={status} className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
            <option value="">All</option>
            <option value="visible">Visible only</option>
            <option value="hidden">Hidden only</option>
          </select>
          <button type="submit" className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
            Filter
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl text-center py-16 text-ink-500">No course reviews match.</div>
      ) : (
        <BulkProvider>
          <div className="flex items-center gap-2 mb-3 text-sm text-ink-500">
            <SelectAll ids={rows.map((r) => r.id)} /> Select all on this page
          </div>
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.id} className="bg-surface border border-line rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="pt-0.5">
                    <SelectRow id={r.id} label={`Select review #${r.id}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-ink-900">
                      {r.member ? `${r.member.first_name} ${r.member.last_name}` : "Unknown member"} &rarr;{" "}
                      {r.club ? (
                        <Link href={`/courses/${r.club.country}/${r.club.slug}`} className="underline">
                          {r.club.name}
                        </Link>
                      ) : (
                        "a course"
                      )}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      #{r.id} · {r.rating}★ · {formatDateTime(r.created_at)}
                    </div>
                  </div>
                  <Pill tone={r.hidden_at ? "bad" : "good"}>{r.hidden_at ? "Hidden" : "Visible"}</Pill>
                  <AdminRowActions {...rowActionProps(staff, "course_review", r.id, { hidden: !!r.hidden_at })} />
                </div>
                {r.body && <p className="text-sm text-ink-900 mt-3 whitespace-pre-wrap">{r.body}</p>}
                {r.hidden_at && (
                  <p className="text-xs text-ink-500 mt-3 bg-cream-100 rounded-lg px-3 py-2">
                    Hidden {formatDateTime(r.hidden_at)}
                    {r.hidden_reason && <> — &ldquo;{r.hidden_reason}&rdquo;</>}
                  </p>
                )}
              </div>
            ))}
          </div>
          <BulkBar {...bulkBarProps(staff, "course_review")} />
        </BulkProvider>
      )}
    </div>
  );
}
