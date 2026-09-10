/**
 * Expired call-to-action detection.
 *
 * The triage prompt now states today's date and each item's age, which is the
 * first line of defence. This is the second, and it is deterministic: it does
 * not depend on a model reading a date correctly.
 *
 * The failure it exists to stop is specific. A press release that says
 * "Applications close on 1st April 2026" is enormously relevant right up
 * until the day it isn't, and then it is worse than useless — it sends a
 * reader to a form that no longer accepts them. Relevance scoring alone ranks
 * it at the top, because on every axis except time it deserves to be there.
 *
 * The check is narrow on purpose. It looks only for a date near a word that
 * signals a deadline, and only reports one that has already passed. A story
 * that merely mentions a past date — a result, an anniversary, a player's
 * career history — is not a call to action and is left alone.
 */

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Words that turn a date into a deadline. "Closes", "deadline", "apply by",
 * "register" — an instruction to the reader that expires.
 */
const CTA_PATTERN =
  /\b(deadline|closing date|clos(?:e|es|ed|ing)|apply|application|applications|register|registration|entries|entry|book|rsvp|sign up|last chance|final call)\b/gi;

/** How far after a trigger word to look for a date. */
const WINDOW = 140;

interface FoundDate {
  date: Date;
  text: string;
}

/** "1st April 2026", "1 April 2026", "April 1, 2026", "01/04/2026". */
function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];

  // 1 April 2026 / 1st April 2026
  const dmy = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g;
  for (const m of text.matchAll(dmy)) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) continue;
    out.push({ date: new Date(Date.UTC(Number(m[3]), month, Number(m[1]))), text: m[0] });
  }

  // April 1, 2026 / April 1st 2026
  const mdy = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
  for (const m of text.matchAll(mdy)) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) continue;
    out.push({ date: new Date(Date.UTC(Number(m[3]), month, Number(m[2]))), text: m[0] });
  }

  // 01/04/2026 — read day-first, which is the convention in Ireland and the UK.
  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  for (const m of text.matchAll(numeric)) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) continue;
    out.push({ date: new Date(Date.UTC(Number(m[3]), month, day)), text: m[0] });
  }

  return out.filter((d) => !Number.isNaN(d.date.getTime()));
}

export interface ExpiryVerdict {
  expired: boolean;
  /** The deadline phrase found, for the triage reason. */
  detail?: string;
}

/**
 * Does this release invite the reader to do something whose deadline has
 * passed?
 *
 * A deadline is treated as live through the whole of its final day, so an
 * item that closes today is not reported as expired.
 */
export function hasExpiredCallToAction(
  rawBody: string,
  now: Date = new Date(),
): ExpiryVerdict {
  // Midnight at the start of today. A deadline dated today has not passed —
  // "closes on 1 April" is still open on 1 April — so only a date strictly
  // before this counts as expired.
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  // Reset lastIndex — the pattern is global and module-scoped.
  CTA_PATTERN.lastIndex = 0;

  for (const trigger of rawBody.matchAll(CTA_PATTERN)) {
    const start = trigger.index ?? 0;
    const window = rawBody.slice(start, start + WINDOW);

    for (const found of findDates(window)) {
      if (found.date.getTime() < startOfToday) {
        const snippet = window
          .slice(0, Math.min(window.length, 90))
          .replace(/\s+/g, " ")
          .trim();
        return {
          expired: true,
          detail: `deadline appears to have passed: "${snippet}"`,
        };
      }
    }
  }

  return { expired: false };
}
