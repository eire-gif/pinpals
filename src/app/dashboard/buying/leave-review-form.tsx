"use client";

import { useState, useTransition } from "react";
import { submitReview } from "./actions";

export default function LeaveReviewForm({ orderId, revieweeId }: { orderId: number; revieweeId: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return <p className="text-sm text-green-700 bg-green-100 rounded-lg px-3.5 py-2.5">Thanks — your review was posted.</p>;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-bold text-green-700 hover:text-green-600"
      >
        Leave a review
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitReview(orderId, revieweeId, rating, body);
      if ("error" in result) {
        setError(result.error);
      } else {
        setDone(true);
      }
    });
  }

  return (
    <div className="bg-cream-100 rounded-xl p-4 mt-2">
      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5 mb-3">{error}</p>}
      <div className="flex gap-1 mb-3" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setRating(n)}
            className={`text-2xl leading-none ${n <= rating ? "text-gold-500" : "text-ink-300"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="How did it go? (optional)"
        className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 mb-3"
      />
      <div className="flex gap-3">
        <button
          onClick={submit}
          disabled={pending}
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post review"}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={pending}
          className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line text-ink-700 hover:bg-cream-100 transition disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
