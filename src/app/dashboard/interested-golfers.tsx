"use client";

import { useState, useTransition } from "react";
import type { InterestWithDetails } from "@/lib/types";
import { INTEREST_STATUS_LABELS, INTEREST_STATUS_STYLES, formatInviteDate } from "@/lib/tee-times";
import { initials } from "@/lib/format";
import { respondToInterest } from "./availability/actions";

export default function InterestedGolfers({ interests }: { interests: InterestWithDetails[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);

  function respond(interestId: number, accept: boolean) {
    setBusyId(interestId);
    startTransition(async () => {
      await respondToInterest(interestId, accept);
      setBusyId(null);
    });
  }

  if (interests.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-6 text-sm text-ink-500">
        No one has expressed interest in your availability yet — once someone does, you&rsquo;ll be
        able to accept or decline them here.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {interests.map((interest) => {
        const applicant = interest.profiles;
        const invite = interest.tee_time_invites;
        const name = applicant?.first_name ?? "A Pinpals member";
        const isBusy = pending && busyId === interest.id;

        return (
          <div key={interest.id} className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-display font-bold text-xs shrink-0"
                  style={{ background: applicant?.avatar_color ?? "#1f5c2e" }}
                >
                  {initials(name)}
                </div>
                <div>
                  <p className="font-bold text-sm">{name}</p>
                  <p className="text-xs text-ink-500">
                    {applicant?.home_club ?? "No home club listed"}
                    {applicant?.handicap_visible && applicant?.handicap != null
                      ? ` · ${applicant.handicap} hcp`
                      : ""}
                  </p>
                </div>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${INTEREST_STATUS_STYLES[interest.status]}`}>
                {INTEREST_STATUS_LABELS[interest.status]}
              </span>
            </div>

            {invite && (
              <p className="text-xs text-ink-500 mt-3">
                Wants to join you at <span className="font-semibold text-ink-900">{invite.club_name}</span>
                {" "}on {formatInviteDate(invite.play_date)}
              </p>
            )}

            {interest.status === "pending" && (
              <div className="flex gap-2.5 mt-4">
                <button
                  onClick={() => respond(interest.id, true)}
                  disabled={pending}
                  className="flex-1 py-2.5 rounded-full font-bold text-xs bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-50"
                >
                  {isBusy ? "Accepting…" : "Accept"}
                </button>
                <button
                  onClick={() => respond(interest.id, false)}
                  disabled={pending}
                  className="flex-1 py-2.5 rounded-full font-bold text-xs border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 transition disabled:opacity-50"
                >
                  {isBusy ? "Declining…" : "Decline"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
