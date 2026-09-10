"use client";

import { useActionState, useState } from "react";
import { PHONE_REGIONS, type PhoneRegion } from "@/lib/phone";
import {
  acceptCurrentDocuments,
  updateMarketingConsent,
  updatePhoneNumber,
  type LegalCentreState,
} from "./actions";

const initialState: LegalCentreState = {};

const inputClass =
  "px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface focus:outline-none focus:border-green-600";

function Feedback({ state }: { state: LegalCentreState }) {
  if (state.error) {
    return <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>;
  }
  if (state.success) {
    return <p className="text-sm text-green-700 bg-green-100 rounded-lg px-3.5 py-2.5">{state.success}</p>;
  }
  return null;
}

/** Shown only when something is actually out of date — see the page for how that's decided. */
export function ReacceptForm({ outstandingCount }: { outstandingCount: number }) {
  const [state, formAction, pending] = useActionState(acceptCurrentDocuments, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending
          ? "Recording…"
          : outstandingCount === 1
            ? "I've read it — accept the new version"
            : "I've read them — accept the new versions"}
      </button>
    </form>
  );
}

export function MarketingConsentForm({ subscribed }: { subscribed: boolean }) {
  const [state, formAction, pending] = useActionState(updateMarketingConsent, initialState);
  // Controlled so the switch reflects the member's click immediately rather
  // than snapping back while the action is in flight.
  const [checked, setChecked] = useState(subscribed);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          name="marketingEmail"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-0.5 w-4 h-4 accent-green-700 shrink-0"
        />
        <span className="text-sm leading-snug">
          Email me the weekly Pinpals golf digest.
          <span className="block text-xs text-ink-500 mt-0.5">
            Golf news and what&rsquo;s happening on Pinpals, once a week. Turning this off stops it
            immediately.
          </span>
        </span>
      </label>

      <Feedback state={state} />

      <button
        type="submit"
        disabled={pending || checked === subscribed}
        className="self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : checked === subscribed ? "Saved" : "Save"}
      </button>
    </form>
  );
}

export function PhoneNumberForm({
  currentNumber,
  displayNumber,
}: {
  currentNumber: string | null;
  displayNumber: string;
}) {
  const [state, formAction, pending] = useActionState(updatePhoneNumber, initialState);
  const [region, setRegion] = useState<PhoneRegion>(
    currentNumber?.startsWith("+44") ? "GB" : currentNumber && !currentNumber.startsWith("+353") ? "INT" : "IE"
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <select
          name="phoneRegion"
          aria-label="Phone number country"
          value={region}
          onChange={(event) => setRegion(event.target.value as PhoneRegion)}
          className={`${inputClass} w-[46%] sm:w-[40%]`}
        >
          {PHONE_REGIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={displayNumber}
          placeholder="Leave blank to remove"
          className={`${inputClass} flex-1 min-w-0`}
        />
      </div>

      <Feedback state={state} />

      <button
        type="submit"
        disabled={pending}
        className="self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : currentNumber ? "Update number" : "Save number"}
      </button>
    </form>
  );
}
