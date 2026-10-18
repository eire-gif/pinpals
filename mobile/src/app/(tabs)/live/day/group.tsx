import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { DateSheet, dayLabel } from "@/components/date-sheet";
import { TimeSheet } from "@/components/time-sheet";
import { Section } from "@/components/form-bits";
import { GroupIcon } from "@/components/group-bits";
import { CourseSection, useCourseSetup } from "@/components/live-course-section";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { draw, honourWishes, indexTotal, swapPlayers, teamSizes, teeGroupSizes, teeTimes, type DrawMode, type DrawPlayer, type DrawWishes, type Seat } from "@/lib/group-draw";
import { canDrawFrom, loadGroupRoster, loadMyGroups, type Group, type RosterPlayer } from "@/lib/groups-data";
import type { GroupRole } from "@/lib/groups";
import { SIDE_COLORS, createFourballDay, createMatchDay, createScrambleDay, setDayLeaderboardHidden } from "@/lib/live-match-days";
import {
  FOURSOMES_ALLOWANCE,
  GREENSOMES_ALLOWANCE,
  courseHandicap,
  formatInfo,
  foursomesHandicap,
  greensomesHandicap,
  indexLabel,
  parseIndex,
  playingHandicap,
  scrambleHandicap,
  shotgunCapacity,
  shotgunStarts,
  startLabel,
  type FoursomesScoring,
  type MatchFormat,
  type ShotgunStart,
} from "@/lib/live-scoring";
import { irishToday, isOutingDay, outingDateLabel } from "@/lib/outing-rules";
import { addOutingGuest, linkOutingMatchDay, loadClub, loadDrawWishes, loadOuting, publishOutingDraw, saveOuting, setOutingEntry, updateOutingGuest, type DrawSeat, type OutingPage } from "@/lib/outings";
import { loadItineraryItem, setItemPeople, type ItineraryItem } from "@/lib/itinerary";
import type { PlayFormat } from "@/lib/itinerary-rules";
import { clockLabel } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { explainStartError } from "@/lib/open-game-alert";

/**
 * Start a day from a group (0121): pick the crew or society, tick who's
 * playing, choose the format, and let the app draw the groups — at random,
 * or balanced by handicap — then swap anyone before starting.
 *
 *   Stableford / Stroke play → a society day: one card per tee group, one
 *                              individual leaderboard (live_fourball_day_create)
 *   Singles / Fourball /     → a match day (0104): the draw makes the
 *   Foursomes / Greensomes     matches (2 or 4 a match, side v side), with an
 *                              optional team score, Blues v Golds
 *                              (live_match_day_create; Oct 2026)
 *   Scramble 2s / 4s         → a scramble day: one card per team, one team
 *                              leaderboard (live_scramble_day_create)
 *   Foursomes Stableford /   → a day of foursomes pairs (0136): the draw
 *   Foursomes stroke play      makes fourballs of two pairs (seats 1 & 2 v
 *                              3 & 4); one card per pair, one pairs
 *                              leaderboard (live_scramble_day_create with
 *                              foursomes_scoring). Scotch foursomes.
 *   Greensomes Stableford /  → the same, for greensomes pairs (0173): both
 *   Greensomes stroke play     drive, play the better, then alternate; each
 *                              pair off 60% low + 40% high.
 *
 * SECRET LEADERBOARD (0174): "Keep the leaderboard secret" — players see
 * only their own card and tee group; the organiser and the event's officers
 * see the whole field; the clubhouse TV stays live. It comes off when the
 * results are published, or from the day's board.
 *
 * SHOTGUN START (0173): instead of tee times one after another, every group
 * goes off at the same time from its own hole — with more groups than
 * holes, an A and a B group on a hole (B groups on the par 5s and 4s
 * first). Each group's card starts on its hole. Not for matches.
 *
 * Who can be drawn is the database's rule (live_can_add_player): anyone in a
 * crew or trip, or everyone in a society you run. Guests can be added by
 * name. Handicaps: a member's shared index is filled in; anyone else's is
 * typed here, and the course handicap follows from the course chosen.
 *
 * FROM A SOCIETY OUTING (?outing=<id>, 0125): the society, its entrants, the
 * name, course and first tee come from the outing, and a draw already
 * published is laid out again. "Publish tee times" saves the draw to the
 * outing (anyone ticked who hadn't entered is entered); members see their
 * times at once. "Start the day" is offered only on the outing's date, and
 * the live day is linked back to the outing.
 *
 * A TRIP'S ROUND (?round=<itinerary item id>, Oct 2026): a round on an
 * overnight or abroad trip's itinerary (0126). Its course, date, first tee,
 * gap, format and groups come from the itinerary; "Start the round" starts
 * it live (asking first if it isn't that round's day) and saves the final
 * groups back to the itinerary.
 *
 * A FUTURE DATE (Oct 2026): the date and first tee are picked on scroll
 * wheels. Today → "Start the day" as before. A later date → "Save for
 * <date>": it becomes one of the group's Events (an outing: name, course,
 * date, first tee), everyone ticked is entered and the draw is published as
 * their tee times. On the day, the organiser opens it from Events and
 * starts it here, with the draw laid out again. Needs whoever runs the
 * group (the outings rule), and no guests — they're added on the day.
 */

type Format =
  | "stableford"
  | "stroke"
  | "scramble2"
  | "scramble4"
  | "foursomesPts"
  | "foursomesNet"
  | "greensomesPts"
  | "greensomesNet"
  | "singles"
  | "fourball"
  | "foursomes"
  | "greensomes";

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "stableford", label: "Stableford", hint: "Tee groups, everyone on one points leaderboard" },
  { id: "stroke", label: "Stroke play", hint: "Tee groups, ranked by net score" },
  { id: "scramble4", label: "Scramble 4s", hint: "Teams of four, one ball per team" },
  { id: "scramble2", label: "Scramble 2s", hint: "Pairs, one ball per pair" },
  { id: "foursomesPts", label: "Foursomes Stableford", hint: "Scotch foursomes: pairs, alternate shot, on points" },
  { id: "foursomesNet", label: "Foursomes stroke play", hint: "Scotch foursomes: pairs, alternate shot, net score" },
  { id: "greensomesPts", label: "Greensomes Stableford", hint: "Pairs: both drive, play the better, then alternate — on points" },
  { id: "greensomesNet", label: "Greensomes stroke play", hint: "Pairs: both drive, play the better, then alternate — net score" },
];

/** The pairs competitions — foursomes (0136) and greensomes (0173) — and how each is ranked. */
const FOURSOMES_COMP: Partial<Record<Format, FoursomesScoring>> = { foursomesPts: "stableford", foursomesNet: "stroke", greensomesPts: "stableford", greensomesNet: "stroke" };
const GREENSOMES_COMP = new Set<Format>(["greensomesPts", "greensomesNet"]);

/** Foursomes pairs, two to a tee group: groups of four, and a group of two
 *  when the pairs are odd. An odd player out is left over. */
