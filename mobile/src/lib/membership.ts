import { useCallback, useEffect, useState } from "react";

import { isOn } from "./features";
import { DEFAULT_MEMBERSHIP, gateFor, parseFeatureAccess, parseMembership, type FeatureAccess, type Membership } from "./membership-rules";
import { supabase } from "./supabase";

/**
 * Memberships (claude/memberships.md, needs 0156). Reads my level and the
 * feature-access answer from the database and keeps the last answer for
 * five minutes, so a screen asking "can I show GPS?" costs nothing.
 *
 * With the `memberships` flag off nothing is fetched and every feature is
 * allowed — the same as the database says while paid plans are switched off
 * in /admin/monetisation. Errors fail open (see membership-rules.ts).
 */

const FRESH_MS = 5 * 60 * 1000;

type Snapshot = { membership: Membership; access: Record<string, FeatureAccess> | null; at: number };

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;
const listeners = new Set<(s: Snapshot) => void>();

async function fetchSnapshot(): Promise<Snapshot> {
  const [m, a] = await Promise.all([supabase.rpc("my_membership"), supabase.rpc("my_feature_access")]);
  const row = Array.isArray(m.data) ? (m.data[0] as Record<string, unknown> | undefined) : null;
  return {
    membership: m.error ? DEFAULT_MEMBERSHIP : parseMembership(row),
    access: a.error ? null : parseFeatureAccess(a.data),
    at: Date.now(),
  };
}

/** The current answer, fetched if stale. Pass `force` after a purchase. */
export async function loadMembership(force = false): Promise<Snapshot> {
  if (!isOn("memberships")) return { membership: DEFAULT_MEMBERSHIP, access: null, at: Date.now() };
  if (!force && cache && Date.now() - cache.at < FRESH_MS) return cache;
  if (!inflight) {
    inflight = fetchSnapshot()
      .then((s) => {
        cache = s;
        listeners.forEach((l) => l(s));
        return s;
      })
      .catch(() => cache ?? { membership: DEFAULT_MEMBERSHIP, access: null, at: Date.now() })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Forget the answer — on sign-out, so the next member doesn't inherit it. */
export function clearMembership(): void {
  cache = null;
}

/** My membership and a gate for any feature, kept up to date across screens. */
export function useMembership() {
  const [snap, setSnap] = useState<Snapshot | null>(cache);

  useEffect(() => {
    const l = (s: Snapshot) => setSnap(s);
    listeners.add(l);
    void loadMembership().then(setSnap);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const refresh = useCallback(() => loadMembership(true).then(setSnap), []);
  const gate = useCallback((key: string) => (isOn("memberships") ? gateFor(snap?.access ?? null, key) : "show"), [snap]);

  return { membership: snap?.membership ?? DEFAULT_MEMBERSHIP, loaded: !!snap, gate, refresh };
}
