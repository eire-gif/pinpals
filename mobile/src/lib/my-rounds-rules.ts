/**
 * My rounds (Oct 2026) — the rules, with no database and no React in them.
 *
 * One page replaced four: Rounds I've posted, Confirmed rounds, Rounds I've
 * asked to join and Places offered to you (claude/my-rounds-redesign.md).
 * Every one of a member's tee times is on it, whichever side they are on,
 * and this module decides what each one says — in the app (app/my-rounds.tsx,
 * rows read by lib/my-rounds.ts) and on the website (/tee-times/mine, rows
 * read by src/lib/my-rounds-server.ts).
 *
 * TWO COPIES, BYTE-IDENTICAL: mobile/src/lib/my-rounds-rules.ts and
 * src/lib/my-rounds-rules.ts. src/lib/my-rounds-rules.test.ts fails if they
 * differ, so the app and the site can't tell a member different things
 * about the same round. Change one, copy it to the other.
 *
 * THE PROCESS IS THREE STEPS, and the page says which one each round is on:
 *
 *   1. a golfer asks to join            interest 'pending'
 *   2. the host offers them a place     interest 'accepted'  (takes a space)
 *   3. the golfer confirms it           interest 'confirmed'
 *
 * then they play. Anything waiting on THIS member — a request to their round,
 * a place offered to them — goes in "Needs your answer" at the top, so there
 * is one place to look and one number on the Tee Times tab.
 *
 * Pure — no database, React or React Native — so it is unit-tested
 * (mobile/src/lib/my-rounds-rules.test.ts) and runs on both.
 */

export type InterestStatus = "pending" | "accepted" | "confirmed" | "declined";
export type InviteStatus = "open" | "full" | "cancelled" | "completed";

export type Person = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  homeClub: string | null;
  /** Only when they share it. */
  handicap: number | null;
};

export type ClubRef = { id: number; name: string; town: string | null; country: string };

export type RoundRow = {
  id: number;
  club: string;
  clubRef: ClubRef | null;
  playDate: string;
  exactTeeTime: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  spacesAvailable: number;
  status: InviteStatus;
  host: Person;
};

export type InterestRow = {
  id: number;
  inviteId: number;
  memberId: string;
  status: InterestStatus;
  /** The golfer handed the place back themselves (0091). */
  withdrawn: boolean;
  updatedAt: string;
  member: Person | null;
};

export type MyRoundsInput = {
  userId: string;
  /** Rounds this member posted. */
  hosted: RoundRow[];
  /** Rounds this member asked to join, each with their own interest row. */
  joined: { mine: InterestRow; round: RoundRow }[];
  /** Every OTHER interest row RLS lets them read on any of those rounds. */
  interests: InterestRow[];
  now: Date;
};

export type Role = "hosting" | "playing" | "offered" | "asked" | "declined" | "cancelled";
export type Filter = "all" | "hosting" | "playing" | "requested";

export type Slot = {
  key: string;
  /** me: you. in: confirmed. offered: a place offered, not yet confirmed.
   *  open: an empty place. */
  state: "me" | "in" | "offered" | "open";
  initials: string;
  name: string;
};

/** How the status dot is drawn. */
export type Tone = "gold" | "goldRing" | "green" | "grey" | "red";

/** The one main button a card carries. */
export type NextStep = "answer" | "confirm" | "share" | "view" | "calendar" | "findAnother" | "none";

export type MyRound = {
  inviteId: number;
  club: string;
  clubRef: ClubRef | null;
  playDate: string;
  when: string;
  role: Role;
  /** Which tab it shows under, besides All. */
  filter: Exclude<Filter, "all">;
  host: Person;
  /** This member's own interest, on someone else's round. */
  myInterestId: number | null;
  slots: Slot[];
  /** "2 of 4 open", "Full", "Everyone told". */
  slotText: string;
  /** Segments filled on the four-step bar, and whether the next one is
   *  waiting on somebody (drawn gold). */
  stage: { filled: number; waiting: boolean };
  status: string;
  tone: Tone;
  next: NextStep;
  /** Host only. */
  pendingCount: number;
  /** Mark full / Re-open make sense on a live round you host. */
  canToggleFull: boolean;
  isMarkedFull: boolean;
  /** Only while nobody has asked: deleting a round removes it for everyone
   *  in it with no trace, so once golfers are involved it's Cancel. */
  canDelete: boolean;
  canCancel: boolean;
  /** Someone else's round you're on: hand the place back. */
  leaveLabel: string | null;
  /** Cancelled card's red line: "Cancelled by Mark · Wed 21 Oct, 9:30am". */
  cancelNote: string | null;
  /** The tee time, or the start of the window ("08:40:00"); null when there's none. For the forecast. */
  teeTime: string | null;
};