function pairGroupSizes(players: number): { sizes: number[]; leftOver: number } {
  const pairs = Math.floor(players / 2);
  return { sizes: [...Array(Math.floor(pairs / 2)).fill(4), ...(pairs % 2 ? [2] : [])], leftOver: players % 2 };
}

/** Matchplay: the draw makes the matches; each is scored hole by hole, side v side. */
const MATCH_FORMATS_HERE: { id: Format; label: string; hint: string }[] = [
  { id: "singles", label: "Singles", hint: "One v one" },
  { id: "fourball", label: "Fourball", hint: "Pairs, better ball" },
  { id: "foursomes", label: "Foursomes", hint: "Scotch foursomes: pairs, alternate shot" },
  { id: "greensomes", label: "Greensomes", hint: "Both drive, pick one" },
];

const MATCH_FORMAT: Partial<Record<Format, MatchFormat>> = { singles: "matchplay", fourball: "fourball", foursomes: "foursomes", greensomes: "greensomes" };

/** A match's side for each seat: singles 1 v 1; pairs, seats 0–1 v 2–3. */
const sideOf = (position: number, size: number): 1 | 2 => (position < size / 2 ? 1 : 2);

/** WHS individual stroke-play allowance, for Stableford and stroke play. */
const ALLOWANCE = 0.95;
const GAPS = [8, 9, 10, 12];

type Entrant = DrawPlayer & { memberId: string | null; indexText: string };
/** A guest typed in here. `outingGuestId`: already a guest on the event (0131). */
type Guest = { key: string; name: string; indexText: string; outingGuestId?: number };

/** "1 tee group of 1 player", "3 tee groups — 4, 3 and 3 players". */
function teeGroupSummary(sizes: number[]): string {
  if (sizes.length === 1) return `1 tee group of ${sizes[0]} ${sizes[0] === 1 ? "player" : "players"}`;
  const list = sizes.length > 1 ? `${sizes.slice(0, -1).join(", ")} and ${sizes[sizes.length - 1]}` : "";
  return `${sizes.length} tee groups — ${list} players`;
}

/** A trip round's format (0126) as this screen's: the formats it can't start yet play as Stableford. */
function formatFromTrip(f: PlayFormat | null): Format {
  if (f === "strokeplay") return "stroke";
  if (f === "scramble") return "scramble4";
  if (f === "matchplay") return "singles";
  if (f === "fourball") return "fourball";
  if (f === "foursomes") return "foursomes";
  return "stableford";
}

let seq = 0;
const nextKey = () => `g${++seq}`;

