import { createHmac, timingSafeEqual } from "node:crypto";

import { shareSecret } from "@/lib/share-links";

/**
 * "Add to calendar" (Oct 2026) — a tee time or a match on the member's phone.
 *
 * HOW IT REACHES THE CALENDAR. The app has no calendar module in its native
 * build, so it can't write an event itself. Instead it asks the website for
 * a link (/api/app/calendar, which checks the member is really in the round),
 * then opens it: /cal/<token> answers with an .ics file, and Safari on an
 * iPhone shows it with "Add to Calendar". No permission prompt, nothing
 * installed, and it works over the air.
 *
 * THE TOKEN CARRIES THE EVENT. Signed (HMAC, "calendar." domain-separated
 * from share links), short-lived, and holding only what the member was
 * already shown — so the /cal page needs no session and no database read.
 */

export type CalEvent = {
  uid: string;
  title: string;
  /** Local date at the course, YYYY-MM-DD. */
  date: string;
  /** Local start at the course, HH:MM; null = an all-day event. */
  time: string | null;
  /** IANA time zone of the course. */
  tz: string;
  durationMin: number;
  location: string | null;
  description: string | null;
  url: string | null;
};

const TZ_BY_COUNTRY: Record<string, string> = {
  ireland: "Europe/Dublin",
  "northern-ireland": "Europe/London",
  england: "Europe/London",
  scotland: "Europe/London",
  wales: "Europe/London",
  spain: "Europe/Madrid",
  portugal: "Europe/Lisbon",
};

export function tzForCountry(country: string | null | undefined): string {
  return (country && TZ_BY_COUNTRY[country]) || "Europe/Dublin";
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** A wall-clock time at the course, as the instant it is everywhere. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  // Once more, for a clock change between the guess and the answer.
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 folds lines at 75 octets; continuation lines start with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(ev: CalEvent, now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PinPals//Tee times//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT"];
  lines.push(`UID:${ev.uid}@pinpals.ie`, `DTSTAMP:${stamp(now)}`);
  if (ev.time) {
    const start = zonedToUtc(ev.date, ev.time, ev.tz);
    const end = new Date(start.getTime() + ev.durationMin * 60000);
    lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`);
  } else {
    const [y, m, d] = ev.date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    lines.push(`DTSTART;VALUE=DATE:${ev.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${next.replace(/-/g, "")}`);
  }
  lines.push(`SUMMARY:${escapeText(ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.url) lines.push(`URL:${ev.url}`);
  if (ev.time) {
    // A nudge an hour before: time to get to the course and hit a few.
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(ev.title)}`, "TRIGGER:-PT60M", "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// The signed link
// ---------------------------------------------------------------------------

/** A week: long enough to tap it later from the same screen, short enough to go stale. */
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

type Payload = CalEvent & { v: 1; exp: number };

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`calendar.${payload}`).digest().subarray(0, 16);
}

export function signCalendarToken(ev: CalEvent, now = Date.now(), secret: string = shareSecret()): string {
  const payload = Buffer.from(JSON.stringify({ ...ev, v: 1, exp: now + TOKEN_TTL_MS } satisfies Payload)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyCalendarToken(token: string, now = Date.now(), secret: string = shareSecret()): CalEvent | null {
  if (typeof token !== "string" || token.length > 4000) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const expected = signature(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Payload>;
    if (data.v !== 1 || typeof data.exp !== "number" || data.exp < now) return null;
    if (typeof data.title !== "string" || typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return null;
    if (data.time != null && !/^\d{2}:\d{2}$/.test(data.time)) return null;
    return {
      uid: String(data.uid ?? ""),
      title: data.title,
      date: data.date,
      time: data.time ?? null,
      tz: typeof data.tz === "string" ? data.tz : "Europe/Dublin",
      durationMin: typeof data.durationMin === "number" ? data.durationMin : 270,
      location: data.location ?? null,
      description: data.description ?? null,
      url: data.url ?? null,
    };
  } catch {
    return null;
  }
}

export const calendarLinkPath = (token: string) => `/cal/${token}`;
