import { describe, expect, it } from "vitest";

import {
  buildMyRounds,
  forFilter,
  isOver,
  needsCount,
  type InterestRow,
  type MyRoundsInput,
  type Person,
  type RoundRow,
} from "./my-rounds-rules";

// Saturday 17 October 2026, 5:12pm local — when the bug was spotted.
const NOW = new Date(2026, 9, 17, 17, 12);
const ME = "me-0000";

const person = (id: string, name: string): Person => ({
  id,
  name,
  avatarUrl: null,
  avatarColor: null,
  homeClub: null,
  handicap: null,
});
const YOU = person(ME, "Eire Mac");
const MARK = person("mark", "Mark Tully");
const AOIFE = person("aoife", "Aoife Doyle");
const DARRAGH = person("darragh", "Darragh O'Neill");
const NIALL = person("niall", "Niall Byrne");

let nextId = 1;
const round = (over: Partial<RoundRow> = {}): RoundRow => ({
  id: nextId++,
  club: "Portmarnock Golf Club",
  clubRef: null,
  playDate: "2026-10-19",
  exactTeeTime: "09:00:00",
  timeFrom: null,
  timeTo: null,
  spacesAvailable: 3,
  status: "open",
  host: YOU,
  ...over,
});
const interest = (r: RoundRow, who: Person, status: InterestRow["status"], over: Partial<InterestRow> = {}): InterestRow => ({
  id: nextId++,
  inviteId: r.id,
  memberId: who.id,
  status,
  withdrawn: false,
  updatedAt: NOW.toISOString(),
  member: who,
  ...over,
});
const input = (over: Partial<MyRoundsInput>): MyRoundsInput => ({
  userId: ME,
  hosted: [],
  joined: [],
  interests: [],
  now: NOW,
  ...over,
});

describe("isOver", () => {
  it("is over on an earlier day and not on a later one", () => {
    expect(isOver({ playDate: "2026-10-16", exactTeeTime: null, timeFrom: null }, NOW)).toBe(true);
    expect(isOver({ playDate: "2026-10-18", exactTeeTime: null, timeFrom: null }, NOW)).toBe(false);
  });

  it("moves a round played this morning to Played (the 10am round still 'coming up' at 5pm)", () => {
    expect(isOver({ playDate: "2026-10-17", exactTeeTime: "10:00:00", timeFrom: null }, NOW)).toBe(true);
    expect(isOver({ playDate: "2026-10-17", exactTeeTime: "10:15:00", timeFrom: null }, NOW)).toBe(true);
  });

  it("keeps a round still being played today as coming up", () => {
    expect(isOver({ playDate: "2026-10-17", exactTeeTime: "13:30:00", timeFrom: null }, NOW)).toBe(false);
  });

  it("uses the start of a time window, and keeps a round with no time until the day ends", () => {
    expect(isOver({ playDate: "2026-10-17", exactTeeTime: null, timeFrom: "08:00:00" }, NOW)).toBe(true);
    expect(isOver({ playDate: "2026-10-17", exactTeeTime: null, timeFrom: null }, NOW)).toBe(false);
  });
});

describe("the host's side", () => {
  it("puts a request in Needs your answer and marks the round gold", () => {
    const r = round();
    const view = buildMyRounds(input({ hosted: [r], interests: [interest(r, DARRAGH, "pending")] }));
    expect(view.needs).toHaveLength(1);
    expect(view.needs[0]).toMatchObject({ kind: "request", inviteId: r.id, person: { name: DARRAGH.name } });
    expect(view.upcoming[0]).toMatchObject({ role: "hosting", tone: "gold", next: "answer", pendingCount: 1 });
    expect(view.upcoming[0].status).toBe("1 golfer asked to join · answer them");
  });

  it("after offering a place, waits for that golfer to confirm — the step the old screens hid", () => {
    const r = round({ spacesAvailable: 2 });
    const view = buildMyRounds(input({ hosted: [r], interests: [interest(r, DARRAGH, "accepted")] }));
    expect(view.needs).toHaveLength(0);
    const card = view.upcoming[0];
    expect(card.status).toBe("Place offered · waiting for Darragh to confirm");
    expect(card.stage).toEqual({ filled: 2, waiting: true });
    expect(card.slots.map((s) => s.state)).toEqual(["me", "offered", "open", "open"]);
  });

  it("reads Full once everyone is confirmed", () => {
    const r = round({ spacesAvailable: 0, status: "full" });
    const view = buildMyRounds(input({ hosted: [r], interests: [interest(r, DARRAGH, "confirmed"), interest(r, NIALL, "confirmed")] }));
    expect(view.upcoming[0]).toMatchObject({ status: "Full · everyone confirmed", tone: "green", slotText: "Full" });
  });

  it("only offers Delete while nobody has asked — after that it's Cancel", () => {
    const empty = round();
    const busy = round();
    const view = buildMyRounds(input({ hosted: [empty, busy], interests: [interest(busy, DARRAGH, "pending")] }));
    const [a, b] = view.upcoming;
    expect(a.canDelete).toBe(true);
    expect(b.canDelete).toBe(false);
    expect(b.canCancel).toBe(true);
  });

  it("shows a round the host cancelled, saying how many were told, and keeps it out of the counts", () => {
    const r = round({ status: "cancelled" });
    const view = buildMyRounds(input({ hosted: [r], interests: [interest(r, DARRAGH, "confirmed"), interest(r, NIALL, "pending")] }));
    expect(view.upcoming[0]).toMatchObject({ role: "cancelled", status: "You cancelled this round · 2 golfers told", canDelete: false });
    expect(view.needs).toHaveLength(0);
    expect(view.counts.all).toBe(0);
  });

  it("moves a played round to Played with who played, and drops one nobody joined", () => {
    const played = round({ playDate: "2026-10-16" });
    const lonely = round({ playDate: "2026-10-15" });
    const view = buildMyRounds(input({ hosted: [played, lonely], interests: [interest(played, NIALL, "confirmed")] }));
    expect(view.upcoming).toHaveLength(0);
    expect(view.played).toEqual([expect.objectContaining({ inviteId: played.id, role: "hosting", withNames: [NIALL.name] })]);
  });

  it("drops a request on a round that's already over — there's nothing left to answer", () => {
    const r = round({ playDate: "2026-10-17", exactTeeTime: "10:00:00" });
    const view = buildMyRounds(input({ hosted: [r], interests: [interest(r, DARRAGH, "pending")] }));
    expect(view.needs).toHaveLength(0);
  });
});

