/**
 * The society console's event form (events/new, events/[outingId]/edit):
 * reads the posted fields, checks them the way the app's outing/new.tsx
 * does (same order, same words), and builds save_outing's `p` exactly as
 * the app's saveOuting sends it. The database checks everything again.
 *
 * Pure: tested in events-form.test.ts.
 */

import { addDays, isTrip, type OutingKind } from "./events-trips";
import { compactIban, ibanIsValid, normaliseRevtag } from "./outing-payments";
import { closesLabel, entriesCloseAt, irishToday, parseFee } from "./outing-rules";

export const CLOSE_CHOICES = [0, 2, 3, 5, 7] as const;
export type CloseDays = (typeof CLOSE_CHOICES)[number];

export const closeChoiceLabel = (d: number): string => (d === 0 ? "Midnight before" : d === 7 ? "A week before" : `${d} days before`);

/** How many days before the event an existing close time is (0 = the default, midnight before). The app's rule. */
export function closeDaysFor(playsOn: string, entriesCloseAtIso: string | null): number {
  if (!entriesCloseAtIso) return 0;
  return Math.max(1, Math.round((entriesCloseAt(playsOn).getTime() - new Date(entriesCloseAtIso).getTime()) / 86_400_000) + 1);
}

/** The cents as the box shows them: 6000 → "60", 6050 → "60.50". */
export const feeText = (cents: number | null): string => (cents == null ? "" : (cents / 100).toFixed(cents % 100 ? 2 : 0));

export type SaveOutingP = {
  kind: OutingKind;
  title: string;
  club_id: number | null;
  course_name: string | null;
  plays_on: string;
  ends_on: string | null;
  location: string | null;
  pay_revtag: string | null;
  pay_iban: string | null;
  pay_account_name: string | null;
  pay_cash: boolean;
  pay_note: string | null;
  first_tee: string | null;
  details: string | null;
  entry_fee_cents: number | null;
  max_entries: number | null;
  entry_mode: "join" | "request";
  entries_close_at: string | null;
  waiting_list: boolean;
  auto_offer: boolean;
  guests_allowed: boolean;
  guest_fee_cents: number | null;
  arrive_by: string | null;
  format_label: string | null;
  dress_code: string | null;
  meal_options: string[];
};

/** What the form posted. `club`/`clubName` from the club search, `course` typed free. */
export type EventFields = {
  kind: string | null;
  title: string | null;
  clubId: number | null;
  /** The club's name as the database has it (looked up from clubId, never trusted from the form). */
  clubName: string | null;
  course: string | null;
  playsOn: string | null;
  endsOn: string | null;
  location: string | null;
  firstTee: string | null;
  fee: string | null;
  max: string | null;
  details: string | null;
  entryMode: string | null;
  waitingList: boolean;
  autoOffer: boolean;
  guestsAllowed: boolean;
  guestFee: string | null;
  closeDays: string | null;
  arriveBy: string | null;
  formatLabel: string | null;
  dressCode: string | null;
  meals: string | null;
  revtag: string | null;
  iban: string | null;
  accountName: string | null;
  payCash: boolean;
  payNote: string | null;
};

const t = (s: string | null | undefined): string => (s ?? "").trim();
const isKind = (k: unknown): k is OutingKind => k === "day" || k === "overnight" || k === "abroad";
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const pad = (clock: string): string => (clock.length === 4 ? `0${clock}` : clock);

/** Meal choices from "Beef, Salmon, Vegetarian": trimmed, no blanks, no repeats. */
export const parseMeals = (text: string | null): string[] => [...new Set(t(text).split(",").map((m) => m.trim()).filter(Boolean))];

/**
 * The checks the app makes before saving, then save_outing's `p`.
 * `money`: the member may set payment details (0144); without it the
 * payment fields aren't checked (the database keeps what's there).
 */
