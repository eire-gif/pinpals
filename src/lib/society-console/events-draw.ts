/**
 * The console's event draw — glue around group-draw.ts (the app's rules):
 * who's playing, a published draw read back, and the publish payload.
 * Pure: tested in events-draw.test.ts.
 *
 * Keys follow the app: "m:<member id>" for a member, "g:<guest id>" for a
 * guest on the event (0131) — the same keys loadDrawHistory and the
 * wishes use.
 */

import type { DrawPlayer } from "./group-draw";

export type Seat = { key: string; name: string; index: number | null; guest: boolean; group: number | null; position: number | null; time: string | null };

/** The draw's first tee and gap, read from a published draw ("09:00", 10). */
export function publishedTiming(seats: readonly Seat[], gaps: readonly number[]): { first: string | null; gap: number | null } {
  const at = (n: number) => seats.find((s) => s.group === n && s.time)?.time?.slice(0, 5) ?? null;
  const first = at(1);
  const second = at(2);
  if (!first || !second) return { first, gap: null };
  const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  const g = mins(second) - mins(first);
  return { first, gap: gaps.includes(g) ? g : null };
}

/** A published draw back as groups in tee order, each in position order. */
export function publishedGroups<T extends Pick<Seat, "group" | "position">>(seats: readonly T[]): T[][] {
  const by = new Map<number, T[]>();
  for (const s of seats) if (s.group) by.set(s.group, [...(by.get(s.group) ?? []), s]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
}

/** The tee time each group has in a published draw. */
export function publishedTimes(seats: readonly Seat[], groups: number): string[] {
  return Array.from({ length: groups }, (_, i) => seats.find((s) => s.group === i + 1 && s.time)?.time?.slice(0, 5) ?? "");
}

export type DrawGroupPayload = { tee_time: string | null; members: (string | { guest: number })[] };

/** publish_outing_draw's p_groups, from groups of keyed players and their times. */
export function drawPayload(groups: readonly (readonly Pick<DrawPlayer, "key">[])[], times: readonly string[]): DrawGroupPayload[] {
  return groups.map((g, i) => ({
    tee_time: times[i] || null,
    members: g.map((p) => (p.key.startsWith("g:") ? { guest: Number(p.key.slice(2)) } : p.key.slice(2))),
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Checks a posted payload's shape before it goes to the database (which checks it again). */
export function parseDrawGroups(raw: string): { groups: DrawGroupPayload[] } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "That draw doesn't look right." };
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 60) return { error: "Make the draw first." };
  const out: DrawGroupPayload[] = [];
  const seen = new Set<string>();
  for (const g of value) {
    if (!g || typeof g !== "object") return { error: "That draw doesn't look right." };
    const { tee_time, members } = g as { tee_time?: unknown; members?: unknown };
    if (tee_time != null && (typeof tee_time !== "string" || !CLOCK.test(tee_time))) return { error: "A tee time doesn't look right." };
    if (!Array.isArray(members) || members.length < 1 || members.length > 8) return { error: "Each group has between 1 and 8 players." };
    const list: DrawGroupPayload["members"] = [];
    for (const m of members) {
      if (typeof m === "string" && UUID.test(m)) {
        if (seen.has(`m:${m}`)) return { error: "Someone is in two groups." };
        seen.add(`m:${m}`);
        list.push(m);
      } else if (m && typeof m === "object" && Number.isInteger((m as { guest?: unknown }).guest) && (m as { guest: number }).guest > 0) {
        const id = (m as { guest: number }).guest;
        if (seen.has(`g:${id}`)) return { error: "Someone is in two groups." };
        seen.add(`g:${id}`);
        list.push({ guest: id });
      } else return { error: "That draw doesn't look right." };
    }
    out.push({ tee_time: (tee_time as string | null | undefined) || null, members: list });
  }
  return { groups: out };
}
