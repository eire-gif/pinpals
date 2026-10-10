import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Section } from "@/components/form-bits";
import { TimeSheet } from "@/components/time-sheet";
import { clockLabel } from "@/lib/tee-time-post";
import { CourseSection, useCourseSetup } from "@/components/live-course-section";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { SIDE_COLORS, SIDE_TEXT, createMatchDay, type NewMatch } from "@/lib/live-match-days";
import {
  MATCH_FORMATS,
  courseHandicap,
  formatInfo,
  parseIndex,
  playingHandicap,
  type MatchFormat,
} from "@/lib/live-scoring";
import { listConnections, type Member } from "@/lib/members";
import { loadMyProfile } from "@/lib/profile";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Set up a match day: course, optional teams, then the matches — each with
 * its own format, tee time and players on each side.
 *
 * The organiser can put themselves, their PinPals and guests by name on the
 * card (live_match_day_create refuses anyone else), and nobody plays two
 * matches. When the day starts, every PinPal on it is notified with their
 * own match (src/lib/live-match-notifications.ts on the website).
 *
 * Handicaps work as in a single round: an index per player, turned into a
 * course handicap from this course's rating and slope. The format's
 * allowance (fourball 90%, foursomes 50% of the pair, greensomes 60/40) is
 * applied when the match is scored, by live-scoring.ts.
 */

type Slot = {
  key: string;
  memberId: string | null;
  name: string;
  indexText: string;
};

type DraftMatch = {
  key: string;
  format: MatchFormat;
  teeTime: string;
  sides: [(Slot | null)[], (Slot | null)[]];
};

let seq = 0;
const nextKey = (p: string) => `${p}${++seq}`;

const perSide = (f: MatchFormat) => (f === "matchplay" ? 1 : 2);
const emptySides = (f: MatchFormat): DraftMatch["sides"] => [Array(perSide(f)).fill(null), Array(perSide(f)).fill(null)];

type Picking = { match: string; side: 0 | 1; index: number } | null;