export function buildOutingP(f: EventFields, opts: { money: boolean; today?: string; editing?: boolean }): { p: SaveOutingP } | { error: string } {
  const today = opts.today ?? irishToday();
  const kind = isKind(f.kind) ? f.kind : null;
  if (!kind) return { error: "Choose a day out, overnight or abroad." };
  const trip = isTrip(kind);
  const title = t(f.title);
  const course = f.clubId ? t(f.clubName) || null : t(f.course) || null;
  const playsOn = t(f.playsOn);
  const endsOn = t(f.endsOn);
  const fee = parseFee(t(f.fee));
  const maxRaw = t(f.max);
  const max = maxRaw === "" ? null : /^\d{1,3}$/.test(maxRaw) ? Number(maxRaw) : undefined;
  const firstTee = t(f.firstTee);
  const arriveBy = t(f.arriveBy);
  const guestFee = parseFee(t(f.guestFee));
  const meals = parseMeals(f.meals);
  const tag = opts.money ? normaliseRevtag(t(f.revtag)) : null;
  const iban = opts.money ? compactIban(t(f.iban)) : null;
  const accountName = opts.money ? t(f.accountName) : "";
  const closeRaw = Number(t(f.closeDays) || "0");
  // The app offers 0, 2, 3, 5, 7; an existing event may sit on another day count, which is kept.
  const closeDays = Number.isInteger(closeRaw) && closeRaw >= 0 && closeRaw <= 60 ? closeRaw : null;
  const entryMode = f.entryMode === "request" ? "request" : f.entryMode === "join" || f.entryMode == null ? "join" : null;
  const noun = trip ? "trip" : "outing";

  if (title === "") return { error: `Give the ${noun} a name` };
  if (title.length > 80) return { error: "That name is too long — 80 characters at most" };
  if (!trip && !course) return { error: "Choose the course" };
  if (!isDate(playsOn)) return { error: "Choose the date" };
  if (playsOn < today) return { error: "Choose a date from today on" };
  if (playsOn > addDays(today, 730)) return { error: "Events can be set up to two years ahead" };
  if (trip && !isDate(endsOn)) return { error: "Choose the last day of the trip" };
  if (trip && endsOn <= playsOn) return { error: "The last day is after the first" };
  if (trip && endsOn > addDays(playsOn, 20)) return { error: "A trip is three weeks at most" };
  if (!trip && firstTee !== "" && !CLOCK.test(firstTee)) return { error: "The first tee is a time, like 09:00" };
  if (fee === undefined) return { error: "The cost should be an amount, like 60" };
  if (max === undefined || max === 0) return { error: "Places should be a number" };
  if (tag === undefined) return { error: "The Revolut username is the @name in Revolut, no spaces" };
  if (iban && !ibanIsValid(iban)) return { error: "That IBAN doesn't look right — check the numbers" };
  if (iban && !accountName) return { error: "Add the name on the bank account" };
  if (f.guestsAllowed && guestFee === undefined) return { error: "The guest fee should be an amount, like 80" };
  if (!trip && arriveBy !== "" && !CLOCK.test(arriveBy)) return { error: "Arrive by is a time, like 09:15" };
  if (!trip && (meals.length > 6 || meals.some((m) => m.length > 40))) return { error: "Up to six meals, 40 characters each" };
  if (entryMode == null) return { error: "Choose how members get a place" };
  if (closeDays == null) return { error: "Choose when entries close" };
  if (t(f.location).length > 120) return { error: "That place is too long — 120 characters at most" };
  if (t(f.details).length > 1000) return { error: "The details are too long — 1,000 characters at most" };

  return {
    p: {
      kind,
      title,
      club_id: trip ? null : (f.clubId ?? null),
      course_name: trip ? null : course,
      plays_on: playsOn,
      ends_on: trip ? endsOn : null,
      location: trip ? t(f.location) || null : null,
      pay_revtag: tag ?? null,
      pay_iban: iban,
      pay_account_name: iban ? accountName : null,
      pay_cash: opts.money ? f.payCash : true,
      pay_note: opts.money ? t(f.payNote) || null : null,
      first_tee: trip ? null : firstTee ? pad(firstTee) : null,
      details: t(f.details) || null,
      entry_fee_cents: fee ?? null,
      max_entries: max ?? null,
      entry_mode: entryMode,
      // N days before: midnight at the start of the day N−1 days before.
      entries_close_at: closeDays === 0 ? null : entriesCloseAt(addDays(playsOn, -(closeDays - 1))).toISOString(),
      waiting_list: f.waitingList,
      auto_offer: f.autoOffer,
      guests_allowed: f.guestsAllowed,
      guest_fee_cents: f.guestsAllowed ? (guestFee ?? null) : null,
      arrive_by: trip ? null : arriveBy ? pad(arriveBy) : null,
      format_label: trip ? null : t(f.formatLabel).slice(0, 60) || null,
      dress_code: t(f.dressCode).slice(0, 200) || null,
      meal_options: trip ? [] : meals,
    },
  };
}

const closeTime = (at: Date): string =>
  at.toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Europe/Dublin" });

/** Are entries still open: before the event's own close time, else midnight before the day. */
export function entriesStillOpen(playsOn: string, entriesCloseAtIso: string | null, now: Date = new Date()): boolean {
  return entriesCloseAtIso ? now.getTime() < new Date(entriesCloseAtIso).getTime() : now.getTime() < entriesCloseAt(playsOn).getTime();
}

/** "Entries close Wed 18 Nov, 00:00" for an event closing early; the app's closesLabel for the default. */
export function closesText(playsOn: string, entriesCloseAtIso: string | null, now: Date = new Date()): string {
  if (!entriesCloseAtIso) return closesLabel(playsOn, now);
  const at = new Date(entriesCloseAtIso);
  return now.getTime() < at.getTime() ? `Entries close ${closeTime(at)}` : "Entries closed";
}

/** The same, from the form's "N days before" choice. */
export function closesTextFor(playsOn: string, closeDays: number, now: Date = new Date()): string {
  return closesText(playsOn, closeDays === 0 ? null : entriesCloseAt(addDays(playsOn, -(closeDays - 1))).toISOString(), now);
}
