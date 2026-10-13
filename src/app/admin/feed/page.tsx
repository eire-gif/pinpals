import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { formatDateTime } from "@/lib/admin/format";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/page-header";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { BulkProvider, BulkBar, SelectAll, SelectRow } from "@/components/admin/controls/bulk";
import { Pill } from "@/components/admin/table";
import { bulkBarProps, rowActionProps } from "@/lib/admin/controls";

const PAGE_SIZE = 25;
const PHOTO_URL_TTL_SECONDS = 15 * 60;

type Person = { id: string; first_name: string | null; last_name: string | null } | null;

type PostRow = {
  id: number;
  body: string;
  visibility: string;
  like_count: number;
  comment_count: number;
  hidden_at: string | null;
  hidden_reason: string | null;
  created_at: string;
  author: Person;
  post_images: { path: string; position: number }[];
};

type CommentRow = {
  id: number;
  post_id: number;
  body: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  created_at: string;
  author: Person;
};

const nameOf = (p: Person) => [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Former member";

/**
 * Feed moderation. One list, newest first, filterable to hidden or to a
 * single post (which is where a report links). Opening one post shows its
 * comments, each with its own hide/restore.
 *
 * Read with the service role, because a moderator has to see a post that
 * is connections-only or already hidden — this page is the reason staff do
 * NOT get a bypass in the feed's RLS policies. Every write through it is
 * reason-required and audited.
 */
export default async function AdminFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; postId?: string; commentId?: string; page?: string }>;
}) {
  const { staff } = await requireStaff();
  const { status = "", postId: postParam, commentId: commentParam, page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const admin = createAdminClient();

  // A comment link resolves to its post, with that comment highlighted.
  let postId = postParam ? Number(postParam) : null;
  const commentId = commentParam ? Number(commentParam) : null;
  if (commentId && Number.isInteger(commentId)) {
    const { data } = await admin.from("post_comments").select("post_id").eq("id", commentId).maybeSingle<{ post_id: number }>();
    if (data) postId = data.post_id;
  }
  if (postId !== null && (!Number.isInteger(postId) || postId <= 0)) postId = null;

  let query = admin
    .from("posts")
    .select(
      `id, body, visibility, like_count, comment_count, hidden_at, hidden_reason, created_at,
       author:profiles!posts_author_id_fkey ( id, first_name, last_name ),
       post_images ( path, position )`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (postId) query = query.eq("id", postId);
  if (status === "hidden") query = query.not("hidden_at", "is", null);
  if (status === "visible") query = query.is("hidden_at", null);

  const { data: posts, count } = await query.returns<PostRow[]>();
  const rows = posts ?? [];

  const paths = rows.flatMap((r) => r.post_images.map((i) => i.path));
  const { data: signed } = paths.length
    ? await admin.storage.from("post-images").createSignedUrls(paths, PHOTO_URL_TTL_SECONDS)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlByPath = new Map<string, string>();
  for (const row of signed ?? []) if (row.path && row.signedUrl) urlByPath.set(row.path, row.signedUrl);

  const { data: comments } = postId
    ? await admin
        .from("post_comments")
        .select(
          `id, post_id, body, hidden_at, hidden_reason, created_at,
           author:profiles!post_comments_author_id_fkey ( id, first_name, last_name )`
        )
        .eq("post_id", postId)
        .order("created_at", { ascending: true })
        .returns<CommentRow[]>()
    : { data: [] as CommentRow[] };

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/feed?${qs}` : "/admin/feed";
  };

  return (
    <div>
      <AdminPageHeader
        title="Social"
        description={
          <>
            {total} {total === 1 ? "post" : "posts"}
            {status && <> · {status === "hidden" ? "Hidden only" : "Visible only"}</>}. A hidden post stays visible to its author, marked as hidden.
          </>
        }
      />

      {postId ? (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="bg-navy-900 text-cream-50 font-semibold px-3 py-1.5 rounded-full">Post #{postId}</span>
          <Link href="/admin/feed" className="text-ink-500 hover:text-ink-900">
            Clear
          </Link>
        </div>
      ) : (
        <form className="flex flex-wrap gap-3 mb-6">
          <select name="status" defaultValue={status} className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
            <option value="">All posts</option>
            <option value="visible">Visible only</option>
            <option value="hidden">Hidden only</option>
          </select>
          <button type="submit" className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
            Filter
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl text-center py-16 text-ink-500">No posts match that filter.</div>
      ) : (
        <BulkProvider>
        {!postId && (
          <div className="flex items-center gap-2 mb-3 text-sm text-ink-500">
            <SelectAll ids={rows.map((p) => p.id)} /> Select all on this page
          </div>
        )}
        <div className="flex flex-col gap-3">
          {rows.map((post) => (
            <div key={post.id} className="bg-surface border border-line rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <SelectRow id={post.id} label={`Select post #${post.id}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-ink-900">
                    {post.author ? (
                      <Link href={`/admin/users/${post.author.id}`} className="hover:underline">
                        {nameOf(post.author)}
                      </Link>
                    ) : (
                      "Former member"
                    )}
                  </div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    <Link href={`/admin/feed?postId=${post.id}`} className="hover:underline">
                      Post #{post.id}
                    </Link>{" "}
                    · {post.visibility === "members" ? "All members" : "Connections only"} · {post.like_count} likes ·{" "}
                    {post.comment_count} comments · {formatDateTime(post.created_at)}
                  </div>
                </div>
                <Pill tone={post.hidden_at ? "bad" : "good"}>{post.hidden_at ? "Hidden" : "Visible"}</Pill>
                <AdminRowActions {...rowActionProps(staff, "post", post.id, { hidden: !!post.hidden_at }, null, { view: false })} />
              </div>

              {post.body && <p className="text-sm text-ink-900 mt-3 whitespace-pre-wrap">{post.body}</p>}

              {post.post_images.length > 0 && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {[...post.post_images]
                    .sort((a, b) => a.position - b.position)
                    .map((img) => {
                      const url = urlByPath.get(img.path);
                      return url ? (
                        <a key={img.path} href={url} target="_blank" rel="noreferrer">
                          {/* Signed, short-lived URL — see the feed's own note on next/image. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="w-24 h-24 object-cover rounded-lg bg-cream-100" />
                        </a>
                      ) : (
                        <span key={img.path} className="w-24 h-24 rounded-lg bg-cream-100" />
                      );
                    })}
                </div>
              )}

              {post.hidden_at && (
                <p className="text-xs text-ink-500 mt-3 bg-cream-100 rounded-lg px-3 py-2">
                  Hidden {formatDateTime(post.hidden_at)}
                  {post.hidden_reason && <> — &ldquo;{post.hidden_reason}&rdquo;</>}
                </p>
              )}

              {postId === post.id && (comments ?? []).length > 0 && (
                <div className="mt-6 border-t border-line pt-4">
                  <BulkProvider>
                    <div className="flex items-center gap-2 mb-3">
                      <SelectAll ids={(comments ?? []).map((c) => c.id)} />
                      <h2 className="text-sm font-bold">Comments</h2>
                    </div>
                    <div className="grid gap-3">
                      {(comments ?? []).map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-xl border p-4 ${c.id === commentId ? "border-gold-500 bg-gold-500/10" : "border-line"}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="pt-0.5">
                              <SelectRow id={c.id} label={`Select comment #${c.id}`} />
                            </div>
                            <div className="flex-1 min-w-0 text-xs text-ink-500">
                              <span className="font-bold text-ink-900">{nameOf(c.author)}</span> · Comment #{c.id} ·{" "}
                              {formatDateTime(c.created_at)}
                            </div>
                            {c.hidden_at && <Pill tone="bad">Hidden</Pill>}
                            <AdminRowActions
                              {...rowActionProps(staff, "post_comment", c.id, { hidden: !!c.hidden_at }, null, { view: false })}
                            />
                          </div>
                          <p className="text-sm mt-2 whitespace-pre-wrap">{c.body}</p>
                          {c.hidden_reason && <p className="text-xs text-ink-500 mt-2">&ldquo;{c.hidden_reason}&rdquo;</p>}
                        </div>
                      ))}
                    </div>
                    <BulkBar {...bulkBarProps(staff, "post_comment")} />
                  </BulkProvider>
                </div>
              )}
            </div>
          ))}
        </div>
        <BulkBar {...bulkBarProps(staff, "post")} />
        </BulkProvider>
      )}

      {!postId && pages > 1 && (
        <div className="flex justify-between mt-6 text-sm font-bold">
          {page > 1 ? <Link href={href(page - 1)}>← Newer</Link> : <span />}
          {page < pages ? <Link href={href(page + 1)}>Older →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
