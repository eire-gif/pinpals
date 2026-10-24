"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { shrinkForUpload } from "@/lib/images/shrink-for-upload";
import { verifyCard, type VerifyState } from "./actions";
import type { VerificationView } from "@/lib/verification/server";

export default function VerifyForm({
  current,
  defaultNumber,
  defaultClub,
  defaultClubId,
}: {
  current: VerificationView;
  defaultNumber: string;
  defaultClub: string;
  defaultClubId: number | null;
}) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyCard, {});
  const [preview, setPreview] = useState<string | null>(null);
  const shown = state.result ?? current;

  if (shown.status === "verified") {
    return (
      <div className="rounded-2xl bg-navy-900 text-cream-50 p-6 text-center">
        <div className="text-gold-400 text-xs uppercase tracking-wide font-bold">Verified golfer</div>
        <p className="font-display font-bold text-2xl mt-1">You&apos;re verified{shown.clubName ? ` · ${shown.clubName}` : ""}</p>
        <p className="text-cream-100 text-sm mt-2">The badge is on your profile, your tee-time requests and your adverts.</p>
        <Link href="/profile" className="inline-block mt-5 px-5 py-2.5 rounded-full font-bold text-sm bg-gold-400 text-navy-900">
          Back to your profile
        </Link>
      </div>
    );
  }

  if (shown.status === "needs_review") {
    return (
      <div className="rounded-2xl bg-cream-100 p-6">
        <p className="font-display font-bold text-xl">Nearly there</p>
        <p className="text-sm text-ink-500 mt-2">{shown.reason ?? "A person will check your card shortly."}</p>
        <p className="text-sm text-ink-500 mt-2">You&apos;ll get an alert when it&apos;s done. Your photo is deleted once it&apos;s been checked.</p>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        // Phone photos are often bigger than a request may carry; shrink in
        // the browser first, the same as listing photos.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const file = data.get("file");
        void (async () => {
          if (file instanceof File && file.size > 0) data.set("file", await shrinkForUpload(file));
          startTransition(() => action(data));
        })();
      }}
    >
      {shown.status === "rejected" && shown.reason && (
        <p className="text-sm text-red-600 bg-red-100 rounded-xl px-4 py-3">{shown.reason}</p>
      )}
      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-xl px-4 py-3">{state.error}</p>}

      <label className="block">
        <span className="text-sm font-bold">Golf Ireland membership number</span>
        <input
          name="number"
          required
          defaultValue={shown.number ?? defaultNumber}
          inputMode="numeric"
          autoComplete="off"
          className="mt-1 w-full rounded-xl border border-line px-4 py-3 bg-surface"
          placeholder="e.g. 12345678"
        />
      </label>

      <label className="block">
        <span className="text-sm font-bold">Your club</span>
        <input
          name="club_name"
          required
          defaultValue={shown.clubName ?? defaultClub}
          className="mt-1 w-full rounded-xl border border-line px-4 py-3 bg-surface"
          placeholder="e.g. Portmarnock Golf Club"
        />
        {defaultClubId && <input type="hidden" name="club_id" value={defaultClubId} />}
      </label>

      <label className="block">
        <span className="text-sm font-bold">Photo of your card</span>
        <span className="block text-xs text-ink-500 mt-0.5">
          Your Golf Ireland card, or the card screen in the Golf Ireland app. Flat, in good light, the whole card in view.
        </span>
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className="mt-2 block w-full text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Your card" className="mt-3 rounded-xl max-h-56 object-contain border border-line" />
        )}
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full px-6 py-3 rounded-full font-bold bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {pending ? "Checking your card…" : "Check my card"}
      </button>

      <p className="text-xs text-ink-500">
        Your photo is read automatically to confirm your name, club and number match your profile, then deleted. If it
        can&apos;t be confirmed automatically, a PinPals team member looks at it first and deletes it once they have.
        Only the badge and your club are shown to other members.
      </p>
    </form>
  );
}
