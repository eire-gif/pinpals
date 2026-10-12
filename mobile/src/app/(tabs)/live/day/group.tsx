import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { Section } from "@/components/form-bits";
import { GroupIcon } from "@/components/group-bits";
import { CourseSection, useCourseSetup } from "@/components/live-course-section";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { draw, indexTotal, swapPlayers, teamSizes, teeGroupSizes, teeTimes, type DrawMode, type DrawPlayer, type Seat } from "@/lib/group-draw";
import { canDrawFrom, loadGroupRoster, loadMyGroups, type Group, type RosterPlayer } from "@/lib/groups-data";
import type { GroupRole } from "@/lib/groups";
import { createFourballDay, createScrambleDay } from "@/lib/live-match-days";
import { courseHandicap, indexLabel, parseIndex, playingHandicap, scrambleHandicap } from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Start a day from a group (0121): pick the crew or society, tick who's
 * playing, choose the format, and let the app draw the groups — at random,
 * or balanced by handicap — then swap anyone before starting.
 *
 *   Stableford / Stroke play → a society day: one card per tee group, one
 *                              individual leaderboard (live_fourball_day_create)
 *   Scramble 2s / 4s         → a scramble day: one card per team, one team
 *                              leaderboard (live_scramble_day_create)
 *
 * Who can be drawn is the database's rule (live_can_add_player): anyone in a
 * crew or trip, or everyone in a society you run. Guests can be added by
 * name. Handicaps: a member's shared index is filled in; anyone else's is
 * typed here, and the course handicap follows from the course chosen.
 */

type Format = "stableford" | "stroke" | "scramble2" | "scramble4";

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "stableford", label: "Stableford", hint: "Tee groups, everyone on one points leaderboard" },
  { id: "stroke", label: "Stroke play", hint: "Tee groups, ranked by net score" },
  { id: "scramble4", label: "Scramble 4s", hint: "Teams of four, one ball per team" },
  { id: "scramble2", label: "Scramble 2s", hint: "Pairs, one ball per pair" },
];

/** WHS individual stroke-play allowance, for Stableford and stroke play. */
const ALLOWANCE = 0.95;
const GAPS = [8, 9, 10, 12];

type Entrant = DrawPlayer & { memberId: string | null; indexText: string };
type Guest = { key: string; name: string; indexText: string };

/** "1 tee group of 1 player", "3 tee groups — 4, 3 and 3 players". */
function teeGroupSummary(sizes: number[]): string {
  if (sizes.length === 1) return `1 tee group of ${sizes[0]} ${sizes[0] === 1 ? "player" : "players"}`;
  const list = sizes.length > 1 ? `${sizes.slice(0, -1).join(", ")} and ${sizes[sizes.length - 1]}` : "";
  return `${sizes.length} tee groups — ${list} players`;
}

let seq = 0;
const nextKey = () => `g${++seq}`;

export default function DrawFromGroup() {
  const { group: groupParam } = useLocalSearchParams<{ group?: string }>();
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
  const [mode, setMode] = useState<DrawMode>("random");
  const [title, setTitle] = useState("");
  const [firstTee, setFirstTee] = useState("");
  const [gap, setGap] = useState(10);
  const [drawn, setDrawn] = useState<Entrant[][] | null>(null);
  const [picked, setPicked] = useState<Seat | null>(null);
  const [saving, setSaving] = useState(false);

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
    void loadGroupRoster(groupId)
      .then((people) => {
        setRoster(people);
        const all = groupKind === "society" ? people.filter((p) => p.id === userId) : people;
        setTicked(new Map(all.map((p) => [p.id, p.index != null ? indexLabel(p.index) : ""])));
      })
      .catch(() => setRoster([]));
  }, [groupId, groupKind, groupName, userId]);

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
  const teamSize = format === "scramble2" ? 2 : 4;
  const sizing = scramble ? teamSizes(entrants.length, teamSize) : { sizes: teeGroupSizes(entrants.length, perGroup), leftOver: 0 };

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
    setDrawn(draw(entrants, sizing.sizes, mode));
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

  const times = drawnNow ? teeTimes(firstTee, gap, drawnNow.length) : [];
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
  if (!scramble && sizing.sizes.length > 40) problems.push("40 groups at most");
  if (scramble && sizing.sizes.length > 60) problems.push("60 teams at most");
  problems.push(...course.problems);
  if (title.trim() === "") problems.push("Give the day a name");
  if (!drawnNow) problems.push("Make the draw");

  const start = async () => {
    if (problems.length > 0 || !drawnNow || !course.club) return;
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
      if (scramble) {
        id = await createScrambleDay(
          { ...day, size: teamSize, driveMinimum: null },
          drawnNow.map((team, ti) => {
            const ws = team.map((p) => handicaps(p)!);
            const hcp = scrambleHandicap(ws.map((w) => w.courseHandicap));
            return {
              name: null,
              teeTime: times[ti] || null,
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
      router.replace({ pathname: "/live/day/[id]", params: { id: String(id), created: "1" } });
    } catch (e) {
      Alert.alert("Couldn't start the day", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
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
        action={{ label: "Your groups", onPress: () => router.push("/groups") }}
      />
    );
  }

  const unitWord = scramble ? "Team" : "Group";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
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
          {!scramble ? (
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
          <View style={styles.timeRow}>
            <TextInput
              value={firstTee}
              onChangeText={setFirstTee}
              placeholder="First tee, e.g. 09:00"
              placeholderTextColor={colors.ink500}
              keyboardType="numbers-and-punctuation"
              style={[styles.input, { flex: 1 }]}
              maxLength={5}
              accessibilityLabel="First tee time"
            />
            {GAPS.map((g) => (
              <Pressable key={g} onPress={() => setGap(g)} style={[styles.gap, gap === g && styles.pillOn]} accessibilityRole="radio" accessibilityState={{ checked: gap === g }} accessibilityLabel={`${g} minutes apart`}>
                <Text style={[styles.pillText, gap === g && styles.pillTextOn]}>{g}′</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={makeDraw}
            disabled={entrants.length === 0 || sizing.sizes.length === 0}
            style={[styles.drawButton, (entrants.length === 0 || sizing.sizes.length === 0) && styles.startOff]}
            accessibilityRole="button"
          >
            <Ionicons name="shuffle" size={20} color={colors.cream50} />
            <Text style={styles.startLabel}>{drawnNow ? "Draw again" : "Make the draw"}</Text>
          </Pressable>

          {drawnNow?.map((g, gi) => (
            <View key={gi} style={styles.drawn}>
              <View style={styles.drawnTop}>
                <Text style={styles.drawnTitle}>
                  {unitWord} {gi + 1}
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
                    <Text style={[styles.drawnName, on && styles.drawnNameOn]} numberOfLines={1}>
                      {p.memberId === userId ? `${p.name} (you)` : p.name || "Guest"}
                    </Text>
                    <Text style={[styles.meta, on && styles.drawnNameOn]}>{p.index != null ? indexLabel(p.index) : "no index"}</Text>
                    {on ? <Ionicons name="swap-vertical" size={18} color={colors.cream50} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Section>

        {problems.length > 0 ? <Text style={styles.problem}>{problems[0]}</Text> : null}
        <Pressable onPress={() => void start()} disabled={problems.length > 0 || saving} style={[styles.start, (problems.length > 0 || saving) && styles.startOff]} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>{scramble ? "Start the scramble" : "Start the day"}</Text>}
        </Pressable>
        <Text style={styles.footNote}>Everyone on PinPals gets their card and the leaderboard on their phone. Guests are scored by their group.</Text>
      </ScrollView>
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
  footNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, textAlign: "center" },
});
