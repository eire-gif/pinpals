"use client";

import { useActionState } from "react";
import {
  OPTIONAL_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_CATEGORY_DESCRIPTIONS,
  type OptionalNotificationCategory,
} from "@/lib/notifications";
import { updateNotificationPreferences, type NotificationPreferencesState } from "./actions";

const initialState: NotificationPreferencesState = {};

export type ChannelPreferences = { email: boolean; push: boolean };

/**
 * One row per optional category, one checkbox per channel. Field names are
 * `<category>__email` / `<category>__push` — updateNotificationPreferences()
 * reads exactly those, and reads a missing key as `false`, so every submit
 * writes a complete row for every category.
 *
 * Laid out as a grid rather than two separate lists so the two channels for
 * one category stay visually on the same line at every width — the question
 * a member is answering is "how do I want to hear about offers", not "what
 * do I want emailed".
 */
export default function NotificationPreferencesForm({
  initialValues,
}: {
  initialValues: Record<OptionalNotificationCategory, ChannelPreferences>;
}) {
  const [state, formAction, pending] = useActionState(updateNotificationPreferences, initialState);

  return (
    <form action={formAction} className="bg-surface border border-line rounded-2xl p-6 flex flex-col gap-5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 gap-y-4 items-start">
        <span />
        <span className="text-xs font-bold uppercase tracking-wide text-ink-500 text-center w-14">Email</span>
        <span className="text-xs font-bold uppercase tracking-wide text-ink-500 text-center w-14">Push</span>

        {OPTIONAL_NOTIFICATION_CATEGORIES.map((category) => (
          <div key={category} className="contents">
            <span>
              <span className="block font-bold text-sm text-ink-900">{NOTIFICATION_CATEGORY_LABELS[category]}</span>
              <span className="block text-xs text-ink-500 mt-0.5">
                {NOTIFICATION_CATEGORY_DESCRIPTIONS[category]}
              </span>
            </span>

            <label className="w-14 flex justify-center pt-1 cursor-pointer">
              <span className="sr-only">Email me about {NOTIFICATION_CATEGORY_LABELS[category]}</span>
              <input
                type="checkbox"
                name={`${category}__email`}
                defaultChecked={initialValues[category].email}
                className="w-4 h-4 accent-green-700"
              />
            </label>

            <label className="w-14 flex justify-center pt-1 cursor-pointer">
              <span className="sr-only">Send a push notification about {NOTIFICATION_CATEGORY_LABELS[category]}</span>
              <input
                type="checkbox"
                name={`${category}__push`}
                defaultChecked={initialValues[category].push}
                className="w-4 h-4 accent-green-700"
              />
            </label>
          </div>
        ))}
      </div>

      <p className="text-xs text-ink-500 border-t border-line pt-4">
        Payments and refund/dispute updates are always sent — they&rsquo;re never optional, since they can need your
        attention. You&rsquo;ll always see every notification in-app here regardless of these settings, and push only
        reaches devices you&rsquo;ve turned it on for below.
      </p>

      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>}
      {state.success && <p className="text-sm text-green-700 bg-green-100 rounded-lg px-3.5 py-2.5">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
