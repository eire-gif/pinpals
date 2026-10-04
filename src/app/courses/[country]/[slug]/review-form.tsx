"use client";

import { useActionState, useState } from "react";
import { reportReviewAction, saveReviewAction, type CourseActionState } from "./actions";
import { MAX_REVIEW_LENGTH_CLIENT, REVIEW_TAG_OPTIONS, RATING_WORDS } from "./review-constants";

const initial: CourseActionState = {};

/**
 * Write or edit your review of a course.
 *
 * Real radio inputs behind the stars, so it works by keyboard and screen
 * reader exactly as a five-option question should; the stars are how the
 * radios look, not a replacement for them.
 */
export function ReviewForm({
  clubId,
  existing,
}: {
  clubId: number;
  existing: { rating: number; body: string | null; tags: string[]; played_month: string | null } | null;
}) {
  const [state, formAction, pending] = useActionState(saveReviewAction, initial);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState(existing?.body ?? "");
  const shown = hover || rating;

  return (
    <form action={formAction} className="bg-surface border border-line rounded-2xl p-5 grid gap-4">
      <input type="hidden" name="clubId" value={clubId} />

      <fieldset>
        <legend className="font-bold text-[15px] mb-2">{existing ? "Your rating" : "Rate this course"}</legend>
        <div className="flex items-center gap-3">
          <div className="flex" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="cursor-pointer p-1" onMouseEnter={() => setHover(n)}>
                <input
                  type="radio"
                  name="rating"
                  value={n}
                  checked={rating === n}
                  onChange={() => setRating(n)}
                  className="sr-only peer"
                  aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                />
                <svg width="32" height="32" viewBox="0 0 24 24" className="peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-green-700 rounded">
                  <path
                    d="M12 2.8l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17l-5.7 3.1 1.2-6.3-4.6-4.4 6.3-.8z"
                    fill={n <= shown ? "#b5841a" : "#e4dcc8"}
                  />
                </svg>
              </label>
            ))}
          </div>
          <span className="text-sm font-semibold text-green-800">{shown ? RATING_WORDS[shown] : ""}</span>
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-bold text-[15px] mb-2">
          What stood out? <span className="font-normal text-ink-500">Optional</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {REVIEW_TAG_OPTIONS.map((tag) => (
            <label key={tag.code} className="cursor-pointer">
              <input
                type="checkbox"
                name="tags"
                value={tag.code}
                defaultChecked={existing?.tags.includes(tag.code)}
                className="sr-only peer"
              />
              <span className="inline-block px-3.5 py-2 rounded-full border-[1.5px] border-line bg-surface text-sm font-semibold peer-checked:bg-green-700 peer-checked:border-green-700 peer-checked:text-cream-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-green-700">
                {tag.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="review-body" className="font-bold text-[15px] block mb-2">
          Tell other golfers about it <span className="font-normal text-ink-500">Optional</span>
        </label>
        <textarea
          id="review-body"
          name="body"
          rows={4}
          maxLength={MAX_REVIEW_LENGTH_CLIENT}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-xl border-[1.5px] border-line bg-surface px-4 py-3 text-base"
        />
        <div className="flex justify-between text-xs text-ink-500 mt-1">
          <label className="flex items-center gap-2">
            Played in
            <input
              type="month"
              name="playedMonth"
              defaultValue={existing?.played_month?.slice(0, 7) ?? ""}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink-900"
            />
          </label>
          <span>
            {body.length} / {MAX_REVIEW_LENGTH_CLIENT}
          </span>
        </div>
      </div>

      <p className="text-xs text-ink-500">
        Shown with your name and home club. Keep it about the golf — reviews naming staff or members are removed.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || rating === 0}
          className="px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-50"
        >
          {pending ? "Saving…" : existing ? "Update review" : "Post review"}
        </button>
        {state.done && !pending && <span className="text-sm font-semibold text-green-800">Saved — thank you.</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

export function ReportReviewButton({ reviewId }: { reviewId: number }) {
  const [state, formAction, pending] = useActionState(reportReviewAction, initial);
  const [open, setOpen] = useState(false);

  if (state.done) return <span className="text-xs text-ink-500">Reported — thanks.</span>;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-ink-500 hover:text-ink-900 underline">
        Report
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <select name="category" required defaultValue="" className="text-xs rounded-lg border border-line bg-surface px-2 py-1">
        <option value="" disabled>
          Why?
        </option>
        <option value="inappropriate_content">Inappropriate</option>
        <option value="harassment">Names or targets someone</option>
        <option value="spam">Spam</option>
        <option value="other">Something else</option>
      </select>
      <button type="submit" disabled={pending} className="text-xs font-bold text-red-600">
        {pending ? "Sending…" : "Send report"}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
