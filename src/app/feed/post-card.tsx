"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import MemberAvatar from "@/components/member-avatar";
import { MAX_COMMENT_BODY, POST_VISIBILITY_SHORT, likeSummary, relativeTime } from "@/lib/feed";
import type { FeedComment, FeedPhoto, FeedPost } from "@/lib/feed-server";
import {
  addCommentAction,
  deleteCommentAction,
  deletePostAction,
  reportAction,
  blockAction,
  setLikeAction,
  updatePostAction,
} from "./actions";

const LONG_POST = 320;

const REPORT_REASONS = [
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "spam", label: "Spam" },
  { value: "scam_fraud", label: "Scam or fraud" },
  { value: "other", label: "Something else" },
];

/**
 * One post in the feed — or, with `standalone`, the whole of /feed/[id].
 *
 * Likes are optimistic: a heart that waits for a round trip feels broken,
 * and the worst case is a heart that flips back with a message. Comments
 * are not — a comment that appears and then vanishes reads as having been
 * deleted by someone, which is worse than a short wait.
 */
export default function PostCard({ post, standalone = false }: { post: FeedPost; standalone?: boolean }) {
  const router = useRouter();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [expanded, setExpanded] = useState(standalone || post.body.length <= LONG_POST);
  const [comment, setComment] = useState("");
  // Replying to one comment rather than the post (0092). The database files
  // a reply to a reply under its top-level comment.
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState<{ target: "post" | "post_comment"; id: number } | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const commentInput = useRef<HTMLTextAreaElement>(null);

  const permalink = `/feed/${post.id}`;
  const shownComments = post.comments;
  const hiddenCommentCount = Math.max(0, post.commentCount - shownComments.filter((c) => !c.hidden).length);

  function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikeCount((n) => Math.max(0, n + (next ? 1 : -1)));
    startTransition(async () => {
      const result = await setLikeAction(post.id, next);
      if (result.ok) {
        setLikeCount(result.value.likeCount);
      } else {
        setLiked(!next);
        setLikeCount((n) => Math.max(0, n + (next ? -1 : 1)));
        setError(result.error);
      }
    });
  }

  function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body) return;
    setError(null);
    startTransition(async () => {
      const result = await addCommentAction(post.id, body, replyTo?.id ?? null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setComment("");
      setReplyTo(null);
      router.refresh();
    });
  }

  function removeComment(c: FeedComment) {
    if (!window.confirm("Delete this comment?")) return;
    startTransition(async () => {
      const result = await deleteCommentAction(c.id, post.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function removePost() {
    setMenuOpen(false);
    if (!window.confirm("Delete this post? Its photos, likes and comments go with it.")) return;
    startTransition(async () => {
      const result = await deletePostAction(post.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (standalone) router.push("/feed");
      else router.refresh();
    });
  }

  /**
   * Block from the feed. A real confirm, because the effect is wider than
   * the post in front of you: every post and comment by this member leaves
   * your feed, and neither of you can message the other. Nobody is told.
   */
  function block(memberId: string, name: string) {
    setMenuOpen(false);
    const first = name.split(" ")[0] || "this member";
    if (
      !window.confirm(
        `Block ${name}?\n\nYou won't see ${first}'s posts or comments, and ${first} won't see yours. Neither of you can message the other. ${first} isn't told. You can unblock from ${first}'s page.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await blockAction(memberId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (standalone && memberId === post.author.id) router.push("/feed");
      else router.refresh();
    });
  }

  function switchAudience() {
    setMenuOpen(false);
    const visibility = post.visibility === "members" ? "connections" : "members";
    startTransition(async () => {
      const result = await updatePostAction(post.id, { visibility });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const summary = likeSummary(likeCount, null, liked);

  return (
    <article className="bg-surface border border-line rounded-2xl shadow-sm overflow-hidden" aria-labelledby={`post-${post.id}-author`}>
      {post.hidden && (
        <p className="bg-gold-500/15 text-ink-900 text-xs font-semibold px-5 py-2">
          Only you can see this post — it has been hidden by PinPals.
        </p>
      )}

      <header className="flex items-start gap-3 px-5 pt-4">
        <Link href={`/members/${post.author.id}`} className="shrink-0">
          <MemberAvatar name={post.author.name} avatarUrl={post.author.avatarUrl} color={post.author.avatarColor} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            id={`post-${post.id}-author`}
            href={`/members/${post.author.id}`}
            className="font-bold text-ink-900 hover:underline"
          >
            {post.author.name}
          </Link>
          <p className="text-xs text-ink-500 flex flex-wrap items-center gap-x-1.5">
            {post.club && (
              <>
                <span className="inline-flex items-center gap-1 font-semibold text-green-700">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M6 2v20h2v-8l10-4L8 6V2H6z" />
                  </svg>
                  {post.club.name}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <Link href={permalink} className="hover:underline">
              <time dateTime={post.createdAt}>{relativeTime(post.createdAt)}</time>
            </Link>
            <span aria-hidden="true">·</span>
            <span title={post.visibility === "members" ? "Visible to all PinPals members" : "Visible to connections only"}>
              {POST_VISIBILITY_SHORT[post.visibility]}
            </span>
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="w-9 h-9 -mr-2 rounded-full flex items-center justify-center text-ink-500 hover:bg-cream-100"
            aria-label="Post options"
            aria-expanded={menuOpen}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 z-20 w-56 bg-surface border border-line rounded-xl shadow-lg py-1 text-sm">
              {post.isMine ? (
                <>
                  <button type="button" onClick={switchAudience} className="block w-full text-left px-4 py-2.5 hover:bg-cream-100">
                    {post.visibility === "members" ? "Show to connections only" : "Show to all members"}
                  </button>
                  <button type="button" onClick={removePost} className="block w-full text-left px-4 py-2.5 text-red-600 hover:bg-cream-100">
                    Delete post
                  </button>
                </>
              ) : (
                <>
                  <Link href={`/members/${post.author.id}`} className="block px-4 py-2.5 hover:bg-cream-100">
                    View {post.author.name.split(" ")[0]}&rsquo;s profile
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setReporting({ target: "post", id: post.id });
                    }}
                    className="block w-full text-left px-4 py-2.5 hover:bg-cream-100"
                  >
                    Report post
                  </button>
                  <button
                    type="button"
                    onClick={() => block(post.author.id, post.author.name)}
                    className="block w-full text-left px-4 py-2.5 text-red-600 hover:bg-cream-100"
                  >
                    Block {post.author.name.split(" ")[0]}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {post.body && (
        <div className="px-5 pt-3 text-[15px] leading-relaxed text-ink-900 whitespace-pre-line break-words">
          {expanded ? post.body : `${post.body.slice(0, LONG_POST).trimEnd()}…`}
          {!expanded && (
            <button type="button" onClick={() => setExpanded(true)} className="ml-1 font-semibold text-ink-500 hover:text-ink-900">
              See more
            </button>
          )}
        </div>
      )}

      {post.photos.length > 0 && <PhotoGrid photos={post.photos} onOpen={setLightbox} />}

      {(summary || post.commentCount > 0) && (
        <div className="px-5 pt-3 flex items-center justify-between text-xs text-ink-500">
          <span>{summary}</span>
          {post.commentCount > 0 && (
            <Link href={permalink} className="hover:underline">
              {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
            </Link>
          )}
        </div>
      )}

      <div className="mx-5 mt-2 border-t border-line flex">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={liked}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg my-1 hover:bg-cream-100 transition ${
            liked ? "text-red-600" : "text-ink-500"
          }`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2.1 0 3.6 1.1 4.4 2.5C11.8 6.1 13.3 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21z" />
          </svg>
          {liked ? "Liked" : "Like"}
        </button>
        <button
          type="button"
          onClick={() => {
            // A comment on the post itself, not an answer to anyone.
            setReplyTo(null);
            commentInput.current?.focus();
          }}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-lg my-1 text-ink-500 hover:bg-cream-100 transition"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />
          </svg>
          Comment
        </button>
      </div>

      {(shownComments.length > 0 || hiddenCommentCount > 0) && (
        <div className="px-5 pt-1 pb-1 grid gap-3">
          {!standalone && hiddenCommentCount > 0 && (
            <Link href={permalink} className="text-sm font-semibold text-ink-500 hover:text-ink-900">
              View all {post.commentCount} comments
            </Link>
          )}
          {shownComments.map((c) => (
            <div key={c.id} className={`flex gap-2.5 ${c.depth === 1 ? "ml-9" : ""}`}>
              <Link href={`/members/${c.author.id}`} className="shrink-0">
                <MemberAvatar name={c.author.name} avatarUrl={c.author.avatarUrl} color={c.author.avatarColor} size="xs" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className={`rounded-2xl px-3.5 py-2 ${c.hidden ? "bg-gold-500/15" : "bg-surface-tint border border-line"}`}>
                  <Link href={`/members/${c.author.id}`} className="text-[13px] font-bold hover:underline">
                    {c.author.name}
                  </Link>
                  <p className="text-sm whitespace-pre-line break-words">{c.body}</p>
                  {c.hidden && <p className="text-[11px] text-ink-500 mt-1">Hidden by PinPals — only you can see this.</p>}
                </div>
                <div className="flex gap-3 px-3.5 pt-1 text-[11px] text-ink-500">
                  <time dateTime={c.createdAt}>{relativeTime(c.createdAt)}</time>
                  {!c.hidden && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTo({ id: c.id, name: c.author.name });
                        commentInput.current?.focus();
                      }}
                      className="font-semibold hover:text-ink-900"
                    >
                      Reply
                    </button>
                  )}
                  {c.canDelete && (
                    <button type="button" onClick={() => removeComment(c)} className="font-semibold hover:text-red-600">
                      Delete
                    </button>
                  )}
                  {!c.canDelete && (
                    <button
                      type="button"
                      onClick={() => setReporting({ target: "post_comment", id: c.id })}
                      className="font-semibold hover:text-ink-900"
                    >
                      Report
                    </button>
                  )}
                  {!c.isMine && (
                    <button type="button" onClick={() => block(c.author.id, c.author.name)} className="font-semibold hover:text-red-600">
                      Block
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="px-5 pt-2 -mb-1 flex items-center gap-2 text-xs text-ink-500">
          <span>
            Replying to <span className="font-bold text-ink-900">{replyTo.name}</span>
          </span>
          <button type="button" onClick={() => setReplyTo(null)} className="font-semibold hover:text-ink-900">
            Cancel
          </button>
        </div>
      )}
      <form onSubmit={submitComment} className="px-5 pt-2 pb-4 flex items-end gap-2">
        <label htmlFor={`comment-${post.id}`} className="sr-only">
          Write a comment
        </label>
        <textarea
          ref={commentInput}
          id={`comment-${post.id}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitComment(e);
            }
          }}
          rows={1}
          maxLength={MAX_COMMENT_BODY}
          placeholder={replyTo ? `Reply to ${replyTo.name.split(" ")[0]}…` : "Write a comment…"}
          className="flex-1 resize-none rounded-2xl border-[1.5px] border-line bg-surface-tint px-4 py-2 text-base sm:text-sm focus:outline-none focus:border-green-700"
        />
        <button
          type="submit"
          disabled={pending || comment.trim().length === 0}
          className="px-4 py-2 rounded-full text-sm font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-40"
        >
          Post
        </button>
      </form>

      {error && (
        <p role="alert" className="px-5 pb-4 -mt-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      {reporting && <ReportDialog target={reporting} onClose={() => setReporting(null)} />}
      {lightbox !== null && (
        <Lightbox photos={post.photos} index={lightbox} onChange={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </article>
  );
}

/**
 * One photo shows at its own shape (within limits); two sit side by side;
 * three or more make a grid with a "+N" on the last tile. The boxes are
 * reserved before the photos arrive, so nothing below them jumps.
 */
function PhotoGrid({ photos, onOpen }: { photos: FeedPhoto[]; onOpen: (index: number) => void }) {
  if (photos.length === 1) {
    const p = photos[0];
    // Between 4:5 (portrait) and 16:9 (landscape): a full-height portrait
    // photo would push the Like button off a laptop screen.
    const ratio = p.width && p.height ? Math.min(Math.max(p.width / p.height, 0.8), 16 / 9) : 4 / 3;
    return (
      <button type="button" onClick={() => onOpen(0)} className="block w-full mt-3 bg-cream-100" style={{ aspectRatio: ratio }} aria-label="Open photo">
        <Photo photo={p} />
      </button>
    );
  }

  const tiles = photos.slice(0, 4);
  const extra = photos.length - tiles.length;
  return (
    <div className={`mt-3 grid gap-0.5 ${photos.length === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
      {tiles.map((p, i) => (
        <button
          key={p.path}
          type="button"
          onClick={() => onOpen(i)}
          className={`relative bg-cream-100 ${photos.length === 3 && i === 0 ? "row-span-2 aspect-[1/2]" : "aspect-square"}`}
          aria-label={`Open photo ${i + 1} of ${photos.length}`}
        >
          <Photo photo={p} />
          {extra > 0 && i === tiles.length - 1 && (
            <span className="absolute inset-0 bg-navy-900/55 flex items-center justify-center text-white font-display font-bold text-3xl">
              +{extra}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Photo({ photo }: { photo: FeedPhoto }) {
  if (!photo.url) return <span className="block w-full h-full" />;
  return (
    // Plain <img>, not next/image: the URL is signed and short-lived, and
    // the optimiser would cache a private photo on a shared CDN under a link
    // that stops working within the hour. Same reasoning as message photos.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.url}
      alt=""
      loading="lazy"
      decoding="async"
      width={photo.width ?? undefined}
      height={photo.height ?? undefined}
      className="w-full h-full object-cover"
    />
  );
}

function Lightbox({
  photos,
  index,
  onChange,
  onClose,
}: {
  photos: FeedPhoto[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < photos.length - 1) onChange(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onChange(index - 1);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, photos.length, onChange, onClose]);

  const photo = photos[index];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      className="fixed inset-0 z-[60] bg-navy-900/95 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {photo.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
      )}
      <button type="button" onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white text-2xl hover:bg-white/20" aria-label="Close">
        ×
      </button>
      {index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(index - 1);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white text-2xl hover:bg-white/20"
          aria-label="Previous photo"
        >
          ‹
        </button>
      )}
      {index < photos.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(index + 1);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white text-2xl hover:bg-white/20"
          aria-label="Next photo"
        >
          ›
        </button>
      )}
    </div>
  );
}

function ReportDialog({
  target,
  onClose,
}: {
  target: { target: "post" | "post_comment"; id: number };
  onClose: () => void;
}) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<{ done?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await reportAction({ target: target.target, targetId: target.id, category, description });
      setState(result.ok ? { done: true } : { error: result.error });
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="report-title" className="fixed inset-0 z-[60] bg-navy-900/60 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 id="report-title" className="font-display font-bold text-xl">
          Report this {target.target === "post" ? "post" : "comment"}
        </h2>
        {state.done ? (
          <>
            <p className="mt-3 text-sm text-ink-500">Thanks — the PinPals team will take a look. The member isn&rsquo;t told who reported them.</p>
            <button type="button" onClick={onClose} className="mt-5 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50">
              Done
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="mt-4 grid gap-3">
            <select
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-xl border-[1.5px] border-line bg-surface px-3 py-2.5 text-base"
              aria-label="Reason"
            >
              <option value="">Choose a reason…</option>
              {REPORT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Anything we should know? (optional)"
              className="rounded-xl border-[1.5px] border-line bg-surface px-3 py-2.5 text-base resize-none"
            />
            {state.error && <p className="text-sm font-semibold text-red-600">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-full text-sm font-bold text-ink-500">
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !category}
                className="px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