/** "09:20" + 10 → "09:30"; "" stays "" (no time to follow). */
function addMinutes(time: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return "";
  const total = (Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function NewMatchDay() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const course = useCourseSetup();

  const [title, setTitle] = useState("");
  const [teamsOn, setTeamsOn] = useState(true);
  const [teamNames, setTeamNames] = useState<[string, string]>(["Blues", "Golds"]);
  // Which match's tee time the clock sheet is open for.
  const [timeFor, setTimeFor] = useState<string | null>(null);
  const [matches, setMatches] = useState<DraftMatch[]>([{ key: nextKey("m"), format: "fourball", teeTime: "", sides: emptySides("fourball") }]);
  const [me, setMe] = useState<{ name: string; index: string } | null>(null);
  const [pals, setPals] = useState<Member[] | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void loadMyProfile(userId).then((p) => {
      const name = p ? [p.firstName, p.lastName].filter(Boolean).join(" ") || "You" : "You";
      const index = p?.handicap != null ? String(p.handicap) : "";
      setMe({ name, index });
      // Start with the organiser in the first slot of the first match.
      setMatches((ms) =>
        ms.length === 1 && ms[0].sides[0][0] == null
          ? [{ ...ms[0], sides: [[{ key: nextKey("s"), memberId: userId, name, indexText: index }, ...ms[0].sides[0].slice(1)], ms[0].sides[1]] }]
          : ms
      );
    });
    void listConnections(userId)
      .then((c) => setPals(c.accepted))
      .catch(() => setPals([]));
  }, [userId]);

  const used = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matches) for (const side of m.sides) for (const s of side) if (s?.memberId) ids.add(s.memberId);
    return ids;
  }, [matches]);

  const updateMatch = (key: string, change: (m: DraftMatch) => DraftMatch) =>
    setMatches((ms) => ms.map((m) => (m.key === key ? change(m) : m)));

  const setFormat = (key: string, format: MatchFormat) =>
    updateMatch(key, (m) => {
      const n = perSide(format);
      const resize = (side: (Slot | null)[]) => [...side.slice(0, n), ...Array(Math.max(0, n - side.length)).fill(null)];
      return { ...m, format, sides: [resize(m.sides[0]), resize(m.sides[1])] };
    });

  const setSlot = (p: NonNullable<Picking>, slot: Slot | null) =>
    updateMatch(p.match, (m) => {
      const sides: DraftMatch["sides"] = [[...m.sides[0]], [...m.sides[1]]];
      sides[p.side][p.index] = slot;
      return { ...m, sides };
    });

  const editSlot = (match: string, side: 0 | 1, index: number, change: Partial<Slot>) =>
    updateMatch(match, (m) => {
      const sides: DraftMatch["sides"] = [[...m.sides[0]], [...m.sides[1]]];
      const cur = sides[side][index];
      if (cur) sides[side][index] = { ...cur, ...change };
      return { ...m, sides };
    });

  const addMatch = () =>
    // The next group goes off ten minutes after the last one, if it had a time.
    setMatches((ms) => [
      ...ms,
      {
        key: nextKey("m"),
        format: ms[ms.length - 1]?.format ?? "fourball",
        teeTime: addMinutes(ms[ms.length - 1]?.teeTime ?? "", 10),
        sides: emptySides(ms[ms.length - 1]?.format ?? "fourball"),
      },
    ]);

  const ch = (indexText: string) => {
    const index = parseIndex(indexText);
    if (index == null) return null;
    return { index, ...courseHandicap(index, { slope: course.slope, courseRating: course.rating, par: course.par }) };
  };

  const problems: string[] = [...course.problems];
  if (title.trim() === "") problems.push("Give the day a name");
  if (teamsOn && (teamNames[0].trim() === "" || teamNames[1].trim() === "")) problems.push("Name both teams");
  for (const [i, m] of matches.entries()) {
    const slots = [...m.sides[0], ...m.sides[1]];
    if (slots.some((s) => s == null)) problems.push(`Match ${i + 1} needs ${perSide(m.format) * 2} players`);
    else if (slots.some((s) => s!.name.trim() === "")) problems.push(`A guest in match ${i + 1} needs a name`);
    else if (slots.some((s) => ch(s!.indexText) == null)) problems.push(`Every player in match ${i + 1} needs a handicap index`);
    if (m.teeTime.trim() !== "" && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(m.teeTime.trim())) problems.push(`Match ${i + 1}'s tee time should look like 09:20`);
  }

  const start = async () => {
    if (problems.length > 0 || !course.club) return;
    setSaving(true);
    try {
      const payload: NewMatch[] = matches.map((m) => ({
        format: m.format,
        teeTime: m.teeTime.trim() || null,
        players: m.sides.flatMap((side, si) =>
          side.map((s) => {
            const w = ch(s!.indexText)!;
            return {
              memberId: s!.memberId,
              name: s!.name.trim(),
              handicapIndex: w.index,
              courseHandicap: w.courseHandicap,
              playingHandicap: playingHandicap(w.courseHandicap, formatInfo(m.format).allowance),
              estimated: w.estimated,
              side: (si + 1) as 1 | 2,
            };
          })
        ),
      }));
      const id = await createMatchDay(
        {
          title: title.trim(),
          courseName: course.club.name,
          clubId: course.club.id,
          teeName: course.teeName.trim() || null,
          holes: course.holes,
          courseRating: course.rating,
          slope: course.slope,
          parTotal: course.par,
          teamNames: teamsOn ? [teamNames[0].trim(), teamNames[1].trim()] : null,
        },
        payload,
        course.holeCard()
      );
      router.replace({ pathname: "/live/day/[id]", params: { id: String(id), created: "1" } });
    } catch (e) {
      Alert.alert("Couldn't start the match day", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOn("liveScoring")) return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;

  const memberCount = used.size - (userId && used.has(userId) ? 1 : 0);
  const sideLabel = (n: 0 | 1) => (teamsOn ? teamNames[n] || (n === 0 ? "Side 1" : "Side 2") : n === 0 ? "Side 1" : "Side 2");

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Section title="Name">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Saturday Society"
            placeholderTextColor={colors.ink500}
            style={styles.input}
            maxLength={80}
            accessibilityLabel="Name of the match day"
          />
        </Section>

        <CourseSection setup={course} />

        <Section title="Teams" hint="A point for each match won, a half each for a halved match.">
          <View style={styles.teamRow}>
            <Text style={styles.body}>Keep a team score</Text>
            <Switch value={teamsOn} onValueChange={setTeamsOn} trackColor={{ true: colors.green600 }} accessibilityLabel="Keep a team score" />
          </View>
          {teamsOn ? (
            <View style={styles.teamRow}>
              {([0, 1] as const).map((n) => (
                <View key={n} style={[styles.teamName, { borderColor: SIDE_COLORS[n] }]}>
                  <View style={[styles.teamSwatch, { backgroundColor: SIDE_COLORS[n] }]} />
                  <TextInput
                    value={teamNames[n]}
                    onChangeText={(v) => setTeamNames((t) => (n === 0 ? [v, t[1]] : [t[0], v]))}
                    style={styles.teamInput}
                    maxLength={30}
                    accessibilityLabel={`Team ${n + 1} name`}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </Section>

        <Section title="Matches" hint="Each match is played in its own group. Players score their own match; everyone sees every match.">
          {matches.map((m, mi) => (
            <View key={m.key} style={styles.match}>
              <View style={styles.matchTop}>
                <Text style={styles.matchTitle}>Match {mi + 1}</Text>
                {/* Oct 2026: a clock, not the punctuation keyboard. */}
                <Pressable
                  onPress={() => setTimeFor(m.key)}
                  style={({ pressed }) => [styles.timeButton, m.teeTime ? styles.timeButtonSet : null, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel={m.teeTime ? `Match ${mi + 1} tees off ${m.teeTime}. Change` : `Add match ${mi + 1}'s tee time`}
                >
                  <Ionicons name="time-outline" size={16} color={m.teeTime ? colors.cream50 : colors.green700} />
                  <Text style={[styles.timeButtonText, m.teeTime ? styles.timeButtonTextSet : null]}>
                    {m.teeTime ? clockLabel(m.teeTime) : "Tee time"}
                  </Text>
                </Pressable>
                {matches.length > 1 ? (
                  <Pressable
                    onPress={() => setMatches((ms) => ms.filter((x) => x.key !== m.key))}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove match ${mi + 1}`}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.ink500} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.formats}>
                {MATCH_FORMATS.map((f) => {
                  const on = m.format === f.id;
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => setFormat(m.key, f.id as MatchFormat)}
                      style={[styles.format, on && styles.formatOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.formatText, on && styles.formatTextOn]}>{f.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {([0, 1] as const).map((side) => (
                <View key={side} style={[styles.side, { borderLeftColor: SIDE_COLORS[side] }]}>
                  <View style={[styles.sideTag, { backgroundColor: SIDE_COLORS[side] }]}>
                    <Text style={[styles.sideTagText, { color: SIDE_TEXT[side] }]}>{sideLabel(side)}</Text>
                  </View>
                  {m.sides[side].map((slot, si) => {
                    const here = { match: m.key, side, index: si };
                    const isPicking = picking?.match === m.key && picking.side === side && picking.index === si;
                    if (!slot) {
                      return (
                        <View key={si}>
                          <Pressable
                            onPress={() => setPicking(isPicking ? null : here)}
                            style={styles.emptySlot}
                            accessibilityRole="button"
                            accessibilityLabel={`Add a player to ${sideLabel(side)}`}
                          >
                            <Ionicons name="person-add-outline" size={18} color={colors.green700} />
                            <Text style={styles.link}>Add player</Text>
                          </Pressable>
                          {isPicking ? (
                            <View style={styles.picker}>
                              {userId && me && !used.has(userId) ? (
                                <PickRow
                                  label={`${me.name} (you)`}
                                  meta={me.index ? `Index ${me.index}` : "Add your index"}
                                  onPress={() => {
                                    setSlot(here, { key: nextKey("s"), memberId: userId, name: me.name, indexText: me.index });
                                    setPicking(null);
                                  }}
                                />
                              ) : null}
                              {pals == null ? (
                                <ActivityIndicator color={colors.green700} />
                              ) : (
                                pals
                                  .filter((p) => !used.has(p.id))
                                  .map((p) => (
                                    <PickRow
                                      key={p.id}
                                      label={p.name}
                                      meta={p.handicap != null ? `Index ${p.handicap}` : "Handicap not shared"}
                                      onPress={() => {
                                        setSlot(here, { key: nextKey("s"), memberId: p.id, name: p.name, indexText: p.handicap != null ? String(p.handicap) : "" });
                                        setPicking(null);
                                      }}
                                    />
                                  ))
                              )}
                              <PickRow
                                label="A guest"
                                meta="Someone not on PinPals. Their partner scores for them."
                                onPress={() => {
                                  setSlot(here, { key: nextKey("s"), memberId: null, name: "", indexText: "" });
                                  setPicking(null);
                                }}
                              />
                            </View>
                          ) : null}
                        </View>
                      );
                    }
                    const w = ch(slot.indexText);
                    return (
                      <View key={slot.key} style={styles.slot}>
                        <View style={{ flex: 1, gap: 2 }}>
                          {slot.memberId ? (
                            <Text style={styles.playerName} numberOfLines={1}>
                              {slot.memberId === userId ? `${slot.name} (you)` : slot.name}
                            </Text>
                          ) : (
                            <TextInput
                              value={slot.name}
                              onChangeText={(v) => editSlot(m.key, side, si, { name: v })}
                              placeholder="Guest's name"
                              placeholderTextColor={colors.ink500}
                              style={styles.nameInput}
                              maxLength={60}
                              accessibilityLabel="Guest's name"
                            />
                          )}
                          <Text style={styles.meta}>
                            {w ? `Course handicap ${w.courseHandicap}${w.estimated ? " (estimated)" : ""}` : "Index, e.g. 14.2 or +1.5"}
                          </Text>
                        </View>
                        <TextInput
                          value={slot.indexText}
                          onChangeText={(v) => editSlot(m.key, side, si, { indexText: v })}
                          placeholder="Index"
                          placeholderTextColor={colors.ink500}
                          keyboardType="numbers-and-punctuation"
                          style={styles.indexInput}
                          maxLength={5}
                          accessibilityLabel={`${slot.name || "Guest"}'s handicap index`}
                        />
                        <Pressable
                          onPress={() => setSlot(here, null)}
                          hitSlop={10}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${slot.name || "guest"}`}
                        >
                          <Ionicons name="close-circle" size={22} color={colors.ink500} />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          ))}

          {matches.length < 12 ? (
            <Pressable onPress={addMatch} style={styles.addMatch} accessibilityRole="button">
              <Ionicons name="add" size={20} color={colors.green700} />
              <Text style={styles.link}>Add a match</Text>
            </Pressable>
          ) : null}
        </Section>

        {problems.length > 0 ? <Text style={styles.problem}>{problems[0]}</Text> : null}
        <Text style={styles.footNote}>
          {memberCount > 0
            ? `${memberCount} PinPal${memberCount === 1 ? "" : "s"} will get a notification with their match.`
            : "PinPals you add get a notification with their match."}
        </Text>

        <Pressable
          onPress={() => void start()}
          disabled={problems.length > 0 || saving}
          style={({ pressed }) => [styles.start, (problems.length > 0 || saving) && styles.startOff, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: problems.length > 0 || saving }}
        >
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>Start match day</Text>}
        </Pressable>
      </ScrollView>
      {(() => {
        const idx = matches.findIndex((x) => x.key === timeFor);
        const cur = idx >= 0 ? matches[idx] : null;
        const prev = idx > 0 ? matches[idx - 1].teeTime : "";
        const suggestions = prev
          ? [8, 10, 12].map((n) => ({ label: `+${n} min`, time: addMinutes(prev, n) }))
          : [];
        return (
          <TimeSheet
            open={cur != null}
            title={cur ? `Match ${idx + 1} tees off` : ""}
            value={cur?.teeTime ?? ""}
            suggestions={suggestions}
            onClose={() => setTimeFor(null)}
            onChange={(t) => cur && updateMatch(cur.key, (x) => ({ ...x, teeTime: t }))}
          />
        );
      })()}
    </KeyboardAvoidingView>
  );
}

function PickRow({ label, meta, onPress }: { label: string; meta: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.pickRow} accessibilityRole="button">
      <Text style={styles.playerName}>{label}</Text>
      <Text style={styles.meta}>{meta}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  body: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, flex: 1 },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  teamRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  teamName: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 2, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.surface },
  teamSwatch: { width: 14, height: 14, borderRadius: 7 },
  teamInput: { flex: 1, minHeight: 44, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  match: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  matchTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  matchTitle: { flex: 1, fontFamily: fonts.display, fontSize: 20, color: colors.navy900 },
  timeButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50 },
  timeButtonSet: { backgroundColor: colors.green700, borderColor: colors.green700 },
  timeButtonText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.green700 },
  timeButtonTextSet: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  formats: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  format: { minHeight: 40, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, justifyContent: "center" },
  formatOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  formatText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  formatTextOn: { color: colors.cream50 },
  side: { borderLeftWidth: 4, paddingLeft: spacing.sm, gap: 6 },
  sideTag: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill },
  sideTagText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  emptySlot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.line,
  },
  picker: { marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.cream50 },
  pickRow: { minHeight: 52, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 4 },
  slot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52 },
  playerName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  nameInput: { minHeight: 36, borderBottomWidth: 1, borderBottomColor: colors.line, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  indexInput: {
    width: 64,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    textAlign: "center",
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.cream50,
  },
  addMatch: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 48, borderRadius: radii.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.line },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  footNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, textAlign: "center" },
  start: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  startOff: { backgroundColor: colors.ink500 },
  startLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
