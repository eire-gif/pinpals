import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSection, useCourseSetup } from "@/components/live-course-section";
import { Section } from "@/components/form-bits";
import { ScrambleOptions } from "@/components/scramble-options";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { createLiveRound } from "@/lib/live-rounds";
import {
  LIVE_FORMATS,
  courseHandicap,
  formatInfo,
  parseIndex,
  playingHandicap,
  scrambleHandicap,
  type LiveFormat,
  type ScrambleSize,
} from "@/lib/live-scoring";
import { listConnections, type Member } from "@/lib/members";
import { loadMyProfile } from "@/lib/profile";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Set up a round: course and tees, format, players.
 *
 * Every player's handicap is an INDEX, typed or carried over from their
 * profile, and "plays off" beside it is worked out live from the course's
 * rating and slope (live-scoring.ts) as you type — so the number a member
 * checks is the one they'll actually get shots from.
 *
 * Members can add themselves, their PinPals and guests by name. Only
 * accepted PinPals are offered: putting a stranger on a leaderboard is
 * refused by live_round_create anyway, and offering it would be a trap.
 */

type DraftPlayer = {
  key: string;
  memberId: string | null;
  name: string;
  indexText: string;
  isMe: boolean;
};


let keySeq = 0;
const nextKey = () => `p${++keySeq}`;