describe("the golfer's side", () => {
  it("an offered place goes in Needs your answer, with Confirm my place on the card", () => {
    const r = round({ host: AOIFE, playDate: "2026-10-24" });
    const mine = interest(r, YOU, "accepted");
    const view = buildMyRounds(input({ joined: [{ mine, round: r }], interests: [interest(r, NIALL, "confirmed")] }));
    expect(view.needs[0]).toMatchObject({ kind: "offer", interestId: mine.id, withNames: ["Niall"] });
    expect(view.upcoming[0]).toMatchObject({ role: "offered", next: "confirm", status: "Aoife offered you a place · confirm it" });
    expect(view.counts.requested).toBe(1);
  });

  it("a request still waiting names the host", () => {
    const r = round({ host: AOIFE });
    const view = buildMyRounds(input({ joined: [{ mine: interest(r, YOU, "pending"), round: r }] }));
    expect(view.upcoming[0]).toMatchObject({ role: "asked", status: "Asked · waiting for Aoife to reply", leaveLabel: null });
  });

  it("a confirmed place shows under Playing, with the host and the others in it", () => {
    const r = round({ host: MARK, status: "full", spacesAvailable: 0 });
    const view = buildMyRounds(
      input({ joined: [{ mine: interest(r, YOU, "confirmed"), round: r }], interests: [interest(r, NIALL, "confirmed")] })
    );
    const card = view.upcoming[0];
    expect(card).toMatchObject({ role: "playing", filter: "playing", next: "calendar" });
    expect(card.slots.map((s) => s.name)).toEqual([MARK.name, NIALL.name, "You"]);
  });

  it("a round the host cancelled says who cancelled it, and offers another", () => {
    const r = round({ host: MARK, status: "cancelled", playDate: "2026-10-21", exactTeeTime: "09:30:00" });
    const view = buildMyRounds(input({ joined: [{ mine: interest(r, YOU, "confirmed"), round: r }] }));
    expect(view.upcoming[0]).toMatchObject({
      role: "cancelled",
      filter: "playing",
      next: "findAnother",
      cancelNote: "Cancelled by Mark · Wed 21 Oct, 9:30am",
    });
    expect(view.counts.playing).toBe(0);
  });

  it("a 'no' stays for a few days, then goes", () => {
    const r = round({ host: AOIFE, playDate: "2026-10-30" });
    const recent = buildMyRounds(input({ joined: [{ mine: interest(r, YOU, "declined"), round: r }] }));
    expect(recent.upcoming[0]).toMatchObject({ role: "declined", status: "Aoife couldn't fit you in this time" });
    const old = buildMyRounds(
      input({ joined: [{ mine: interest(r, YOU, "declined", { updatedAt: "2026-10-01T10:00:00Z" }), round: r }] })
    );
    expect(old.upcoming).toHaveLength(0);
  });

  it("a place you handed back yourself disappears", () => {
    const r = round({ host: AOIFE });
    const view = buildMyRounds(input({ joined: [{ mine: interest(r, YOU, "declined", { withdrawn: true }), round: r }] }));
    expect(view.upcoming).toHaveLength(0);
  });
});

describe("one page, one number", () => {
  it("counts every answer owed, both sides, for the Tee Times tab", () => {
    const hostedRound = round();
    const theirs = round({ host: AOIFE, playDate: "2026-10-24" });
    const view = buildMyRounds(
      input({
        hosted: [hostedRound],
        joined: [{ mine: interest(theirs, YOU, "accepted"), round: theirs }],
        interests: [interest(hostedRound, DARRAGH, "pending")],
      })
    );
    expect(needsCount(view)).toBe(2);
    expect(view.needs.map((n) => n.kind)).toEqual(["request", "offer"]);
  });

  it("each tab shows its own side of Needs your answer", () => {
    const hostedRound = round();
    const theirs = round({ host: AOIFE, playDate: "2026-10-24" });
    const view = buildMyRounds(
      input({
        hosted: [hostedRound],
        joined: [{ mine: interest(theirs, YOU, "accepted"), round: theirs }],
        interests: [interest(hostedRound, DARRAGH, "pending")],
      })
    );
    expect(forFilter(view, "hosting").needs.map((n) => n.kind)).toEqual(["request"]);
    expect(forFilter(view, "requested").needs.map((n) => n.kind)).toEqual(["offer"]);
    expect(forFilter(view, "playing").needs).toHaveLength(0);
  });

  it("lists rounds soonest first, by time within a day", () => {
    const late = round({ playDate: "2026-10-19", exactTeeTime: "14:00:00" });
    const early = round({ playDate: "2026-10-19", exactTeeTime: "08:00:00" });
    const later = round({ playDate: "2026-10-20" });
    const view = buildMyRounds(input({ hosted: [later, late, early] }));
    expect(view.upcoming.map((r) => r.inviteId)).toEqual([early.id, late.id, later.id]);
  });
});
