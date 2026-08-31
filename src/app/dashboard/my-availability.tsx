"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { TeeTimeInvite } from "@/lib/types";
import { STATUS_LABELS, STATUS_STYLES, formatInviteDate, formatTimeRange } from "@/lib/tee-times";
import { updateInviteStatus, deleteInvite } from "./availability/actions";

export default function MyAvailability({ invites }: { invites: TeeTimeInvite[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);

  function toggleFull(invite: TeeTimeInvite) {
    setBusyId(invite.id);
    startTransition(async () => {
      await updateInviteStatus(invite.id, invite.status === "full" ? "open" : "full");
      setBusyId(null);
    });
  }

  function cancel(invite: TeeTimeInvite) {
    setBusyId(invite.id);
    startTransition(async () => {
      await updateInviteStatus(invite.id, "cancelled");
      setBusyId(null);
    });
  }

  function remove(invite: TeeTimeInvite) {
    setBusyId(invite.id);
    startTransition(async () => {
      await deleteInvite(invite.id);
      setBusyId(null);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display font-bold text-xl">My availability</h2>
        <Link
          href="/dashboard/availability/new"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition"
        >
          + Post availability
        </Link>
      </div>

      {invites.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl p-6 text-sm text-ink-500">
          You don&rsquo;t have any open tee-time invites. Post your availability so other
          Pinpals members can join you for a round.
        </div>
      ) : (
        <div className="grid gap-4">
          {invites.map((invite) => {
            const isBusy = pending && busyId === invite.id;
            const timeRange = formatTimeRange(invite.time_from, invite.time_to);
            return (
              <div key={invite.id} className="bg-surface border border-line rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-display font-bold text-lg">{invite.club_name}</h3>
                    <p className="text-sm text-ink-500 mt-0.5">
                      {formatInviteDate(invite.play_date)}
                      {timeRange ? ` · ${timeRange}` : ""}
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[invite.status]}`}>
                    {STATUS_LABELS[invite.status]}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                    {invite.spaces_available} {invite.spaces_available === 1 ? "space" : "spaces"}
                  </span>
                  {invite.handicap_limit != null && (
                    <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                      Up to {invite.handicap_limit} hcp
                    </span>
                  )}
                </div>

                {invite.notes && <p className="text-sm text-ink-700 mt-3">{invite.notes}</p>}

                <div className="flex gap-2.5 mt-4 flex-wrap">
                  <button
                    onClick={() => toggleFull(invite)}
                    disabled={pending}
                    className="px-4 py-2 rounded-full font-bold text-xs border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition disabled:opacity-50"
                  >
                    {isBusy ? "Updating…" : invite.status === "full" ? "Mark open" : "Mark full"}
                  </button>
                  <button
                    onClick={() => cancel(invite)}
                    disabled={pending}
                    className="px-4 py-2 rounded-full font-bold text-xs border-[1.5px] border-line text-ink-500 hover:bg-cream-100 transition disabled:opacity-50"
                  >
                    Cancel invite
                  </button>
                  <button
                    onClick={() => remove(invite)}
                    disabled={pending}
                    className="px-4 py-2 rounded-full font-bold text-xs border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 transition disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