export default function DrawFromGroup() {
  const { group: groupParam, outing: outingParam, round: roundParam } = useLocalSearchParams<{ group?: string; outing?: string; round?: string }>();
  const outingId = outingParam ? Number(outingParam) : null;
  const roundId = roundParam ? Number(roundParam) : null;
  const [tripRound, setTripRound] = useState<ItineraryItem | null>(null);
  const [outing, setOuting] = useState<OutingPage | null>(null);
  const [publishing, setPublishing] = useState(false);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const course = useCourseSetup();

  const [groups, setGroups] = useState<(Group & { role: GroupRole })[] | null>(null);
  const [groupId, setGroupId] = useState<number | null>(groupParam ? Number(groupParam) : null);
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null);
  const [ticked, setTicked] = useState<Map<string, string>>(new Map());
  const [guests, setGuests] = useState<Guest[]>([]);
  const [format, setFormat] = useState<Format>("stableford");
  const [perGroup, setPerGroup] = useState<3 | 4>(4);
  const [teamsOn, setTeamsOn] = useState(true);
  const [teamNames, setTeamNames] = useState<[string, string]>(["Blues", "Golds"]);
  const [mode, setMode] = useState<DrawMode>("random");
  /** An event's requests and recent pairings (0142), honoured by the draw. */
  const [wishes, setWishes] = useState<DrawWishes | null>(null);
  const [useWishes, setUseWishes] = useState(true);
  const [wishNote, setWishNote] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [firstTee, setFirstTee] = useState("");
  /** The day it's played (YYYY-MM-DD). Today unless a later date is picked, or the outing's. */
  const [playsOn, setPlaysOn] = useState(() => irishToday());
  const [sheet, setSheet] = useState<null | "date" | "time">(null);
  const [gap, setGap] = useState(10);
  /** Off the 1st in turn, or a shotgun start (0173). */
  const [shotgun, setShotgun] = useState(false);
  /** Only the organiser sees who's winning until the results are out (0174). */
  const [secret, setSecret] = useState(false);
  const [drawn, setDrawn] = useState<Entrant[][] | null>(null);
  const [picked, setPicked] = useState<Seat | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingFuture, setSavingFuture] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!userId || !isOn("groups")) return;
      void loadMyGroups(userId)
        .then((mine) => setGroups(mine.groups.filter(canDrawFrom)))
        .catch(() => setGroups([]));
    }, [userId])
  );

  const group = groups?.find((g) => g.id === groupId) ?? null;

  // A new group: load its members. Crews and trips start with everyone
  // ticked (it's usually all of them); a society starts with just you.
  // Keyed on the id, not the object: the list reloads on every focus, and a
  // fresh copy of the same group mustn't wipe who's been ticked.
  const groupKind = group?.kind ?? null;
  const groupName = group?.name ?? "";
  useEffect(() => {
    if (groupId == null || groupKind == null) return;
    setRoster(null);
    setDrawn(null);
    setGuests([]);
    setTitle((t) => t || groupName);
    void Promise.all([
      loadGroupRoster(groupId),
      outingId ? loadOuting(outingId) : Promise.resolve(null),
      roundId ? loadItineraryItem(roundId).catch(() => null) : Promise.resolve(null),
    ])
      .then(async ([people, page, round]) => {
        setRoster(people);
        if (round && round.kind === "round") {
          // A trip's round: everything comes from the itinerary.
          setTripRound(round);
          const label = (p: RosterPlayer) => (p.index != null ? indexLabel(p.index) : "");
          const onIt = people.filter((p) => round.people.some((x) => x.memberId === p.id));
          setTicked(new Map(onIt.map((p) => [p.id, label(p)])));
          setTitle(round.title);
          setPlaysOn(round.onDate);
          if (round.startsAt) setFirstTee(round.startsAt.slice(0, 5));
          if (round.teeInterval) setGap(round.teeInterval);
          setFormat(formatFromTrip(round.playFormat));
          const byGroup = new Map<number, Entrant[]>();
          for (const x of [...round.people].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
            const p = people.find((r) => r.id === x.memberId);
            if (!x.slot || !p) continue;
            const indexText = label(p);
            byGroup.set(x.slot, [...(byGroup.get(x.slot) ?? []), { key: `m:${p.id}`, memberId: p.id, name: p.name, indexText, index: parseIndex(indexText) }]);
          }
          const saved = [...byGroup.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
          if (saved.length > 0) setDrawn(saved);
          if (round.clubId) {
            const club = await loadClub(round.clubId);
            if (club) course.setClub(club);
          }
          return;
        }
        if (page && page.outing.groupId === groupId) {
          // From an outing: its entrants are who's playing, and a published
          // draw comes back as it was.
          setOuting(page);
          void loadDrawWishes(page.outing.id, groupId)
            .then((w) => setWishes({ together: w.together, early: new Set(w.early), late: new Set(w.late), met: new Map(w.met) }))
            .catch(() => setWishes(null));
          const label = (p: RosterPlayer) => (p.index != null ? indexLabel(p.index) : "");
          const inIt = people.filter((p) => page.entries.some((e) => e.memberId === p.id));
          setTicked(new Map(inIt.map((p) => [p.id, label(p)])));
          // The event's guests (0131) come in as guests here, already entered.
          const outingGuests: Guest[] = page.guests.map((g) => ({
            key: `o:${g.id}`,
            name: g.name,
            indexText: g.handicapIndex != null ? indexLabel(g.handicapIndex) : "",
            outingGuestId: g.id,
          }));
          setGuests(outingGuests);
          setTitle(page.outing.title);
          setPlaysOn(page.outing.playsOn);
          if (page.outing.firstTee) setFirstTee(page.outing.firstTee.slice(0, 5));
          const seated: { group: number; pos: number; who: Entrant }[] = [];
          for (const e of page.entries) {
            const p = people.find((x) => x.id === e.memberId);
            if (!e.teeGroup || !p) continue;
            const indexText = label(p);
            seated.push({ group: e.teeGroup, pos: e.teePosition ?? 0, who: { key: `m:${p.id}`, memberId: p.id, name: p.name, indexText, index: parseIndex(indexText) } });
          }
          for (const g of page.guests) {
            const guest = outingGuests.find((x) => x.outingGuestId === g.id);
            if (!g.teeGroup || !guest) continue;
            seated.push({ group: g.teeGroup, pos: g.teePosition ?? 0, who: { key: guest.key, memberId: null, name: guest.name, indexText: guest.indexText, index: parseIndex(guest.indexText) } });
          }
          const byGroup = new Map<number, Entrant[]>();
          for (const x of seated.sort((a, b) => a.pos - b.pos)) byGroup.set(x.group, [...(byGroup.get(x.group) ?? []), x.who]);
          const saved = [...byGroup.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
          if (saved.length > 0) {
            setDrawn(saved);
            if ([...page.entries, ...page.guests].some((e) => e.teeGroup && e.start)) setShotgun(true);
            const t = [...page.entries, ...page.guests].filter((e) => e.teeGroup && e.teeTime).sort((a, b) => (a.teeGroup ?? 0) - (b.teeGroup ?? 0));
            const first = t.find((e) => e.teeGroup === 1)?.teeTime;
            const second = t.find((e) => e.teeGroup === 2)?.teeTime;
            if (first) setFirstTee(first.slice(0, 5));
            if (first && second) {
              const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
              const g = mins(second) - mins(first);
              if (GAPS.includes(g)) setGap(g);
            }
          }
          if (page.outing.clubId) {
            const club = await loadClub(page.outing.clubId);
            if (club) course.setClub(club);
          }
          return;
        }
        const all = groupKind === "society" ? people.filter((p) => p.id === userId) : people;
        setTicked(new Map(all.map((p) => [p.id, p.index != null ? indexLabel(p.index) : ""])));
      })
      .catch(() => setRoster([]));
    // course.setClub is a state setter: stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, groupKind, groupName, userId, outingId, roundId]);

  const entrants: Entrant[] = useMemo(() => {
    const members = (roster ?? [])
      .filter((p) => ticked.has(p.id))
      .map((p) => {
        const indexText = ticked.get(p.id) ?? "";
        return { key: `m:${p.id}`, memberId: p.id, name: p.name, indexText, index: parseIndex(indexText) };
      });
    const extra = guests.map((g) => ({ key: g.key, memberId: null, name: g.name.trim(), indexText: g.indexText, index: parseIndex(g.indexText) }));
    return [...members, ...extra];
  }, [roster, ticked, guests]);

  const scramble = format === "scramble2" || format === "scramble4";
  const matchFormat = MATCH_FORMAT[format] ?? null;
  const foursomesComp = FOURSOMES_COMP[format] ?? null;
  const greensomes = GREENSOMES_COMP.has(format);
  const teamSize = matchFormat ? (matchFormat === "matchplay" ? 2 : 4) : format === "scramble2" ? 2 : 4;
  const sizing = foursomesComp
    ? pairGroupSizes(entrants.length)
    : scramble || matchFormat
      ? teamSizes(entrants.length, teamSize)
      : { sizes: teeGroupSizes(entrants.length, perGroup), leftOver: 0 };
  /** Pairs within a group: a match's sides, or a foursomes group's two pairs. */
  const paired = matchFormat != null || foursomesComp != null;

  // Anything that changes who's in or how they're split clears the draw.
  const invalidate = () => {
    setDrawn(null);
    setPicked(null);
  };

  const toggle = (id: string, index: number | null) => {
    invalidate();
    setTicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, index != null ? indexLabel(index) : "");
      return next;
    });
  };

  const makeDraw = () => {
    setPicked(null);
    let groupsNow = draw(entrants, sizing.sizes, mode);
    setWishNote(null);
    // Plain tee groups for an event: honour requests and avoid repeat pairings.
    if (wishes && useWishes && !scramble && !matchFormat && !foursomesComp) {
      const out = honourWishes(groupsNow, wishes, { balanced: mode === "balanced" });
      groupsNow = out.groups;
      const bits = [
        out.togetherAsked ? `${out.together} of ${out.togetherAsked} "play with" requests` : null,
        wishes.early.size || wishes.late.size ? "early and late tee requests" : null,
        out.repeats === 0 && wishes.met.size ? "no repeat pairings from recent events" : out.repeats ? `${out.repeats} repeat pairing${out.repeats === 1 ? "" : "s"} couldn't be avoided` : null,
      ].filter(Boolean);
      setWishNote(bits.length ? `Honoured ${bits.join(" · ")}.` : null);
    }
    // A pairs match (or two foursomes pairs), balanced: the best and the
    // highest handicap of the four play together against the middle two.
    if (((matchFormat && matchFormat !== "matchplay") || foursomesComp) && mode === "balanced") {
      groupsNow = groupsNow.map((g) => {
        if (g.length !== 4) return g;
        const by = [...g].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
        return [by[0], by[3], by[1], by[2]];
      });
    }
    setDrawn(groupsNow);
  };

  // Keep a drawn player's typed index or guest name current in the draw.
  const drawnNow: Entrant[][] | null = useMemo(() => {
    if (!drawn) return null;
    const byKey = new Map(entrants.map((e) => [e.key, e]));
    return drawn.map((g) => g.map((p) => byKey.get(p.key) ?? p));
  }, [drawn, entrants]);

  const tap = (seat: Seat) => {
    if (!drawnNow) return;
    if (!picked) {
      setPicked(seat);
      return;
    }
    if (picked.group !== seat.group || picked.position !== seat.position) setDrawn(swapPlayers(drawnNow, picked, seat));
    setPicked(null);
  };

  // A shotgun: everyone at the first tee time, each group from its own hole.
  const shotgunOn = shotgun && !matchFormat;
  const card = course.holeCard();
  const holesHere = card.length;
  let starts: ShotgunStart[] | null = null;
  if (shotgunOn && drawnNow && drawnNow.length <= shotgunCapacity(holesHere)) starts = shotgunStarts(card, drawnNow.length);
  const times = drawnNow ? (shotgunOn ? drawnNow.map(() => (/^\d{2}:\d{2}$/.test(firstTee) ? firstTee : "")) : teeTimes(firstTee, gap, drawnNow.length)) : [];
  /** "7B": a group's start in a shotgun, with no letter when it's alone on its hole. */
  const startText = (gi: number): string => {
    const st = starts?.[gi];
    if (!st) return "";
    return startLabel(st, !starts!.some((o) => o !== st && o.hole === st.hole));
  };
  const handicaps = (e: Entrant) => {
    if (e.index == null) return null;
    return { index: e.index, ...courseHandicap(e.index, { slope: course.slope, courseRating: course.rating, par: course.par }) };
  };

  const problems: string[] = [];
  if (!group) problems.push("Choose a group");
  if (entrants.length === 0) problems.push("Tick who's playing");
  for (const e of entrants) {
    if (!e.name) problems.push("A guest needs a name");
    else if (e.index == null) problems.push(`Add ${e.name.split(" ")[0]}'s handicap index`);
  }
  if (scramble && sizing.leftOver > 0) problems.push(`${sizing.leftOver} left over for teams of ${teamSize} — add ${teamSize - sizing.leftOver === 1 ? "a guest" : "guests"} or untick someone`);
  if (matchFormat && sizing.leftOver > 0) problems.push(`${sizing.leftOver} left over — ${matchFormat === "matchplay" ? "singles need an even number" : "pairs matches need groups of four"}: add ${teamSize - sizing.leftOver === 1 ? "a guest" : "guests"} or untick someone`);
  if (matchFormat && sizing.sizes.length > 40) problems.push("40 matches at most");
  if (matchFormat && teamsOn && (teamNames[0].trim() === "" || teamNames[1].trim() === "")) problems.push("Name both teams");
  if (foursomesComp && sizing.leftOver > 0) problems.push(`${greensomes ? "Greensomes" : "Foursomes"} is played in pairs — one left over: add a guest or untick someone`);
  if (foursomesComp && sizing.sizes.length > 50) problems.push("100 pairs at most");
  if (!scramble && !foursomesComp && !matchFormat && sizing.sizes.length > 60) problems.push("60 groups at most");
  if (scramble && sizing.sizes.length > 100) problems.push("100 teams at most");
  if (shotgunOn && sizing.sizes.length > shotgunCapacity(holesHere)) problems.push(`A shotgun takes ${shotgunCapacity(holesHere)} groups at most — two to a hole`);
  if (shotgunOn && !/^\d{2}:\d{2}$/.test(firstTee)) problems.push("Set the shotgun's start time");
  problems.push(...course.problems);
  if (title.trim() === "") problems.push("Give the day a name");
  if (!drawnNow) problems.push("Make the draw");
  // A draw saved for tee groups (an event, a trip round) doesn't fit matches of another size.
  else if (matchFormat && drawnNow.some((g) => g.length !== teamSize)) problems.push(`Draw again — ${matchFormat === "matchplay" ? "singles are two to a match" : "pairs matches are four to a match"}`);
  else if (foursomesComp && drawnNow.some((g) => g.length % 2 !== 0)) problems.push(`Draw again — ${greensomes ? "greensomes" : "foursomes"} groups are two pairs`);

  const start = async (startAnyway = false) => {
    if (problems.length > 0 || !drawnNow || !course.club) return;
    if (tripRound && tripRound.onDate !== irishToday() && !startAnyway) {
      Alert.alert(
        "Start it today?",
        `This round is on the itinerary for ${outingDateLabel(tripRound.onDate)}. Starting it now opens live scoring today.`,
        [
          { text: "Not yet", style: "cancel" },
          { text: "Start now", onPress: () => void start(true) },
        ]
      );
      return;
    }
    setSaving(true);
    try {
      const day = {
        title: title.trim(),
        courseName: course.club.name,
        clubId: course.club.id,
        teeName: course.teeName.trim() || null,
        holes: course.holes,
        courseRating: course.rating,
        slope: course.slope,
        parTotal: course.par,
      };
      let id: number;
      if (matchFormat) {
        const allowance = formatInfo(matchFormat).allowance;
        id = await createMatchDay(
          { ...day, teamNames: teamsOn ? [teamNames[0].trim(), teamNames[1].trim()] : null },
          drawnNow.map((g, gi) => ({
            format: matchFormat,
            teeTime: times[gi] || null,
            players: g.map((p, pi) => {
              const w = handicaps(p)!;
              return {
                memberId: p.memberId,
                name: p.name,
                handicapIndex: w.index,
                courseHandicap: w.courseHandicap,
                playingHandicap: playingHandicap(w.courseHandicap, allowance),
                estimated: w.estimated,
                side: sideOf(pi, g.length),
              };
            }),
          })),
          course.holeCard()
        );
      } else if (foursomesComp) {
        // Each tee group is two pairs: seats 1 & 2, 3 & 4. One card per pair.
        id = await createScrambleDay(
          { ...day, size: 2, driveMinimum: null, foursomes: foursomesComp, greensomes },
          drawnNow.flatMap((g, gi) =>
            [0, 2]
              .filter((i) => i < g.length)
              .map((i) => {
                const pair = [g[i], g[i + 1]];
                const ws = pair.map((p) => handicaps(p)!);
                const chs = ws.map((w) => w.courseHandicap);
                const low = Math.min(...chs);
                return {
                  name: pair.map((p) => p.name.split(" ")[0]).join(" & "),
                  teeTime: times[gi] || null,
                  start: starts?.[gi] ?? null,
                  teamHandicap: greensomes ? greensomesHandicap(chs) : foursomesHandicap(chs),
                  players: pair.map((p, k) => ({
                    memberId: p.memberId,
                    name: p.name,
                    handicapIndex: ws[k].index,
                    courseHandicap: ws[k].courseHandicap,
                    // Greensomes: the lower handicap's 60%, the higher's 40% (shown on the card; the pair plays off the total).
                    playingHandicap: greensomes
                      ? playingHandicap(ws[k].courseHandicap, ws[k].courseHandicap === low && chs.indexOf(low) === k ? GREENSOMES_ALLOWANCE : 0.4)
                      : playingHandicap(ws[k].courseHandicap, FOURSOMES_ALLOWANCE),
                    estimated: ws[k].estimated,
                  })),
                };
              })
          ),
          course.holeCard()
        );
      } else if (scramble) {
        id = await createScrambleDay(
          { ...day, size: teamSize, driveMinimum: null },
          drawnNow.map((team, ti) => {
            const ws = team.map((p) => handicaps(p)!);
            const hcp = scrambleHandicap(ws.map((w) => w.courseHandicap));
            return {
              name: null,
              teeTime: times[ti] || null,
              start: starts?.[ti] ?? null,
              teamHandicap: hcp.team,
              players: team.map((p, i) => ({
                memberId: p.memberId,
                name: p.name,
                handicapIndex: ws[i].index,
                courseHandicap: ws[i].courseHandicap,
                playingHandicap: Math.round(hcp.shares[i]),
                estimated: ws[i].estimated,
              })),
            };
          }),
          course.holeCard()
        );
      } else {
        id = await createFourballDay(
          { ...day, format: format === "stroke" ? "stroke" : "stableford", allowance: ALLOWANCE },
          drawnNow.map((g, gi) => ({
            teeTime: times[gi] || null,
            start: starts?.[gi] ?? null,
            players: g.map((p) => {
              const w = handicaps(p)!;
              return {
                memberId: p.memberId,
                name: p.name,
                handicapIndex: w.index,
                courseHandicap: w.courseHandicap,
                playingHandicap: playingHandicap(w.courseHandicap, ALLOWANCE),
                estimated: w.estimated,
              };
            }),
          })),
          course.holeCard()
        );
      }
      if (secret && !matchFormat) {
        // Before anyone opens the board. If it fails, say so: the organiser
        // can still hide it from the day's board.
        await setDayLeaderboardHidden(id, true).catch(() =>
          Alert.alert("The leaderboard isn't hidden yet", "Open the day and tap Keep the leaderboard secret.")
        );
      }
      if (outing) {
        // The final draw becomes the outing's tee times, and the outing
        // remembers its live day. Neither may block the day itself.
        await publishDraw(drawnNow).catch(() => undefined);
        await linkOutingMatchDay(outing.outing.id, id).catch(() => undefined);
      }
      if (tripRound) {
        // The groups as played go back on the itinerary. Guests aren't on
        // the trip, so they stay off it. Never blocks the round.
        await setItemPeople(
          tripRound.id,
          drawnNow.flatMap((g, gi) => g.filter((p) => p.memberId).map((p) => ({ memberId: p.memberId as string, slot: gi + 1 })))
        ).catch(() => undefined);
      }
      router.replace({ pathname: "/live/day/[id]", params: { id: String(id), created: "1" } });
    } catch (e) {
      explainStartError(e, "Couldn't start the day");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Puts every guest in this draw on the event (0131): a new one is added,
   * one already there gets any change to their name or index. Returns each
   * guest's id on the event, by their key here.
   */
  const enterGuests = async (eventId: number, groupsNow: Entrant[][]): Promise<Map<string, number>> => {
    const ids = new Map<string, number>();
    for (const p of groupsNow.flat()) {
      if (p.memberId) continue;
      const g = guests.find((x) => x.key === p.key);
      if (!g) continue;
      const name = g.name.trim();
      const index = parseIndex(g.indexText);
      if (g.outingGuestId != null) {
        const was = outing?.guests.find((x) => x.id === g.outingGuestId);
        if (!was || was.name !== name || was.handicapIndex !== index) await updateOutingGuest(g.outingGuestId, name, index);
        ids.set(g.key, g.outingGuestId);
      } else {
        const id = await addOutingGuest(eventId, name, index);
        ids.set(g.key, id);
      }
    }
    // Remember the new ones, so publishing again doesn't add them twice.
    setGuests((gs) => gs.map((x) => (ids.has(x.key) ? { ...x, outingGuestId: ids.get(x.key) } : x)));
    return ids;
  };

  const seatsFor = (groupsNow: Entrant[][], guestIds: Map<string, number>) =>
    groupsNow.map((g, gi) => ({
      teeTime: times[gi] || null,
      start: starts?.[gi] ?? null,
      members: g.map((p): DrawSeat => (p.memberId ? p.memberId : { guest: guestIds.get(p.key) as number })),
    }));

  /** Saves this draw as the outing's tee times; anyone ticked who hadn't
   *  entered is entered first, guests included. */
  const publishDraw = async (groupsNow: Entrant[][]) => {
    if (!outing) return;
    for (const p of groupsNow.flat()) {
      if (p.memberId && !outing.entries.some((e) => e.memberId === p.memberId)) await setOutingEntry(outing.outing.id, true, p.memberId);
    }
    const guestIds = await enterGuests(outing.outing.id, groupsNow);
    await publishOutingDraw(outing.outing.id, seatsFor(groupsNow, guestIds));
  };

  const publishProblem = !drawnNow
    ? "Make the draw"
    : drawnNow.some((g) => g.some((p) => !p.memberId && !p.name))
      ? "A guest needs a name"
      : null;

  const publish = async () => {
    if (!outing || !drawnNow || publishProblem) return;
    setPublishing(true);
    try {
      await publishDraw(drawnNow);
      Alert.alert("Tee times published", "Everyone in the draw can see their tee time and who they're playing with.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert("Couldn't publish", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  const outingDay = outing ? isOutingDay(outing.outing.playsOn) : true;

  // A later date, not from an existing outing: save it as an event instead of starting it.
  const future = !outing && !tripRound && playsOn > irishToday();
  const runsGroup = group?.role === "owner" || group?.role === "admin";
  const futureProblems: string[] = [];
  if (future) {
    if (!group) futureProblems.push("Choose a group");
    else if (!runsGroup) futureProblems.push("Only whoever runs the group can set up a round ahead — or pick today");
    if (entrants.length === 0) futureProblems.push("Tick who's playing");
    if (entrants.some((e) => !e.memberId && !e.name)) futureProblems.push("A guest needs a name");
    if (!course.club) futureProblems.push("Choose the course");
    if (title.trim() === "") futureProblems.push("Give the day a name");
  }

  const saveFuture = async () => {
    if (!future || futureProblems.length > 0 || !group || !course.club) return;
    setSavingFuture(true);
    try {
      const outingId = await saveOuting(group.id, null, {
        kind: "day",
        title: title.trim(),
        clubId: course.club.id,
        courseName: course.club.name,
        playsOn,
        endsOn: null,
        location: null,
        payRevtag: null,
        payIban: null,
        payAccountName: null,
        payCash: true,
        payNote: null,
        firstTee: /^\d{2}:\d{2}$/.test(firstTee) ? firstTee : null,
        details: null,
        entryFeeCents: null,
        maxEntries: null,
      });
      // Everyone ticked goes in; a draw made now becomes their tee times.
      for (const e of entrants) if (e.memberId) await setOutingEntry(outingId, true, e.memberId);
      // Guests go on the event too (0131), drawn or not.
      const guestIds = await enterGuests(outingId, drawnNow ?? [entrants.filter((e) => !e.memberId)]);
      if (drawnNow) await publishOutingDraw(outingId, seatsFor(drawnNow, guestIds));
      Alert.alert(
        `Saved for ${dayLabel(playsOn)}`,
        drawnNow
          ? "Everyone in it can see the day, their tee time and who they're playing with, under the group's Events. On the day, open it there and start the round."
          : "Everyone ticked is in it, under the group's Events. Make the draw there any time before; on the day, open it and start the round.",
        [{ text: "OK", onPress: () => router.replace({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(group.id), outingId: String(outingId), saved: "1" } }) }]
      );
    } catch (e) {
      Alert.alert("Couldn't save it", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSavingFuture(false);
    }
  };

  if (!isOn("liveScoring") || !isOn("groups")) return <StateMessage size="screen" icon="podium-outline" title="This is on its way" />;
  if (groups === null) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (groups.length === 0) {
    return (
      <StateMessage
        size="screen"
        icon="people-outline"
        title="Start with a group"
        body="Make a crew for your regular game or a society for your outings, bring your golfers in, then draw them into groups here."
        action={{ label: "Groups & societies", onPress: () => router.push("/groups") }}
      />
    );
  }

  const unitWord = matchFormat ? "Match" : scramble ? "Team" : "Group";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {outingId ? <Stack.Screen options={{ title: "The draw" }} /> : null}
        {outing ? (
          <View style={styles.outingBanner}>
            <Ionicons name="calendar" size={18} color={colors.navy900} />
            <Text style={styles.outingBannerText}>{`${outing.outing.title} · ${outingDateLabel(outing.outing.playsOn)}`}</Text>
          </View>
        ) : null}
        {outing ? null : (
        <Section title="Group">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {groups.map((g) => {
              const on = g.id === groupId;
              return (
                <Pressable
                  key={g.id}
                  onPress={() => {
                    setTitle("");
                    setGroupId(g.id);
                  }}
                  style={[styles.groupChip, on && styles.groupChipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                >
                  <GroupIcon kind={g.kind} size={28} logoUrl={g.logoUrl} />
                  <Text style={[styles.groupChipText, on && styles.groupChipTextOn]} numberOfLines={1}>
                    {g.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Section>
        )}

        {group ? (
          <Section title={`Who's playing (${entrants.length})`} hint={
              group.kind === "society"
                ? "Handicap index: the society's, where the captain or secretary has set one (Handicaps on the society's page), else the member's own if they share it. Type any that are missing."
                : "Handicap index: filled in where a member shares it. Type any that are missing."
            }>
            {roster === null ? (
              <ActivityIndicator color={colors.green700} />
            ) : (
              <>
                <View style={styles.bulk}>
                  <Pressable
                    onPress={() => {
                      invalidate();
                      setTicked(new Map(roster.map((p) => [p.id, ticked.get(p.id) ?? (p.index != null ? indexLabel(p.index) : "")])));
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.link}>Tick everyone</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      invalidate();
                      setTicked(new Map());
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.link}>Clear</Text>
                  </Pressable>
                </View>
                {roster.map((p) => {
                  const on = ticked.has(p.id);
                  return (
                    <View key={p.id} style={[styles.person, on && styles.personOn]}>
                      <Pressable onPress={() => toggle(p.id, p.index)} style={styles.personMain} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={p.name}>
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={24} color={on ? colors.green700 : colors.ink500} />
                        <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={32} />
                        <Text style={styles.personName} numberOfLines={1}>
                          {p.id === userId ? `${p.name} (you)` : p.name}
                        </Text>
                      </Pressable>
                      {on ? (
                        <TextInput
                          value={ticked.get(p.id) ?? ""}
                          onChangeText={(v) => setTicked((prev) => new Map(prev).set(p.id, v))}
                          placeholder="Index"
                          placeholderTextColor={colors.ink500}
                          keyboardType="numbers-and-punctuation"
                          style={[styles.indexInput, parseIndex(ticked.get(p.id) ?? "") == null && styles.indexMissing]}
                          maxLength={5}
                          accessibilityLabel={`${p.name}'s handicap index`}
                        />
                      ) : null}
                    </View>
                  );
                })}
                {guests.map((g) => (
                  <View key={g.key} style={[styles.person, styles.personOn]}>
                    <Pressable
                      onPress={() => {
                        invalidate();
                        setGuests((gs) => gs.filter((x) => x.key !== g.key));
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Remove guest"
                    >
                      <Ionicons name="close-circle" size={24} color={colors.ink500} />
                    </Pressable>
                    <TextInput
                      value={g.name}
                      onChangeText={(v) => setGuests((gs) => gs.map((x) => (x.key === g.key ? { ...x, name: v } : x)))}
                      placeholder="Guest's name"
                      placeholderTextColor={colors.ink500}
                      style={styles.guestName}
                      maxLength={60}
                      accessibilityLabel="Guest's name"
                    />
                    <TextInput
                      value={g.indexText}
                      onChangeText={(v) => setGuests((gs) => gs.map((x) => (x.key === g.key ? { ...x, indexText: v } : x)))}
                      placeholder="Index"
                      placeholderTextColor={colors.ink500}
                      keyboardType="numbers-and-punctuation"
                      style={[styles.indexInput, parseIndex(g.indexText) == null && styles.indexMissing]}
                      maxLength={5}
                      accessibilityLabel="Guest's handicap index"
                    />
                  </View>
                ))}
                <Pressable
                  onPress={() => {
                    invalidate();
                    setGuests((gs) => [...gs, { key: nextKey(), name: "", indexText: "" }]);
                  }}
                  style={styles.addGuest}
                  accessibilityRole="button"
                >
                  <Ionicons name="person-add-outline" size={18} color={colors.green700} />
                  <Text style={styles.link}>Add a guest</Text>
                </Pressable>
              </>
            )}
          </Section>
        ) : null}

        <CourseSection setup={course} />

        <Section title="Format">
          <View style={styles.grid}>
            {FORMATS.map((f) => {
              const on = f.id === format;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => {
                    invalidate();
                    setFormat(f.id);
                  }}
                  style={[styles.option, on && styles.optionOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                >
                  <Text style={[styles.optionTitle, on && styles.optionTitleOn]}>{f.label}</Text>
                  <Text style={[styles.optionHint, on && styles.optionHintOn]}>{f.hint}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.subhead}>Matchplay</Text>
          <View style={styles.row}>
            {MATCH_FORMATS_HERE.map((f) => {
              const on = f.id === format;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => {
                    invalidate();
                    setFormat(f.id);
                  }}
                  style={[styles.pill, on && styles.pillOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${f.label}: ${f.hint}`}
                >
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {matchFormat ? (
            <>
              <View style={styles.teamToggle}>
                <Text style={styles.teamToggleText}>Keep a team score</Text>
                <Switch value={teamsOn} onValueChange={setTeamsOn} trackColor={{ true: colors.green600 }} />
              </View>
              {teamsOn ? (
                <View style={styles.row}>
                  {([0, 1] as const).map((i) => (
                    <View key={i} style={[styles.teamField, { borderColor: SIDE_COLORS[i] }]}>
                      <View style={[styles.teamDot, { backgroundColor: SIDE_COLORS[i] }]} />
                      <TextInput
                        value={teamNames[i]}
                        onChangeText={(t) => setTeamNames((n) => (i === 0 ? [t, n[1]] : [n[0], t]))}
                        style={styles.teamInput}
                        maxLength={30}
                        accessibilityLabel={`Team ${i + 1} name`}
                      />
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
          {!scramble && !matchFormat && !foursomesComp ? (
            <View style={styles.row}>
              {([4, 3] as const).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => {
                    invalidate();
                    setPerGroup(n);
                  }}
                  style={[styles.pill, perGroup === n && styles.pillOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: perGroup === n }}
                >
                  <Text style={[styles.pillText, perGroup === n && styles.pillTextOn]}>{n === 4 ? "Fourballs" : "Threeballs"}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.meta}>
            {entrants.length === 0
              ? "Tick who's playing to see the groups."
              : matchFormat
                ? `${sizing.sizes.length} ${sizing.sizes.length === 1 ? "match" : "matches"}${matchFormat === "matchplay" ? ", one v one" : ", pair v pair"}${sizing.leftOver ? ` · ${sizing.leftOver} left over` : ""} · ${Math.round(formatInfo(matchFormat).allowance * 100)}% handicap allowance`
              : foursomesComp
                ? `${Math.floor(entrants.length / 2)} ${Math.floor(entrants.length / 2) === 1 ? "pair" : "pairs"}, two to a tee group${sizing.leftOver ? " · 1 left over" : ""} · ${greensomes ? "each pair plays off 60% of the lower course handicap and 40% of the higher" : "each pair plays off half its combined course handicaps"}`
              : scramble
                ? `${sizing.sizes.length} ${sizing.sizes.length === 1 ? "team" : "teams"} of ${teamSize}${sizing.leftOver ? ` · ${sizing.leftOver} left over` : ""}`
                : `${teeGroupSummary(sizing.sizes)} · ${Math.round(ALLOWANCE * 100)}% handicap allowance`}
          </Text>
        </Section>

        <Section title="Name">
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Captain's Day" placeholderTextColor={colors.ink500} style={styles.input} maxLength={80} accessibilityLabel="Name of the day" />
        </Section>

        <Section title="The draw" hint="Balanced deals the best and highest handicaps evenly across groups. Tap one player, then another, to swap them.">
          <View style={styles.row}>
            {(["random", "balanced"] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.pill, mode === m && styles.pillOn]} accessibilityRole="radio" accessibilityState={{ checked: mode === m }}>
                <Text style={[styles.pillText, mode === m && styles.pillTextOn]}>{m === "random" ? "Random" : "Balanced by handicap"}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.whenRow}>
            <Pressable
              onPress={() => setSheet("date")}
              disabled={!!outing || !!tripRound}
              style={({ pressed }) => [styles.whenField, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`Date, ${dayLabel(playsOn)}${outing || tripRound ? ", set by the event" : ". Tap to change"}`}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.green700} />
              <View style={{ flex: 1 }}>
                <Text style={styles.whenLabel}>Date</Text>
                <Text style={styles.whenValue} numberOfLines={1}>{dayLabel(playsOn)}</Text>
              </View>
              {outing || tripRound ? null : <Ionicons name="chevron-down" size={16} color={colors.ink500} />}
            </Pressable>
            <Pressable
              onPress={() => setSheet("time")}
              style={({ pressed }) => [styles.whenField, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`First tee, ${firstTee ? clockLabel(firstTee) : "not set"}. Tap to change`}
            >
              <Ionicons name="time-outline" size={20} color={colors.green700} />
              <View style={{ flex: 1 }}>
                <Text style={styles.whenLabel}>{shotgunOn ? "Shotgun at" : "First tee"}</Text>
                <Text style={[styles.whenValue, !firstTee && styles.whenEmpty]} numberOfLines={1}>{firstTee ? clockLabel(firstTee) : "Set time"}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={colors.ink500} />
            </Pressable>
          </View>
          {!matchFormat ? (
            <View style={styles.row}>
              {([false, true] as const).map((on) => (
                <Pressable
                  key={String(on)}
                  onPress={() => setShotgun(on)}
                  style={[styles.pill, shotgun === on && styles.pillOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: shotgun === on }}
                  accessibilityLabel={on ? "Shotgun start: every group off at once, from its own hole" : "Tee times: groups off the 1st in turn"}
                >
                  <Text style={[styles.pillText, shotgun === on && styles.pillTextOn]}>{on ? "Shotgun start" : "Tee times"}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {shotgunOn ? (
            <Text style={styles.meta}>
              Every group goes off at {firstTee ? clockLabel(firstTee) : "the start time"} from its own hole.{" "}
              {drawnNow && drawnNow.length > holesHere
                ? `${drawnNow.length - holesHere} holes have a second group (B), on the par 5s and 4s first. B groups tee off once the A group is clear.`
                : `Up to ${shotgunCapacity(holesHere)} groups — two to a hole.`}
            </Text>
          ) : (
            <View style={styles.timeRow}>
              <Text style={[styles.meta, { flex: 1 }]}>Minutes between groups</Text>
              {GAPS.map((g) => (
                <Pressable key={g} onPress={() => setGap(g)} style={[styles.gap, gap === g && styles.pillOn]} accessibilityRole="radio" accessibilityState={{ checked: gap === g }} accessibilityLabel={`${g} minutes apart`}>
                  <Text style={[styles.pillText, gap === g && styles.pillTextOn]}>{g}′</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            onPress={makeDraw}
            disabled={entrants.length === 0 || sizing.sizes.length === 0}
            style={[styles.drawButton, (entrants.length === 0 || sizing.sizes.length === 0) && styles.startOff]}
            accessibilityRole="button"
          >
            <Ionicons name="shuffle" size={20} color={colors.cream50} />
            <Text style={styles.startLabel}>{drawnNow ? "Draw again" : "Make the draw"}</Text>
          </Pressable>
          {!matchFormat ? (
            <Pressable
              onPress={() => setSecret((v) => !v)}
              style={styles.timeRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: secret }}
              accessibilityLabel="Keep the leaderboard secret until the results are announced"
            >
              <Ionicons name={secret ? "checkbox" : "square-outline"} size={22} color={colors.navy900} />
              <Text style={[styles.meta, { flex: 1 }]}>
                Keep the leaderboard secret — players see only their own group; you see who&apos;s winning. The TV stays live. It&apos;s shown to everyone when you publish the results.
              </Text>
            </Pressable>
          ) : null}
          {wishes && !scramble && !matchFormat && !foursomesComp ? (
            <Pressable
              onPress={() => setUseWishes((v) => !v)}
              style={styles.timeRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: useWishes }}
              accessibilityLabel="Honour playing requests and avoid repeat pairings"
            >
              <Ionicons name={useWishes ? "checkbox" : "square-outline"} size={22} color={colors.navy900} />
              <Text style={[styles.meta, { flex: 1 }]}>Honour playing requests and avoid pairing the same people as recent events</Text>
            </Pressable>
          ) : null}
          {wishNote && drawnNow ? <Text style={styles.meta}>{wishNote}</Text> : null}

          {drawnNow?.map((g, gi) => (
            <View key={gi} style={styles.drawn}>
              <View style={styles.drawnTop}>
                <Text style={styles.drawnTitle}>
                  {unitWord} {gi + 1}
                  {startText(gi) ? ` · starts ${startText(gi)}` : ""}
                  {times[gi] ? ` · ${times[gi]}` : ""}
                </Text>
                <Text style={styles.meta}>Indexes add to {indexTotal(g)}</Text>
              </View>
              {g.map((p, pi) => {
                const on = picked?.group === gi && picked.position === pi;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => tap({ group: gi, position: pi })}
                    style={[styles.drawnPlayer, on && styles.drawnPlayerOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name}, ${unitWord.toLowerCase()} ${gi + 1}. ${picked ? "Tap to swap with the player you picked" : "Tap to pick for a swap"}`}
                  >
                    {paired ? <View style={[styles.sideDot, { backgroundColor: SIDE_COLORS[(foursomesComp ? (pi < 2 ? 1 : 2) : sideOf(pi, g.length)) - 1] }]} /> : null}
                    <Text style={[styles.drawnName, on && styles.drawnNameOn]} numberOfLines={1}>
                      {p.memberId === userId ? `${p.name} (you)` : p.name || "Guest"}
                      {matchFormat && teamsOn ? <Text style={styles.sideName}>{`  ${teamNames[sideOf(pi, g.length) - 1]}`}</Text> : null}
                    </Text>
                    <Text style={[styles.meta, on && styles.drawnNameOn]}>{p.index != null ? indexLabel(p.index) : "no index"}</Text>
                    {on ? <Ionicons name="swap-vertical" size={18} color={colors.cream50} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Section>

        {outing ? (
          <>
            {publishProblem ? <Text style={styles.problem}>{publishProblem}</Text> : null}
            <Pressable
              onPress={() => void publish()}
              disabled={!!publishProblem || publishing}
              style={[styles.start, styles.publish, (!!publishProblem || publishing) && styles.startOff]}
              accessibilityRole="button"
            >
              {publishing ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>{outing.outing.drawPublishedAt ? "Publish the new tee times" : "Publish tee times"}</Text>}
            </Pressable>
            <Text style={styles.footNote}>
              {outingDay ? "Or, with the tees chosen above, start the round now:" : `You start the round on the day, ${outingDateLabel(outing.outing.playsOn)}. Members see their tee times as soon as you publish.`}
            </Text>
          </>
        ) : null}
        {future ? (
          <>
            {futureProblems.length > 0 ? <Text style={styles.problem}>{futureProblems[0]}</Text> : null}
            <Pressable
              onPress={() => void saveFuture()}
              disabled={futureProblems.length > 0 || savingFuture}
              style={[styles.start, (futureProblems.length > 0 || savingFuture) && styles.startOff]}
              accessibilityRole="button"
            >
              {savingFuture ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>{`Save for ${dayLabel(playsOn)}`}</Text>}
            </Pressable>
            <Text style={styles.footNote}>
              It goes under the group&apos;s Events with everyone ticked in it{drawnNow ? " and the draw as their tee times" : ""}. Format and tees are chosen when you start it on the day.
            </Text>
          </>
        ) : outing && !outingDay ? null : (
        <>
        {problems.length > 0 ? <Text style={styles.problem}>{problems[0]}</Text> : null}
        <Pressable onPress={() => void start()} disabled={problems.length > 0 || saving} style={[styles.start, (problems.length > 0 || saving) && styles.startOff]} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>{tripRound ? "Start the round" : matchFormat ? "Start the matches" : foursomesComp ? "Start the foursomes" : scramble ? "Start the scramble" : "Start the day"}</Text>}
        </Pressable>
        <Text style={styles.footNote}>Everyone on PinPals gets their card and the leaderboard on their phone. Guests are scored by their group.</Text>
        </>
        )}
      </ScrollView>
      <DateSheet open={sheet === "date"} title="Which day?" value={playsOn} onClose={() => setSheet(null)} onChange={setPlaysOn} />
      <TimeSheet open={sheet === "time"} title="First tee" value={firstTee} onClose={() => setSheet(null)} onChange={setFirstTee} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  groupChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingLeft: 6, paddingRight: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, maxWidth: 240 },
  groupChipOn: { borderColor: colors.green700, backgroundColor: colors.green100, borderWidth: 2 },
  groupChipText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900, flexShrink: 1 },
  groupChipTextOn: { fontFamily: fonts.bodyBold, color: colors.green800 },
  bulk: { flexDirection: "row", justifyContent: "space-between" },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  person: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  personOn: { borderColor: colors.green600 },
  personMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 50 },
  personName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  guestName: { flex: 1, minHeight: 40, borderBottomWidth: 1, borderBottomColor: colors.line, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  indexInput: { width: 70, minHeight: 40, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900, backgroundColor: colors.cream50 },
  indexMissing: { borderColor: colors.red600 },
  addGuest: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 46, borderRadius: radii.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.line },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: { flexBasis: "47%", flexGrow: 1, padding: 12, gap: 2, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  optionOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  optionTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  optionTitleOn: { color: colors.cream50 },
  optionHint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  optionHintOn: { color: colors.cream100 },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  pill: { minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  pillText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  pillTextOn: { color: colors.cream50, fontFamily: fonts.bodyBold },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  whenRow: { flexDirection: "row", gap: spacing.sm },
  subhead: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green700, marginTop: spacing.xs },
  teamToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  teamToggleText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  teamField: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 2, backgroundColor: colors.surface },
  teamDot: { width: 14, height: 14, borderRadius: 7 },
  teamInput: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  sideDot: { width: 10, height: 10, borderRadius: 5 },
  sideName: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  whenField: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 58, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  whenLabel: { fontFamily: fonts.bodySemi, fontSize: 11.5, letterSpacing: 0.6, textTransform: "uppercase", color: colors.ink500 },
  whenValue: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  whenEmpty: { color: colors.green700 },
  gap: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  drawButton: { flexDirection: "row", gap: 8, minHeight: 50, borderRadius: radii.pill, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  drawn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.sm, gap: 6 },
  drawnTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4 },
  drawnTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.navy900 },
  drawnPlayer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radii.md, backgroundColor: colors.cream50 },
  drawnPlayerOn: { backgroundColor: colors.green700 },
  drawnName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  drawnNameOn: { color: colors.cream50 },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  start: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  startOff: { backgroundColor: colors.ink500, opacity: 0.6 },
  startLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  publish: { backgroundColor: colors.navy900 },
  outingBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: colors.gold400 },
  outingBannerText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  footNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, textAlign: "center" },
});
