"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { PHONE_REGIONS, type PhoneRegion } from "@/lib/phone";
import { REFERRAL_SOURCES } from "@/lib/consent";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from "@/lib/passwords";
import ConsentModal, {
  NO_CONSENT,
  consentIsComplete,
  type ConsentDecision,
} from "./consent-modal";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = {};

const inputClass =
  "px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface focus:outline-none focus:border-green-600";

export default function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);
  const [consent, setConsent] = useState<ConsentDecision>(NO_CONSENT);
  const [modalOpen, setModalOpen] = useState(false);
  const [phoneRegion, setPhoneRegion] = useState<PhoneRegion>("IE");

  if (state.success) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 flex items-center justify-center mx-auto mb-4">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 7l9 6 9-6" />
            <path d="M21 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
        <h2 className="font-display font-bold text-2xl mb-2">Check your inbox</h2>
        <p className="text-ink-500">
          We&rsquo;ve sent a confirmation link. Click it to activate your account and set up your
          home club and handicap.
        </p>
      </div>
    );
  }

  const agreed = consentIsComplete(consent);

  return (
    <>
      <form action={formAction} className="grid gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="first" className="text-[13.5px] font-bold">First name</label>
            <input id="first" name="first" required autoComplete="given-name" className={inputClass} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="last" className="text-[13.5px] font-bold">Last name</label>
            <input id="last" name="last" required autoComplete="family-name" className={inputClass} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="email" className="text-[13.5px] font-bold">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="password" className="text-[13.5px] font-bold">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className={inputClass}
          />
          <span className="text-xs text-ink-500">{PASSWORD_HINT}</span>
        </div>

        {/* ============ Phone: optional, and private ============
            Optional because nothing on Pinpals needs it to work, and asking
            for data you don't need is both a conversion cost and a data
            minimisation problem. The note below is not reassurance copy —
            it's the literal behaviour of the schema (0074 keeps it in an
            owner-read-only table with no mechanism to release it). If that
            ever changes, this sentence has to change first. */}
        <div className="grid gap-1.5">
          <label htmlFor="phone" className="text-[13.5px] font-bold">
            Mobile number <span className="font-normal text-ink-500">— optional</span>
          </label>
          <div className="flex gap-2">
            <select
              name="phoneRegion"
              aria-label="Phone number country"
              value={phoneRegion}
              onChange={(event) => setPhoneRegion(event.target.value as PhoneRegion)}
              className={`${inputClass} w-[46%] sm:w-[44%]`}
            >
              {PHONE_REGIONS.map((region) => (
                <option key={region.value} value={region.value}>
                  {region.label}
                </option>
              ))}
            </select>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder={phoneRegion === "IE" ? "087 123 4567" : phoneRegion === "GB" ? "07700 900123" : "+33 6 12 34 56 78"}
              className={`${inputClass} flex-1 min-w-0`}
            />
          </div>
          <span className="text-xs text-ink-500">
            Never shown to other members. We&rsquo;d only use it to reach you about your account.
          </span>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="referral" className="text-[13.5px] font-bold">
            How did you hear about us? <span className="font-normal text-ink-500">— optional</span>
          </label>
          <select id="referral" name="referral" defaultValue="" className={inputClass}>
            <option value="">Prefer not to say</option>
            {REFERRAL_SOURCES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </div>

        {/* ============ The agreement ============ */}
        <div
          className={`rounded-xl border-[1.5px] p-4 mt-1 transition ${
            agreed ? "border-green-600 bg-green-100/50" : "border-line bg-surface-tint"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold ${
                agreed ? "bg-green-700 text-cream-50" : "bg-line text-ink-500"
              }`}
            >
              {agreed ? "✓" : "!"}
            </span>
            <div className="grow">
              <p className="text-sm font-bold">
                {agreed ? "You've agreed to the Pinpals terms" : "Read and agree to the Pinpals terms"}
              </p>
              <p className="text-xs text-ink-500 mt-1">
                {agreed
                  ? "You can read them again any time from your dashboard."
                  : "Covers how tee times and the marketplace work, what we're responsible for, and how we handle your data."}
              </p>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="mt-2.5 text-sm font-bold text-green-700 underline underline-offset-2"
              >
                {agreed ? "Review again" : "Read and agree →"}
              </button>
            </div>
          </div>
        </div>

        {/* Carries the decision into the POST. The server re-derives the
            document versions and hashes itself from the registry and never
            trusts the browser for them — these three only say which boxes
            were ticked. */}
        <input type="hidden" name="agreeDocuments" value={consent.agreedToDocuments ? "1" : ""} />
        <input type="hidden" name="readPrivacy" value={consent.readPrivacy ? "1" : ""} />
        <input type="hidden" name="confirmAge" value={consent.confirmedAge ? "1" : ""} />

        {/* ============ Marketing: separate, unticked, refusable ============
            Physically outside the agreement box above so that no member can
            mistake it for part of the price of an account. See the note at
            the top of consent-modal.tsx. */}
        <label className="flex items-start gap-3 cursor-pointer px-1">
          <input type="checkbox" name="marketingEmail" className="mt-0.5 w-4 h-4 accent-green-700 shrink-0" />
          <span className="text-sm leading-snug">
            Email me the weekly Pinpals golf digest.
            <span className="block text-xs text-ink-500 mt-0.5">
              Optional, and nothing changes if you don&rsquo;t. Unsubscribe in one click, any time.
            </span>
          </span>
        </label>

        {state.error && (
          <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending || !agreed}
          className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Creating your account…" : agreed ? "Create my account" : "Read the terms to continue"}
        </button>

        <p className="text-xs text-ink-500 text-center">
          You can read everything before you decide:{" "}
          <Link href="/legal" className="text-green-700 font-bold underline underline-offset-2">
            our terms and privacy policy
          </Link>
          .
        </p>
      </form>

      {modalOpen && (
        <ConsentModal
          initial={consent}
          onCancel={() => setModalOpen(false)}
          onAgree={(decision) => {
            setConsent(decision);
            setModalOpen(false);
          }}
        />
      )}
    </>
  );
}