export type Need =
  | {
      kind: "request";
      interestId: number;
      inviteId: number;
      person: Person;
      club: string;
      playDate: string;
      when: string;
      spacesAvailable: number;
    }
  | {
      kind: "offer";
      interestId: number;
      inviteId: number;
      host: Person;
      club: string;
      playDate: string;
      when: string;
      /** Who else is in it. */
      withNames: string[];
    };

export type PlayedRound = {
  inviteId: number;
  club: string;
  clubRef: ClubRef | null;
  playDate: string;
  when: string;
  role: "hosting" | "playing";
  withNames: string[];
  /** Hosting only: who was confirmed, so the host can say who turned up (0188). */
  players: { id: string; name: string }[];
};

export type MyRoundsView = {
  needs: Need[];
  upcoming: MyRound[];
  played: PlayedRound[];
  counts: Record<Filter, number>;
};

/** How long a "no" stays on the page, so it reads as an answer rather than a
 *  request that vanished. */
export const DECLINED_SHOWN_DAYS = 5;
/** A round is over this long after its tee time, on the day itself. */
export const ROUND_HOURS = 5;
/** The Played list is for sharing a recent round, not an archive. */
export const PLAYED_SHOWN = 10;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Local calendar date, YYYY-MM-DD — not toISOString(), which is UTC and
 *  drops a day during Irish summer time. */
export function localIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "14:30:00" → "2:30pm". */
export function clock(value: string | null): string | null {
  if (!value) return null;
  const [h, m = "00"] = value.split(":");
  const hour = Number.parseInt(h, 10);
  if (!Number.isFinite(hour)) return null;
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return m === "00" ? `${twelve}${suffix}` : `${twelve}:${m}${suffix}`;
}

export function whenOf(round: Pick<RoundRow, "exactTeeTime" | "timeFrom" | "timeTo">): string {
  const exact = clock(round.exactTeeTime);
  if (exact) return exact;
  const from = clock(round.timeFrom);
  const to = clock(round.timeTo);
  if (from && to) return `${from} – ${to}`;
  return from ?? "Time flexible";
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** "Tom, Ann and Joe". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Is the round over?
 *
 * A round on an earlier day is. On the day itself it is once its tee time
 * is ROUND_HOURS behind us — before Oct 2026 a 10am round still sat under
 * "Coming up" at 5pm, because the lists only compared dates. A round with no
 * time at all stays "coming up" until the day ends: there is nothing better
 * to go on.
 */
export function isOver(round: Pick<RoundRow, "playDate" | "exactTeeTime" | "timeFrom">, now: Date): boolean {
  const today = localIso(now);
  if (round.playDate < today) return true;
  if (round.playDate > today) return false;
  const tee = round.exactTeeTime ?? round.timeFrom;
  if (!tee) return false;
  const [h, m] = tee.split(":").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(h)) return false;
  const start = new Date(now);
  start.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
  return now.getTime() >= start.getTime() + ROUND_HOURS * 3600_000;
}

