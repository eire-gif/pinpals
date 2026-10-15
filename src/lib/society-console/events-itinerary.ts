/**
 * A trip itinerary item for the console: the app's item.tsx checks and
 * save_outing_item's `p`, and who's on it for set_outing_item_people.
 * Pure: tested in events-itinerary.test.ts.
 */

import { checkOutDate, FORMAT_LABELS, type ItemKind, type PlayFormat } from "./events-trips";

export const ITEM_KINDS: ItemKind[] = ["round", "flight", "stay", "transfer", "meal", "note"];
export const GAPS = [8, 9, 10, 12];

/** Who goes on what: a group or room each (round, stay), on or off (flight, transfer), nobody (meal, note). */
export const placement = (kind: ItemKind): "slots" | "list" | "none" => (kind === "round" || kind === "stay" ? "slots" : kind === "flight" || kind === "transfer" ? "list" : "none");

export type ItemP = {
  on_date: string;
  kind: ItemKind;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  details: string | null;
  club_id: number | null;
  from_place: string | null;
  to_place: string | null;
  carrier: string | null;
  nights: number | null;
  tee_interval: number | null;
  play_format: PlayFormat | null;
};

export type ItemFields = {
  kind: string | null;
  onDate: string | null;
  title: string | null;
  clubId: number | null;
  clubName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  fromPlace: string | null;
  toPlace: string | null;
  carrier: string | null;
  nights: string | null;
  gap: string | null;
  format: string | null;
  details: string | null;
};

const t = (s: string | null | undefined) => (s ?? "").trim();
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const isKind = (k: unknown): k is ItemKind => typeof k === "string" && (ITEM_KINDS as string[]).includes(k);
const isFormat = (f: unknown): f is PlayFormat => typeof f === "string" && f in FORMAT_LABELS;

export function buildItemP(f: ItemFields, trip: { playsOn: string; endsOn: string }): { p: ItemP } | { error: string } {
  if (!isKind(f.kind)) return { error: "Choose what to add." };
  const kind = f.kind;
  const onDate = t(f.onDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate) || onDate < trip.playsOn || onDate > trip.endsOn) return { error: "Choose a day of the trip." };
  const title = kind === "round" ? t(f.clubName) || t(f.title) : t(f.title);
  if (title === "") return { error: kind === "round" ? "Choose the course." : kind === "stay" ? "Name the hotel or house." : kind === "flight" ? "Name the flight, e.g. Outbound." : "Give it a name." };
  if (title.length > 120) return { error: "That name is too long — 120 characters at most." };
  const from = t(f.fromPlace);
  const to = t(f.toPlace);
  if (kind === "flight" && (!from || !to)) return { error: "Say where the flight is from and to." };
  if (from.length > 60 || to.length > 60) return { error: "A place name is too long — 60 characters at most." };
  const start = t(f.startsAt);
  const end = t(f.endsAt);
  if ((start && !CLOCK.test(start)) || (end && !CLOCK.test(end))) return { error: "A time doesn't look right." };
  const nights = Number(t(f.nights) || "1");
  if (kind === "stay" && (!Number.isInteger(nights) || nights < 1 || nights > 30)) return { error: "A stay is 1 to 30 nights." };
  if (kind === "stay" && checkOutDate(onDate, nights) > checkOutDate(trip.endsOn, 1)) return { error: "That stay runs past the end of the trip." };
  const gap = Number(t(f.gap) || "10");
  if (kind === "round" && (!Number.isInteger(gap) || gap < 5 || gap > 20)) return { error: "Groups go off 5 to 20 minutes apart." };
  const format = t(f.format);
  if (kind === "round" && format && !isFormat(format)) return { error: "Choose a format." };
  const carrier = t(f.carrier);
  if (carrier.length > 60) return { error: "That is too long — 60 characters at most." };
  const details = t(f.details);
  if (details.length > 1000) return { error: "The notes are too long — 1,000 characters at most." };
  const travel = kind === "flight" || kind === "transfer";
  return {
    p: {
      on_date: onDate,
      kind,
      title,
      starts_at: kind === "stay" ? null : start || null,
      ends_at: travel ? end || null : null,
      details: details || null,
      club_id: kind === "round" ? f.clubId : null,
      from_place: travel ? from || null : null,
      to_place: travel ? to || null : null,
      carrier: travel ? carrier || null : null,
      nights: kind === "stay" ? nights : null,
      tee_interval: kind === "round" ? gap : null,
      play_format: kind === "round" && isFormat(format) ? format : null,
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who's on an item, posted as JSON [{ member, slot }] in the app's order.
 * `people: null` means leave it (a meal or note has nobody).
 */
export function parseItemPeople(raw: string | null, kind: ItemKind): { people: { member: string; slot: number | null }[] | null } | { error: string } {
  const place = placement(kind);
  if (place === "none") return { people: null };
  if (raw == null) return { people: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "That list doesn't look right." };
  }
  if (!Array.isArray(value) || value.length > 500) return { error: "That list doesn't look right." };
  const seen = new Set<string>();
  const out: { member: string; slot: number | null }[] = [];
  const counts = new Map<number, number>();
  for (const v of value) {
    const m = (v as { member?: unknown })?.member;
    const s = (v as { slot?: unknown })?.slot;
    if (typeof m !== "string" || !UUID.test(m) || seen.has(m)) return { error: "That list doesn't look right." };
    seen.add(m);
    if (place === "slots") {
      if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > 60) return { error: kind === "round" ? "Put everyone in a group." : "Put everyone in a room." };
      counts.set(s, (counts.get(s) ?? 0) + 1);
      if ((counts.get(s) ?? 0) > 8) return { error: kind === "round" ? "A group has 8 players at most." : "A room has 8 people at most." };
      out.push({ member: m, slot: s });
    } else out.push({ member: m, slot: null });
  }
  return { people: out.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)) };
}
