// What each society alert says (0142–0144). Pure, so it is unit tested
// (society-alert-wording.test.ts) and the sender stays small.
//
// The outbox row carries structured facts only (titles, dates, amounts, ids);
// this file turns them into words. A message from the officers is their own
// text: it goes to the Inbox in full, but the lock screen shows only its
// title and who it's from.

import type { NotificationType } from "./notifications";

export type AlertRow = {
  id: number;
  group_id: number;
  outing_id: number | null;
  member_id: string;
  kind: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
};

/** The member's switch in society_alert_prefs that governs a kind; null = always on. */
export const ALERT_PREF: Record<string, string | null> = {
  event_new: "new_event",
  entries_closing: "entries_closing",
  draw_published: "tee_times",
  tee_time_tomorrow: "tee_times",
  payment_due: "payment_reminders",
  membership_due: "payment_reminders",
  notice: "noticeboard",
  // Always on: about your own place, or from the officers to you.
  event_changed: null,
  event_cancelled: null,
  request_received: null,
  place_confirmed: null,
  request_declined: null,
  waitlisted: null,
  place_offered: null,
  offer_expired: null,
  message: null,
};

export type Worded = {
  type: NotificationType;
  title: string;
  body: string;
  /** Lock-screen wording when it differs from body. */
  pushBody?: string;
  href: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-14" → "Sat 14 Nov". */
export function dayLabel(iso: unknown): string {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
}

/** "10:30:00" → "10:30". */
const clock = (t: unknown) => (typeof t === "string" && t.length >= 5 ? t.slice(0, 5) : null);

/** 7000 → "€70", 6550 → "€65.50". */
export function euro(cents: unknown): string | null {
  if (typeof cents !== "number" || cents <= 0) return null;
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

/** A timestamp → "9pm Sat 14 Nov" (or "9:30pm …") in Irish time. */
export function untilLabel(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const h = n("hour");
  const m = n("minute");
  const time = `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
  return `${time} ${dayLabel(`${n("year")}-${String(n("month")).padStart(2, "0")}-${String(n("day")).padStart(2, "0")}`)}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Words for one alert. `group` is the society's name, `who` the first name of
 * the member a payload refers to (a request, a message's sender).
 */
export function wordAlert(row: AlertRow, group: string, who: string | null): Worded | null {
  const p = row.payload ?? {};
  const title = str(p.title);
  const when = dayLabel(p.plays_on);
  const event = `/groups/${row.group_id}/events/${row.outing_id ?? 0}`;
  const home = `/groups/${row.group_id}`;
  const on = [title, when].filter(Boolean).join(" · ");

  switch (row.kind) {
    case "event_new":
      return { type: "society_event", title: `New: ${title}`, body: `${group} · ${[when, str(p.course)].filter(Boolean).join(" · ")}. Tap to see it and get a place.`, href: event };
    case "event_changed":
      return { type: "society_event", title: `${title} has changed`, body: `Now ${[when, str(p.course), clock(p.first_tee) ? `first tee ${clock(p.first_tee)}` : null].filter(Boolean).join(" · ")}. Tap for the details.`, href: event };
    case "event_cancelled":
      return { type: "society_event", title: `${title} is cancelled`, body: `${group} cancelled ${title}${when ? ` on ${when}` : ""}.`, href: event };
    case "request_received":
      return { type: "society_place", title: `${who ?? "A member"} asked for a place`, body: `${on}${p.guest ? " · with a guest" : ""}. Tap to answer.`, href: event };
    case "place_confirmed": {
      const fee = euro(p.fee_cents);
      return { type: "society_place", title: `You're in: ${title}`, body: `${group} confirmed your place${when ? ` for ${when}` : ""}.${fee ? ` Entry ${fee} — tap to pay.` : ""}`, href: event };
    }
    case "request_declined":
      return { type: "society_place", title: `No place this time: ${title}`, body: `${group} couldn't give you a place${when ? ` on ${when}` : ""}.`, href: event };
    case "waitlisted":
      return { type: "society_place", title: `On the waiting list: ${title}`, body: "We'll tell you as soon as a place opens up.", href: event };
    case "place_offered":
      return { type: "society_place", title: `A place opened: ${title}`, body: `It's yours if you want it — take it by ${untilLabel(p.expires_at)}.`, href: event };
    case "offer_expired":
      return { type: "society_place", title: `The place at ${title} has gone`, body: "Your offer ran out, so it went to the next person on the list.", href: event };
    case "draw_published":
      return { type: "society_reminder", title: `Tee times are out: ${title}`, body: `${on}. Tap to see yours and who you're playing with.`, href: event };
    case "tee_time_tomorrow": {
      const t = clock(p.tee_time);
      const arrive = clock(p.arrive_by);
      return {
        type: "society_reminder",
        title: t ? `Tomorrow: ${title}, ${t}` : `Tomorrow: ${title}`,
        body: [str(p.course), p.tee_group ? `Group ${p.tee_group}` : null, arrive ? `Arrive by ${arrive}` : null].filter(Boolean).join(" · ") || "Tap for your tee time.",
        href: event,
      };
    }
    case "entries_closing":
      return { type: "society_reminder", title: `Last chance: ${title}`, body: `Entries close ${untilLabel(p.closes_at)}. Tap to get a place.`, href: event };
    case "payment_due": {
      const fee = euro(p.fee_cents);
      return { type: "society_reminder", title: `${title}: entry not paid yet`, body: `${fee ? `${fee} for ` : ""}${when}. Tap to see how to pay.`, href: event };
    }
    case "membership_due": {
      const fee = euro(p.fee_cents);
      const due = dayLabel(p.due);
      return {
        type: "society_reminder",
        title: `${group}: membership ${p.season ?? ""}`.trim(),
        body: `${fee ? `${fee} ` : ""}${due ? `due by ${due}` : "is due"}. Tap to see how to pay.`,
        href: `${home}/membership`,
      };
    }
    case "notice":
      return { type: "society_notice", title: `${group}: ${title}`, body: "New on the noticeboard. Tap to read it.", href: `${home}/noticeboard` };
    case "message": {
      const body = str(p.body);
      return {
        type: "society_message",
        title: `${group}: ${title}`,
        body: body ? `${who ?? "The committee"}: ${body}` : `From ${who ?? "the committee"}.`,
        pushBody: `From ${who ?? "the committee"} — tap to read it.`,
        href: home,
      };
    }
    default:
      return null;
  }
}