export default function NewLiveRound() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const course = useCourseSetup();
  const { club, rating, slope, par, holes } = course;
  const [format, setFormat] = useState<LiveFormat>("stableford");
  const [players, setPlayers] = useState<DraftPlayer[]>([]);
  const [pals, setPals] = useState<Member[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Scramble (0113): one team here; several teams is a scramble day.
  const [size, setSize] = useState<ScrambleSize>(4);
  const [teamName, setTeamName] = useState("");
  const [driveMinimum, setDriveMinimum] = useState<number | null>(null);
  const scramble = format === "scramble";

  // Me first, with the handicap from my profile if I've given one.
  useEffect(() => {
    if (!userId) return;
    void loadMyProfile(userId).then((me) => {
      const name = me ? [me.firstName, me.lastName].filter(Boolean).join(" ") || "You" : "You";
      setPlayers((ps) =>
        ps.some((p) => p.isMe)
          ? ps
          : [{ key: nextKey(), memberId: userId, name, indexText: me?.handicap != null ? String(me.handicap) : "", isMe: true }, ...ps]
      );
    });
  }, [userId]);

  const info = formatInfo(format);

  // Plays-off for every row, recomputed as anything above changes.
  const worked = useMemo(
    () =>
      players.map((p) => {
        const index = parseIndex(p.indexText);
        if (index == null) return null;
        const ch = courseHandicap(index, { slope, courseRating: rating, par });
        return { index, ...ch, playing: playingHandicap(ch.courseHandicap, info.allowance) };
      }),
    [players, slope, rating, par, info.allowance]
  );

  // A scramble team's handicap: WHS shares of each course handicap, summed
  // then rounded. Only once every player has an index and the team is full.
  const team = useMemo(() => {
    if (!scramble || players.length !== size || worked.some((w) => w == null)) return null;
    return scrambleHandicap(worked.map((w) => w!.courseHandicap));
  }, [scramble, players.length, size, worked]);

  const problems: string[] = [];
  problems.push(...course.problems);
  if (players.length === 0) problems.push("Add at least one player");
  if (worked.some((w) => w == null)) problems.push("Every player needs a handicap index");
  if (players.some((p) => p.name.trim() === "")) problems.push("Every guest needs a name");
  if (format === "matchplay" && players.length !== 2) problems.push("Singles matchplay is two players");
  if (scramble && players.length !== size) problems.push(`A team of ${size} needs ${size} players`);

  const update = (key: string, change: Partial<DraftPlayer>) =>
    setPlayers((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const remove = (key: string) => setPlayers((ps) => ps.filter((p) => p.key !== key));

  const openPals = async () => {
    setPicking(true);
    if (pals == null && userId) {
      try {
        setPals((await listConnections(userId)).accepted);
      } catch {
        setPals([]);
      }
    }
  };

  const addPal = (m: Member) => {
    setPlayers((ps) => [...ps, { key: nextKey(), memberId: m.id, name: m.name, indexText: m.handicap != null ? String(m.handicap) : "", isMe: false }]);
    setPicking(false);
  };

  const addGuest = () =>
    setPlayers((ps) => [...ps, { key: nextKey(), memberId: null, name: "", indexText: "", isMe: false }]);

  const start = async () => {
    if (!club || problems.length > 0) return;
    setSaving(true);
    try {
      const holeCard = course.holeCard();
      const id = await createLiveRound(
        {
          courseName: club.name,
          clubId: club.id,
          teeName: course.teeName.trim() || null,
          format,
          holes,
          courseRating: rating,
          slope,
          parTotal: par,
          allowance: scramble ? (size === 4 ? 0.25 : 0.35) : info.allowance,
          scramble: scramble && team ? { size, teamName: teamName.trim() || null, teamHandicap: team.team, driveMinimum } : undefined,
        },
        players.map((p, i) => ({
          memberId: p.memberId,
          name: p.name.trim(),
          handicapIndex: worked[i]!.index,
          courseHandicap: worked[i]!.courseHandicap,
          // In a scramble, each player's share of the team handicap.
          playingHandicap: scramble && team ? Math.round(team.shares[i]) : worked[i]!.playing,
          estimated: worked[i]!.estimated,
        })),
        holeCard
      );
      router.replace({ pathname: "/live/round/[id]", params: { id: String(id) } });
    } catch (e) {
      Alert.alert("Couldn't start the round", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOn("liveScoring")) {
    return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;
  }

  const added = new Set(players.map((p) => p.memberId).filter(Boolean));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <CourseSection setup={course} />

        <Section title="Format">
          <View style={styles.formats}>
            {LIVE_FORMATS.map((f) => {
              const on = format === f.id;
              return (
                <Pressable
                  key={f.id}
                  disabled={!f.available}
                  onPress={() => setFormat(f.id)}
                  style={[styles.format, on && styles.formatOn, !f.available && styles.formatOff]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !f.available }}
                >
                  <Text style={[styles.formatLabel, !f.available && styles.muted]}>{f.label}</Text>
                  <Text style={[styles.formatBlurb, on && styles.formatBlurbOn]}>{f.available ? f.blurb : f.matchDay ? "Use a match day" : "Coming soon"}</Text>
                </Pressable>
              );
            })}
          </View>
          {scramble ? null : <Text style={styles.hint}>Handicap allowance: {Math.round(info.allowance * 100)}%</Text>}
        </Section>

        {scramble ? (
          <>
            <Pressable
              onPress={() => router.push("/live/day/scramble")}
              style={({ pressed }) => [styles.dayLink, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <Ionicons name="people" size={20} color={colors.gold400} />
              <View style={{ flex: 1 }}>
                <Text style={styles.dayLinkTitle}>Several teams?</Text>
                <Text style={styles.dayLinkBody}>Start a scramble day — every team on one live leaderboard.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.gold400} />
            </Pressable>
            <Section title="Team name" hint="Optional. Shown on the leaderboard.">
              <TextInput
                value={teamName}
                onChangeText={setTeamName}
                placeholder="e.g. The Bandits"
                placeholderTextColor={colors.ink500}
                style={styles.input}
                maxLength={30}
                accessibilityLabel="Team name"
              />
            </Section>
            <ScrambleOptions size={size} onSize={setSize} driveMinimum={driveMinimum} onDriveMinimum={setDriveMinimum} holes={holes} />
          </>
        ) : null}

        <Section title="Players" hint="Enter each player's handicap index. Plays-off is worked out for this course.">
          <View style={styles.players}>
            {players.map((p, i) => {
              const w = worked[i];
              return (
                <View key={p.key} style={[styles.player, i > 0 && styles.playerDivider]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    {p.memberId ? (
                      <Text style={styles.playerName} numberOfLines={1}>
                        {p.isMe ? `${p.name} (you)` : p.name}
                      </Text>
                    ) : (
                      <TextInput
                        value={p.name}
                        onChangeText={(name) => update(p.key, { name })}
                        placeholder="Guest's name"
                        placeholderTextColor={colors.ink500}
                        style={styles.nameInput}
                        maxLength={60}
                        accessibilityLabel="Guest's name"
                      />
                    )}
                    <Text style={styles.playerMeta}>
                      {w == null
                        ? "Enter an index, e.g. 14.2 or +1.5"
                        : `Course handicap ${w.courseHandicap}${w.estimated ? " (no slope, estimated)" : ""}`}
                    </Text>
                  </View>
                  <TextInput
                    value={p.indexText}
                    onChangeText={(indexText) => update(p.key, { indexText })}
                    placeholder="Index"
                    placeholderTextColor={colors.ink500}
                    keyboardType="numbers-and-punctuation"
                    style={styles.indexInput}
                    maxLength={5}
                    accessibilityLabel={`${p.name || "Guest"}'s handicap index`}
                  />
                  <View style={styles.playsOff}>
                    <Text style={styles.playsOffNumber}>{scramble ? (team ? team.shares[i] : "–") : w ? w.playing : "–"}</Text>
                    <Text style={styles.playsOffLabel}>{scramble ? "share" : "plays off"}</Text>
                  </View>
                  {!p.isMe ? (
                    <Pressable onPress={() => remove(p.key)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${p.name || "guest"}`}>
                      <Ionicons name="close-circle" size={22} color={colors.ink500} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            {scramble ? (
              <View style={[styles.teamRow, styles.playerDivider]}>
                <Text style={styles.playerName}>Team plays off</Text>
                <Text style={styles.teamNumber}>{team ? team.team : "–"}</Text>
              </View>
            ) : null}

            {players.length < (scramble ? size : 8) ? (
              <View style={[styles.addRow, players.length > 0 && styles.playerDivider]}>
                <Pressable onPress={() => void openPals()} style={styles.addButton} accessibilityRole="button">
                  <Ionicons name="person-add-outline" size={18} color={colors.green700} />
                  <Text style={styles.link}>Add a PinPal</Text>
                </Pressable>
                <Pressable onPress={addGuest} style={styles.addButton} accessibilityRole="button">
                  <Ionicons name="add" size={20} color={colors.green700} />
                  <Text style={styles.link}>Add a guest</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {picking ? (
            <View style={styles.picker}>
              {pals == null ? (
                <ActivityIndicator color={colors.green700} />
              ) : pals.filter((m) => !added.has(m.id)).length === 0 ? (
                <Text style={styles.hint}>No more PinPals to add. Add them as a guest instead.</Text>
              ) : (
                pals
                  .filter((m) => !added.has(m.id))
                  .map((m) => (
                    <Pressable key={m.id} onPress={() => addPal(m)} style={styles.pickRow} accessibilityRole="button">
                      <Text style={styles.playerName}>{m.name}</Text>
                      <Text style={styles.playerMeta}>{m.handicap != null ? `Index ${m.handicap}` : "Handicap not shared"}</Text>
                    </Pressable>
                  ))
              )}
              <Pressable onPress={() => setPicking(false)} hitSlop={8}>
                <Text style={[styles.link, { textAlign: "center", marginTop: spacing.sm }]}>Close</Text>
              </Pressable>
            </View>
          ) : null}
        </Section>

        {problems.length > 0 && club ? <Text style={styles.problem}>{problems[0]}</Text> : null}

        <Pressable
          onPress={() => void start()}
          disabled={problems.length > 0 || saving}
          style={({ pressed }) => [styles.start, (problems.length > 0 || saving) && styles.startOff, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: problems.length > 0 || saving }}
        >
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>Tee off</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  cardMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  field: { flexBasis: "22%", flexGrow: 1, gap: 4 },
  fieldWide: { flexBasis: "100%" },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  formats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  format: {
    flexBasis: "31%",
    flexGrow: 1,
    minHeight: 60,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: spacing.sm + 2,
    justifyContent: "center",
    gap: 2,
  },
  formatOn: { borderWidth: 2, borderColor: colors.green700, backgroundColor: colors.green100 },
  formatOff: { backgroundColor: colors.surfaceTint },
  formatLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  formatBlurb: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  formatBlurbOn: { color: colors.green800 },
  muted: { color: colors.ink500 },
  players: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  player: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  playerDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  playerName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  playerMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  nameInput: {
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.ink900,
  },
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
  playsOff: { width: 52, alignItems: "center" },
  playsOffNumber: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  playsOffLabel: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase", color: colors.ink500 },
  addRow: { flexDirection: "row", justifyContent: "space-around" },
  addButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingHorizontal: spacing.sm },
  picker: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pickRow: { minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line },
  dayLink: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gold500 },
  dayLinkTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  dayLinkBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.cream100, marginTop: 2 },
  teamRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, backgroundColor: colors.cream100 },
  teamNumber: { fontFamily: fonts.display, fontSize: 26, color: colors.navy900 },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  start: {
    minHeight: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  startOff: { backgroundColor: colors.ink500 },
  startLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
