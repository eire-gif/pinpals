"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { SIGNUP_DOCUMENTS, formatEffectiveDate } from "@/lib/legal";
import LegalDocumentView, { LegalKeyPoints } from "@/components/legal-document";

/**
 * The sign-up agreement dialog.
 *
 * ============ Why the ticks are in here and not on the form ============
 *
 * A checkbox sitting next to a link nobody opens is the weakest possible
 * evidence that terms were brought to a member's attention, and under the
 * unfair terms rules that matters: a clause the member had no realistic
 * chance of reading is a clause a court can strike out. So the flow is
 * deliberately one step longer than it needs to be — the member opens the
 * agreement, the full text is right there above the ticks, and they tick
 * inside it.
 *
 * ============ Why marketing is NOT in here ============
 *
 * Consent to marketing must be freely given, specific, and separate from
 * accepting the contract (Art. 7(2) and (4) GDPR; S.I. 336/2011 for the
 * email itself). Putting the newsletter tick beside the three mandatory
 * ones — even unticked — is exactly the bundling that makes such consent
 * invalid, because the member cannot tell which ticks are the price of an
 * account and which are optional. It lives on the sign-up form instead,
 * visually separate, unticked, and refusable with no consequence.
 *
 * ============ What this dialog does not do ============
 *
 * It does not require the member to scroll every document to the bottom
 * before the ticks unlock. That pattern trains people to hunt for the
 * scroll-to-end trick rather than read, and adds nothing legally over
 * presenting the text plainly. The tick is the consent; the record of
 * exactly which version was on screen is written server-side.
 */

export type ConsentDecision = {
  agreedToDocuments: boolean;
  readPrivacy: boolean;
  confirmedAge: boolean;
};

export const NO_CONSENT: ConsentDecision = {
  agreedToDocuments: false,
  readPrivacy: false,
  confirmedAge: false,
};

export function consentIsComplete(decision: ConsentDecision): boolean {
  return decision.agreedToDocuments && decision.readPrivacy && decision.confirmedAge;
}

const AGREEMENT_DOCS = SIGNUP_DOCUMENTS.filter((doc) => doc.slug !== "privacy");
const PRIVACY_DOC = SIGNUP_DOCUMENTS.find((doc) => doc.slug === "privacy");

/**
 * Rendered only while open — the parent mounts and unmounts it rather than
 * passing an `open` prop. That is what makes `useState(initial)` below
 * correct: each opening is a fresh mount, so the ticks start from whatever
 * the form actually holds, and cancelling out discards the rest. Keeping
 * the component mounted and re-syncing state in an effect would do the
 * same thing with an extra render and a lint error to suppress.
 */
export default function ConsentModal({
  initial,
  onCancel,
  onAgree,
}: {
  initial: ConsentDecision;
  onCancel: () => void;
  onAgree: (decision: ConsentDecision) => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeSlug, setActiveSlug] = useState<string>(SIGNUP_DOCUMENTS[0]?.slug ?? "terms");
  const [decision, setDecision] = useState<ConsentDecision>(initial);

  // Escape closes, and the page behind stops scrolling. Both restored on
  // unmount, which is what stops a stuck `overflow: hidden` if the member
  // navigates away with the dialog open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  const activeDoc = SIGNUP_DOCUMENTS.find((doc) => doc.slug === activeSlug) ?? SIGNUP_DOCUMENTS[0];
  const complete = consentIsComplete(decision);

  const tick = (key: keyof ConsentDecision) => (event: ChangeEvent<HTMLInputElement>) =>
    setDecision((current) => ({ ...current, [key]: event.target.checked }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-navy-900/70 p-0 sm:p-6"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="bg-surface w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh] outline-none"
      >
        {/* Header */}
        <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-line shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="font-display font-bold text-2xl">
                Before you join
              </h2>
              <p className="text-sm text-ink-500 mt-1">
                Please read these and tick the boxes at the bottom to continue.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="shrink-0 w-9 h-9 rounded-full text-ink-500 hover:bg-cream-50 hover:text-ink-900 transition text-xl leading-none"
            >
              &times;
            </button>
          </div>

          {/* Document tabs */}
          <div className="flex flex-wrap gap-1.5 mt-4" role="tablist" aria-label="Pinpals agreements">
            {SIGNUP_DOCUMENTS.map((doc) => {
              const isActive = doc.slug === activeDoc.slug;
              return (
                <button
                  key={doc.slug}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveSlug(doc.slug)}
                  className={`px-3.5 py-2 rounded-full text-[13px] font-bold transition ${
                    isActive
                      ? "bg-green-700 text-cream-50"
                      : "bg-cream-50 text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {doc.shortTitle}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrolling document body */}
        <div className="overflow-y-auto px-6 sm:px-8 py-6 grow">
          <p className="text-xs text-ink-500 mb-5">
            {activeDoc.title} &middot; version {activeDoc.version} &middot; in effect from{" "}
            {formatEffectiveDate(activeDoc.effectiveFrom)}
          </p>
          <LegalKeyPoints document={activeDoc} />
          <div className="mt-7">
            <LegalDocumentView document={activeDoc} showHeading={false} />
          </div>
        </div>

        {/* Ticks and confirmation */}
        <div className="border-t border-line px-6 sm:px-8 py-5 shrink-0 bg-surface-tint sm:rounded-b-2xl">
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={decision.agreedToDocuments}
                onChange={tick("agreedToDocuments")}
                className="mt-0.5 w-4 h-4 accent-green-700 shrink-0"
              />
              <span className="text-sm leading-snug">
                I have read and agree to the{" "}
                {AGREEMENT_DOCS.map((doc, i) => (
                  <span key={doc.slug}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        setActiveSlug(doc.slug);
                      }}
                      className="font-bold text-green-700 underline underline-offset-2"
                    >
                      {doc.shortTitle}
                    </button>
                    {i < AGREEMENT_DOCS.length - 2 ? ", " : i === AGREEMENT_DOCS.length - 2 ? " and " : ""}
                  </span>
                ))}
                .
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={decision.readPrivacy}
                onChange={tick("readPrivacy")}
                className="mt-0.5 w-4 h-4 accent-green-700 shrink-0"
              />
              {/* "I have read", not "I consent to the processing of my data".
                  Most of what Pinpals does with personal data runs on contract
                  and legitimate interests, not consent — asking for consent to
                  it would misdescribe the legal basis and imply a withdrawal
                  right that does not exist for it. This tick acknowledges the
                  Art. 13 notice, which is what it actually is. */}
              <span className="text-sm leading-snug">
                I have read the{" "}
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    if (PRIVACY_DOC) setActiveSlug(PRIVACY_DOC.slug);
                  }}
                  className="font-bold text-green-700 underline underline-offset-2"
                >
                  Privacy Policy
                </button>{" "}
                and understand how Pinpals uses my information.
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={decision.confirmedAge}
                onChange={tick("confirmedAge")}
                className="mt-0.5 w-4 h-4 accent-green-700 shrink-0"
              />
              <span className="text-sm leading-snug">I confirm that I am 18 or over.</span>
            </label>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 mt-5">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-3 rounded-full font-bold text-sm text-ink-500 hover:text-ink-900 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!complete}
              onClick={() => onAgree(decision)}
              className="px-6 py-3 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {complete ? "Agree and continue" : "Tick all three to continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