/** "Wed 21 Oct" without Intl, so tests read the same everywhere. */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const date = new Date(y, mo - 1, d);
  return `${DAYS[date.getDay()]} ${d} ${MONTHS[mo - 1]}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const byDateThenTime = (a: { playDate: string; sortTime: string }, b: { playDate: string; sortTime: string }) =>
  a.playDate.localeCompare(b.playDate) || a.sortTime.localeCompare(b.sortTime);

const sortTimeOf = (r: RoundRow) => r.exactTeeTime ?? r.timeFrom ?? "99:99";

function withoutSortTime<T extends { sortTime: string }>(item: T): Omit<T, "sortTime"> {
  const { sortTime, ...rest } = item;
  void sortTime;
  return rest;
}

export function buildMyRounds(input: MyRoundsInput): MyRoundsView {
  const { userId, now } = input;
  const needs: (Need & { sortTime: string })[] = [];
  const upcoming: (MyRound & { sortTime: string })[] = [];
  const played: PlayedRound[] = [];

  // Other people's rows, by round. Never this member's own (they are "me").
  const others = new Map<number, InterestRow[]>();
  for (const row of input.interests) {
    if (row.memberId === userId) continue;
    const list = others.get(row.inviteId) ?? [];
    list.push(row);
    others.set(row.inviteId, list);
  }
  const live = (row: InterestRow) => !row.withdrawn && row.status !== "declined";
  const nameOf = (row: InterestRow) => row.member?.name ?? "A member";

  // ---- rounds I host -----------------------------------------------------
  for (const round of input.hosted) {
    const rows = (others.get(round.id) ?? []).filter((r) => !r.withdrawn);
    const pending = rows.filter((r) => r.status === "pending");
    const offered = rows.filter((r) => r.status === "accepted");
    const confirmed = rows.filter((r) => r.status === "confirmed");
    const involved = rows.filter(live);
    const over = isOver(round, now);

    if (over) {
      if (round.status !== "cancelled" && confirmed.length > 0) {
        played.push({
          inviteId: round.id,
          club: round.club,
          clubRef: round.clubRef,
          playDate: round.playDate,
          when: whenOf(round),
          role: "hosting",
          withNames: confirmed.map(nameOf),
          players: confirmed.map((r) => ({ id: r.memberId, name: nameOf(r) })),
        });
      }
      continue;
    }

    const base = {
      inviteId: round.id,
      club: round.club,
      clubRef: round.clubRef,
      playDate: round.playDate,
      when: whenOf(round),
      host: round.host,
      myInterestId: null,
      pendingCount: pending.length,
      leaveLabel: null,
      sortTime: sortTimeOf(round),
      teeTime: round.exactTeeTime ?? round.timeFrom ?? null,
    };

    if (round.status === "cancelled") {
      upcoming.push({
        ...base,
        role: "cancelled",
        filter: "hosting",
        slots: [{ key: "me", state: "me", initials: "You", name: "You" }],
        slotText: involved.length > 0 ? "Everyone told" : "",
        stage: { filled: 0, waiting: false },
        status:
          involved.length > 0
            ? `You cancelled this round · ${involved.length} ${plural(involved.length, "golfer", "golfers")} told`
            : "You cancelled this round",
        tone: "red",
        next: "none",
        canToggleFull: false,
        isMarkedFull: false,
        canDelete: involved.length === 0,
        canCancel: false,
        cancelNote: `Cancelled by you · ${shortDate(round.playDate)}, ${whenOf(round)}`,
      });
      continue;
    }

    for (const row of pending) {
      if (!row.member) continue;
      needs.push({
        kind: "request",
        interestId: row.id,
        inviteId: round.id,
        person: row.member,
        club: round.club,
        playDate: round.playDate,
        when: whenOf(round),
        spacesAvailable: round.spacesAvailable,
        sortTime: sortTimeOf(round),
      });
    }

    const markedFull = round.status === "full";
    const open = markedFull ? 0 : Math.max(0, round.spacesAvailable);
    const slots: Slot[] = [
      { key: "me", state: "me", initials: "You", name: "You" },
      ...confirmed.map((r) => ({ key: `i${r.id}`, state: "in" as const, initials: initialsOf(nameOf(r)), name: nameOf(r) })),
      ...offered.map((r) => ({ key: `i${r.id}`, state: "offered" as const, initials: initialsOf(nameOf(r)), name: nameOf(r) })),
      ...Array.from({ length: open }, (_, i) => ({ key: `o${i}`, state: "open" as const, initials: "+", name: "Open place" })),
    ];

    let stage: MyRound["stage"];
    let status: string;
    let tone: Tone;
    let next: NextStep;
    if (pending.length > 0) {
      stage = { filled: 1, waiting: true };
      status = `${pending.length} ${plural(pending.length, "golfer", "golfers")} asked to join · answer them`;
      tone = "gold";
      next = "answer";
    } else if (offered.length > 0) {
      stage = { filled: 2, waiting: true };
      status = `Place offered · waiting for ${listNames(offered.map((r) => firstName(nameOf(r))))} to confirm`;
      tone = "goldRing";
      next = "view";
    } else if (open > 0) {
      stage = { filled: confirmed.length > 0 ? 2 : 1, waiting: false };
      status =
        confirmed.length > 0
          ? `${confirmed.length} in · ${open} ${plural(open, "place", "places")} still open`
          : "Open · no requests yet";
      tone = "grey";
      next = "share";
    } else {
      stage = { filled: 3, waiting: false };
      status = confirmed.length > 0 ? "Full · everyone confirmed" : "Marked full";
      tone = confirmed.length > 0 ? "green" : "grey";
      next = "view";
    }

    upcoming.push({
      ...base,
      role: "hosting",
      filter: "hosting",
      slots,
      slotText: open === 0 ? "Full" : `${open} ${plural(open, "place", "places")} open`,
      stage,
      status,
      tone,
      next,
      canToggleFull: true,
      isMarkedFull: markedFull,
      canDelete: involved.length === 0,
      canCancel: true,
      cancelNote: null,
    });
  }

  // ---- rounds I asked to join -------------------------------------------
  const declinedCutoff = now.getTime() - DECLINED_SHOWN_DAYS * 86400_000;

  for (const { mine, round } of input.joined) {
    // Dropped out yourself: you know, and it isn't yours any more.
    if (mine.withdrawn) continue;
    const over = isOver(round, now);
    const rows = (others.get(round.id) ?? []).filter((r) => !r.withdrawn && r.status === "confirmed");
    const hostFirst = firstName(round.host.name);

    if (over) {
      if (round.status !== "cancelled" && mine.status === "confirmed") {
        played.push({
          inviteId: round.id,
          club: round.club,
          clubRef: round.clubRef,
          playDate: round.playDate,
          when: whenOf(round),
          role: "playing",
          withNames: [round.host.name, ...rows.map(nameOf)],
          players: [],
        });
      }
      continue;
    }

    const base = {
      inviteId: round.id,
      club: round.club,
      clubRef: round.clubRef,
      playDate: round.playDate,
      when: whenOf(round),
      host: round.host,
      myInterestId: mine.id,
      pendingCount: 0,
      canToggleFull: false,
      isMarkedFull: false,
      canDelete: false,
      canCancel: false,
      sortTime: sortTimeOf(round),
      teeTime: round.exactTeeTime ?? round.timeFrom ?? null,
    };
    const hostSlot: Slot = { key: "host", state: "in", initials: initialsOf(round.host.name), name: round.host.name };
    const playerSlots: Slot[] = rows.map((r) => ({ key: `i${r.id}`, state: "in", initials: initialsOf(nameOf(r)), name: nameOf(r) }));
    const wasIn = mine.status === "confirmed" ? "playing" : "requested";

    if (round.status === "cancelled") {
      if (mine.status === "declined") continue;
      upcoming.push({
        ...base,
        role: "cancelled",
        filter: wasIn,
        slots: [hostSlot, ...playerSlots, { key: "me", state: "me", initials: "You", name: "You" }],
        slotText: "Everyone told",
        stage: { filled: 0, waiting: false },
        status: "No longer going ahead",
        tone: "red",
        next: "findAnother",
        leaveLabel: null,
        cancelNote: `Cancelled by ${hostFirst} · ${shortDate(round.playDate)}, ${whenOf(round)}`,
      });
      continue;
    }

    if (mine.status === "declined") {
      if (new Date(mine.updatedAt).getTime() < declinedCutoff) continue;
      upcoming.push({
        ...base,
        role: "declined",
        filter: "requested",
        slots: [hostSlot, ...playerSlots],
        slotText: "",
        stage: { filled: 0, waiting: false },
        status: `${hostFirst} couldn't fit you in this time`,
        tone: "grey",
        next: "findAnother",
        leaveLabel: null,
        cancelNote: null,
      });
      continue;
    }

    const full = round.status === "full" || round.status === "completed";
    const open = full ? 0 : Math.max(0, round.spacesAvailable);
    const openSlots: Slot[] = Array.from({ length: open }, (_, i) => ({ key: `o${i}`, state: "open", initials: "+", name: "Open place" }));
    const slotText = open === 0 ? "Full" : `${open} ${plural(open, "place", "places")} open`;

    if (mine.status === "pending") {
      upcoming.push({
        ...base,
        role: "asked",
        filter: "requested",
        slots: [hostSlot, ...playerSlots, ...openSlots],
        slotText,
        stage: { filled: 1, waiting: true },
        status: `Asked · waiting for ${hostFirst} to reply`,
        tone: "goldRing",
        next: "view",
        leaveLabel: "Withdraw request",
        cancelNote: null,
      });
      continue;
    }

    if (mine.status === "accepted") {
      needs.push({
        kind: "offer",
        interestId: mine.id,
        inviteId: round.id,
        host: round.host,
        club: round.club,
        playDate: round.playDate,
        when: whenOf(round),
        withNames: rows.map((r) => firstName(nameOf(r))),
        sortTime: sortTimeOf(round),
      });
      upcoming.push({
        ...base,
        role: "offered",
        filter: "requested",
        slots: [hostSlot, ...playerSlots, { key: "me", state: "offered", initials: "You", name: "You" }, ...openSlots],
        slotText,
        stage: { filled: 2, waiting: true },
        status: `${hostFirst} offered you a place · confirm it`,
        tone: "gold",
        next: "confirm",
        leaveLabel: "Can't make it",
        cancelNote: null,
      });
      continue;
    }

    // confirmed
    upcoming.push({
      ...base,
      role: "playing",
      filter: "playing",
      slots: [hostSlot, ...playerSlots, { key: "me", state: "me", initials: "You", name: "You" }, ...openSlots],
      slotText,
      stage: { filled: 3, waiting: false },
      status: "You're in · confirmed",
      tone: "green",
      next: "calendar",
      leaveLabel: "Cancel my place",
      cancelNote: null,
    });
  }

  needs.sort(byDateThenTime);
  upcoming.sort(byDateThenTime);
  played.sort((a, b) => b.playDate.localeCompare(a.playDate));

  const active = upcoming.filter((r) => r.role !== "cancelled" && r.role !== "declined");

  return {
    needs: needs.map(withoutSortTime) as Need[],
    upcoming: upcoming.map(withoutSortTime) as MyRound[],
    played: played.slice(0, PLAYED_SHOWN),
    counts: {
      all: active.length,
      hosting: active.filter((r) => r.filter === "hosting").length,
      playing: active.filter((r) => r.filter === "playing").length,
      requested: active.filter((r) => r.filter === "requested").length,
    },
  };
}

/** The rounds and answers a tab shows. Cancelled and declined cards show
 *  under the tab they belonged to, and under All. */
export function forFilter(view: MyRoundsView, filter: Filter): { needs: Need[]; upcoming: MyRound[]; played: PlayedRound[] } {
  if (filter === "all") return { needs: view.needs, upcoming: view.upcoming, played: view.played };
  return {
    needs: view.needs.filter((n) => (filter === "hosting" ? n.kind === "request" : filter === "requested" ? n.kind === "offer" : false)),
    upcoming: view.upcoming.filter((r) => r.filter === filter),
    played: view.played.filter((p) => (filter === "hosting" ? p.role === "hosting" : filter === "playing" ? p.role === "playing" : false)),
  };
}

/** The gold number on the Tee Times tab and the strip at the top of it. */
export const needsCount = (view: Pick<MyRoundsView, "needs">): number => view.needs.length;
