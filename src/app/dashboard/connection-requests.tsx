"use client";

import { useState, useTransition } from "react";
import { initials } from "@/lib/format";
import type { ConnectionWithProfiles } from "@/lib/types";
import { respondToConnection } from "@/app/connections/actions";

export default function ConnectionRequests({ requests }: { requests: ConnectionWithProfiles[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);

  function respond(id: number, accept: boolean) {
    setBusyId(id);
    startTransition(async () => {
      await respondToConnection(id, accept);
      setBusyId(null);
    });
  }

  if (requests.length === 0) {
    return <p className="bg-surface border border-line rounded-2xl p-5 text-sm text-ink-500">You have no connection requests waiting.</p>;
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {requests.map((request) => {
        const person = request.requester;
        const name = person ? `${person.first_name} ${person.last_name}` : "A Pinpals member";
        const busy = pending && busyId === request.id;
        return (
          <div key={request.id} className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-display font-bold text-sm" style={{ background: person?.avatar_color ?? "#1f5c2e" }}>
                {initials(name)}
              </div>
              <div>
                <h3 className="font-display font-bold">{name}</h3>
                <p className="text-xs text-ink-500">{person?.home_club ?? "No home club listed"}</p>
              </div>
            </div>
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => respond(request.id, true)} disabled={pending} className="flex-1 py-2.5 rounded-full font-bold text-xs bg-green-700 text-cream-50 hover:bg-green-600 disabled:opacity-50">
                {busy ? "Saving…" : "Accept"}
              </button>
              <button onClick={() => respond(request.id, false)} disabled={pending} className="flex-1 py-2.5 rounded-full font-bold text-xs border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 disabled:opacity-50">
                {busy ? "Saving…" : "Reject"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

