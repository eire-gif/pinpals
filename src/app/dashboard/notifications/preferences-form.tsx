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

export default function NotificationPreferencesForm({
  initialValues,
}: {
  initialValues: Record<OptionalNotificationCategory, boolean>;
}) {
  const [state, formAction, pending] = useActionState(updateNotificationPreferences, initialState);

  return (
    <form action={formAction} className="bg-surface border border-line rounded-2xl p-6 flex flex-col gap-5">
      {OPTIONAL_NOTIFICATION_CATEGORIES.map((category) => (
        <label key={category} className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name={category}
            defaultChecked={initialValues[category]}
            className="mt-1 w-4 h-4 accent-green-700"
          />
          <span>
            <span className="block font-bold text-sm text-ink-900">{NOTIFICATION_CATEGORY_LABELS[category]}</span>
            <span className="block text-xs text-ink-500 mt-0.5">{NOTIFICATION_CATEGORY_DESCRIPTIONS[category]}</span>
          </span>
        </label>
      ))}

      <p className="text-xs text-ink-500 border-t border-line pt-4">
        Payments and refund/dispute updates are always emailed — they&rsquo;re never optional, since they can need
        your attention. You&rsquo;ll always see every notification in-app here regardless of these settings.
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
