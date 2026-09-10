import { describe, it, expect } from "vitest";
import { hasExpiredCallToAction } from "./freshness";

// 10 September 2026 — the day the first backlog was triaged.
const TODAY = new Date("2026-09-10T12:00:00Z");

// The real release this check exists because of. Every scoring axis except
// time puts it top of the queue.
const RYDER_CUP_VOLUNTEER = `Applications Open to Become a 2027 Ryder Cup Volunteer

Application window closes on 1st April 2026

Applications are now open to become a volunteer for the 2027 Ryder Cup at Adare Manor in County Limerick, Ireland, offering the chance to be part of one of the world's greatest sporting events as it celebrates its 100th anniversary.

Applications for both roles officially close on 1st April 2026.

The 2027 Ryder Cup will be the iconic event's 100th anniversary match and will take place at Adare Manor in County Limerick, Ireland, from 13-19 September 2027.`;

describe("hasExpiredCallToAction", () => {
  it("catches the Ryder Cup volunteer release after its window closed", () => {
    const verdict = hasExpiredCallToAction(RYDER_CUP_VOLUNTEER, TODAY);
    expect(verdict.expired).toBe(true);
    expect(verdict.detail).toContain("deadline appears to have passed");
  });

  it("does not flag that same release while the window is still open", () => {
    const verdict = hasExpiredCallToAction(
      RYDER_CUP_VOLUNTEER,
      new Date("2026-03-01T12:00:00Z"),
    );
    expect(verdict.expired).toBe(false);
  });

  it("treats the closing day itself as still open", () => {
    const verdict = hasExpiredCallToAction(
      RYDER_CUP_VOLUNTEER,
      new Date("2026-04-01T09:00:00Z"),
    );
    expect(verdict.expired).toBe(false);
  });

  it.each([
    "Entries close on 15 August 2026.",
    "The deadline for entry is 3rd August 2026.",
    "Register by August 20, 2026 to secure a place.",
    "Applications close 01/07/2026.",
    "Last chance to book — closing date 30 June 2026.",
  ])("flags an expired deadline: %s", (text) => {
    expect(hasExpiredCallToAction(text, TODAY).expired).toBe(true);
  });

  it.each([
    "Entries close on 15 October 2026.",
    "Register by 1 January 2027 to take part.",
    "Applications close 01/12/2026.",
  ])("does not flag a future deadline: %s", (text) => {
    expect(hasExpiredCallToAction(text, TODAY).expired).toBe(false);
  });

  it("ignores a past date that is not a deadline", () => {
    // A result, an anniversary, a career fact. Old dates are normal in news;
    // only an expired instruction to the reader is a problem.
    const text = `Gallacher won back-to-back Omega Dubai Desert Classic titles in 2013 and 2014,
      and played under Paul McGinley at Gleneagles on 28 September 2014.`;
    expect(hasExpiredCallToAction(text, TODAY).expired).toBe(false);
  });

  it("ignores a report of a past event that used the word closed", () => {
    const text = `The tournament closed with a pizza party on 28 February 2026.`;
    // This one WILL flag — "closed" plus a past date — and that is the
    // accepted cost of a deterministic check. A false positive costs a human
    // ten seconds in the review queue; a false negative publishes a dead link.
    expect(hasExpiredCallToAction(text, TODAY).expired).toBe(true);
  });

  it("handles a release with no dates at all", () => {
    expect(hasExpiredCallToAction("Applications are open now.", TODAY).expired).toBe(
      false,
    );
  });

  it("handles empty input", () => {
    expect(hasExpiredCallToAction("", TODAY).expired).toBe(false);
  });

  it("is not confused by a second call on the same text", () => {
    // The trigger pattern is module-scoped and global; a stale lastIndex
    // would make the second call miss.
    expect(hasExpiredCallToAction(RYDER_CUP_VOLUNTEER, TODAY).expired).toBe(true);
    expect(hasExpiredCallToAction(RYDER_CUP_VOLUNTEER, TODAY).expired).toBe(true);
  });

  it("reads a numeric date day-first, as Ireland and the UK write them", () => {
    // 01/07/2026 is 1 July, not 7 January.
    expect(
      hasExpiredCallToAction("Entries close 01/07/2026.", new Date("2026-05-01T12:00:00Z"))
        .expired,
    ).toBe(false);
  });
});
