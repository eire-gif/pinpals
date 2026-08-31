"use client";

import { useState, useTransition } from "react";
import type { MyTeeTimeRequest } from "@/lib/types";
import {
  INTEREST_STATUS_LABELS,
  INTEREST_STATUS_STYLES,
  formatClock,
  formatInviteDate,
  formatTimeRange,
} from "@/lib/tee-times";
import { confirmTeeTimePlace } from "./availability/actions";

export default function MyTeeTimeRequests({ requests }: { requests: MyTeeTimeRequest[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function respond(requestId: number, attending: boolean) {
    setBusyId(requestId);
    setError(null);
    startTransition(async () => {
      const result = await confirmTeeTimePlace(requestId, attending);
      setError(result.error ?? null);
      setBusyId(null);
    });
  }

  if (requests.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-6 text-sm text-ink-500">
        You haven&rsquo;t requested a place on a tee time yet. Browse tee-time invites to find a round.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {error && <p className="rounded-xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}
      {requests.map((request) => {
        const invite = request.tee_time_invites;
        if (!invite) return null;
        const exactTime = formatClock(invite.exact_tee_time);
        const time = exactTime ?? formatTimeRange(invite.time_from, invite.time_to);
        const isBusy = pending && busyId === request.id;

        return (
          <article key={request.id} className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-display font-bold text-lg">{invite.club_name}</h3>
                <p className="text-sm text-ink-500 mt-1">
                  {formatInviteDate(invite.play_date)}{time ? ` · ${time}` : ""}
                </p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${INTEREST_STATUS_STYLES[request.status]}`}>
                {INTEREST_STATUS_LABELS[request.status]}
              </span>
            </div>

            {request.status === "pending" && (
              <p className="mt-4 text-sm text-ink-500">The host is reviewing your request.</p>
            )}

            {request.status === "accepted" && (
              <div className="mt-4 rounded-xl border border-green-200 bg-green-100 p-4">
                <p className="text-sm font-bold text-green-800">The host has offered you a place.</p>
                <p className="text-xs text-green-800/80 mt-1">Confirm that you&rsquo;re attending so both golfers know the round is arranged.</p>
                <div className="flex gap-2.5 mt-3">
                  <button onClick={() => respond(request.id, true)} disabled={pending} className="flex-1 py-2.5 rounded-full font-bold text-xs bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-50">
                    {isBusy ? "Saving…" : "Confirm my place"}
                  </button>
                  <button onClick={() => respond(request.id, false)} disabled={pending} className="flex-1 py-2.5 rounded-full font-bold text-xs border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 transition disabled:opacity-50">
                    {isBusy ? "Saving…" : "I can't make it"}
                  </button>
                </div>
              </div>
            )}

            {request.status === "confirmed" && (
              <p className="mt-4 rounded-xl bg-green-700 px-4 py-3 text-sm font-semibold text-cream-50">
                You&rsquo;re confirmed for this tee time.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

