import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Section } from "@/components/form-bits";
import { CourseSection, useCourseSetup } from "@/components/live-course-section";
import { ScrambleOptions } from "@/components/scramble-options";
import { StateMessage } from "@/components/state-message";
import { SetByHandBadge, TeamHandicapSheet } from "@/components/team-handicap-sheet";
import { TimeSheet } from "@/components/time-sheet";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { applyHandSetHandicaps, createScrambleDay, type NewScrambleTeam } from "@/lib/live-match-days";
import { courseHandicap, parseIndex, scrambleHandicap, teamHandicapLabel, type ScrambleSize } from "@/lib/live-scoring";
import { pinPalsToPlayWith } from "@/lib/age";
import type { Member } from "@/lib/members";
import { loadMyProfile } from "@/lib/profile";
import { clockLabel } from "@/lib/tee-time-post";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { explainStartError } from "@/lib/open-game-alert";

/**
 * Set up a scramble day (0113): several scramble teams at one course, one
 * live leaderboard. Each team is scored on its own card by its own players;
 * everyone in the day sees every team.
 *
 * Handicaps: each player's index → course handicap for this course, then
 * the team's WHS allowance (4: 25/20/15/10%, 2: 35/15%) summed and rounded
 * — worked out here as you type, so the organiser sees each team's figure
 * before tee-off.
 */

type Slot = { key: string; memberId: string | null; name: string; indexText: string };
/** byHand: the team handicap set by hand for this game (0189); null = worked out. */
type DraftTeam = { key: string; name: string; teeTime: string; slots: (Slot | null)[]; byHand: number | null };
type Picking = { team: string; index: number } | null;

let seq = 0;
const nextKey = (p: string) => `${p}${++seq}`;

function addMinutes(time: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return "";
  const total = (Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function NewScrambleDay() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const course = useCourseSetup();

  const [title, setTitle] = useState("");
  const [size, setSize] = useState<ScrambleSize>(4);
  const [driveMinimum, setDriveMinimum] = useState<number | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([{ key: nextKey("t"), name: "", teeTime: "", slots: Array(4).fill(null), byHand: null }]);
  const [handFor, setHandFor] = useState<string | null>(null);
  const [timeFor, setTimeFor] = useState<string | null>(null);
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
      setTeams((ts) =>
        ts.length === 1 && ts[0].slots[0] == null
          ? [{ ...ts[0], slots: [{ key: nextKey("s"), memberId: userId, name, indexText: index }, ...ts[0].slots.slice(1)] }]
          : ts
      );
    });
    void pinPalsToPlayWith(userId)
      .then(setPals)
      .catch(() => setPals([]));
  }, [userId]);

  // Changing the size resizes every team, keeping whoever fits.
  const chooseSize = (s: ScrambleSize) => {
    setSize(s);
    setDriveMinimum(null);
    setTeams((ts) => ts.map((t) => ({ ...t, byHand: null, slots: [...t.slots.slice(0, s), ...Array(Math.max(0, s - t.slots.length)).fill(null)] })));
  };

  const used = useMemo(() => {
    const ids = new Set<string>();
    for (const t of teams) for (const s of t.slots) if (s?.memberId) ids.add(s.memberId);
    return ids;
  }, [teams]);

  const updateTeam = (key: string, change: (t: DraftTeam) => DraftTeam) => setTeams((ts) => ts.map((t) => (t.key === key ? change(t) : t)));
  const setSlot = (p: NonNullable<Picking>, slot: Slot | null) =>
    updateTeam(p.team, (t) => {
      const slots = [...t.slots];
      slots[p.index] = slot;
      // A different player: the team's hand-set handicap no longer applies.
      return { ...t, slots, byHand: null };
    });
  const editSlot = (team: string, index: number, change: Partial<Slot>) =>
    updateTeam(team, (t) => {
      const slots = [...t.slots];
      if (slots[index]) slots[index] = { ...slots[index]!, ...change };
      return { ...t, slots };
    });
  const addTeam = () =>
    setTeams((ts) => [...ts, { key: nextKey("t"), name: "", teeTime: addMinutes(ts[ts.length - 1]?.teeTime ?? "", 10), slots: Array(size).fill(null), byHand: null }]);

  const ch = (indexText: string) => {
    const index = parseIndex(indexText);
    if (index == null) return null;
    return { index, ...courseHandicap(index, { slope: course.slope, courseRating: course.rating, par: course.par }) };
  };
  const teamHcp = (t: DraftTeam) => {
    const ws = t.slots.map((s) => (s ? ch(s.indexText) : null));
    if (ws.some((w) => w == null)) return null;
    return scrambleHandicap(ws.map((w) => w!.courseHandicap));
  };

  const problems: string[] = [...course.problems];
  if (title.trim() === "") problems.push("Give the day a name");
  for (const [i, t] of teams.entries()) {
    if (t.slots.some((s) => s == null)) problems.push(`Team ${i + 1} needs ${size} players`);
    else if (t.slots.some((s) => s!.name.trim() === "")) problems.push(`A guest in team ${i + 1} needs a name`);
    else if (t.slots.some((s) => ch(s!.indexText) == null)) problems.push(`Every player in team ${i + 1} needs a handicap index`);
  }

  const start = async () => {
    if (problems.length > 0 || !course.club) return;
    setSaving(true);
    try {
      const payload: NewScrambleTeam[] = teams.map((t) => {
        const hcp = teamHcp(t)!;
        return {
          name: t.name.trim() || null,
          teeTime: t.teeTime.trim() || null,
          teamHandicap: hcp.team,
          setByHand: t.byHand,
          players: t.slots.map((s, i) => {
            const w = ch(s!.indexText)!;
            return {
              memberId: s!.memberId,
              name: s!.name.trim(),
              handicapIndex: w.index,
              courseHandicap: w.courseHandicap,
              playingHandicap: Math.round(hcp.shares[i]),
              estimated: w.estimated,
            };
          }),
        };
      });
      const id = await createScrambleDay(
        {
          title: title.trim(),
          courseName: course.club.name,
          clubId: course.club.id,
          teeName: course.teeName.trim() || null,
          holes: course.holes,
          courseRating: course.rating,
          slope: course.slope,
          parTotal: course.par,
          size,
          driveMinimum,
        },
        payload,
        course.holeCard()
      );
      await applyHandSetHandicaps(id, payload).catch(() =>
        Alert.alert("A team handicap wasn't set", "The scramble has started. Open the team's card from the day's board, then its Leaderboard tab, and tap Edit by the team handicap.")
      );
      router.replace({ pathname: "/live/day/[id]", params: { id: String(id), created: "1" } });
    } catch (e) {
      explainStartError(e, "Couldn't start the scramble");
    } finally {
      setSaving(false);
    }
  };

  if (!isOn("liveScoring")) return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;

  const memberCount = used.size - (userId && used.has(userId) ? 1 : 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Section title="Name">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Captain's Scramble"
            placeholderTextColor={colors.ink500}
            style={styles.input}
            maxLength={80}
            accessibilityLabel="Name of the scramble"
          />
        </Section>

        <CourseSection setup={course} />

        <ScrambleOptions size={size} onSize={chooseSize} driveMinimum={driveMinimum} onDriveMinimum={setDriveMinimum} holes={course.holes} />

        <Section title="Teams" hint="Each team scores its own card. Everyone sees every team on the leaderboard.">
          {teams.map((t, ti) => {
            const hcp = teamHcp(t);
            return (
              <View key={t.key} style={styles.team}>
                <View style={styles.teamTop}>
                  <TextInput
                    value={t.name}
                    onChangeText={(v) => updateTeam(t.key, (x) => ({ ...x, name: v }))}
                    placeholder={`Team ${ti + 1}`}
                    placeholderTextColor={colors.navy900}
                    style={styles.teamName}
                    maxLength={30}
                    accessibilityLabel={`Team ${ti + 1} name`}
                  />
                  <Pressable
                    onPress={() => setTimeFor(t.key)}
                    style={({ pressed }) => [styles.timeButton, t.teeTime ? styles.timeButtonSet : null, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t.teeTime ? `Team ${ti + 1} tees off ${t.teeTime}. Change` : `Add team ${ti + 1}'s tee time`}
                  >
                    <Ionicons name="time-outline" size={16} color={t.teeTime ? colors.cream50 : colors.green700} />
                    <Text style={[styles.timeButtonText, t.teeTime ? styles.timeButtonTextSet : null]}>{t.teeTime ? clockLabel(t.teeTime) : "Tee time"}</Text>
                  </Pressable>
                  {teams.length > 1 ? (
                    <Pressable onPress={() => setTeams((ts) => ts.filter((x) => x.key !== t.key))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove team ${ti + 1}`}>
                      <Ionicons name="trash-outline" size={20} color={colors.ink500} />
                    </Pressable>
                  ) : null}
                </View>

                {t.slots.map((slot, si) => {
                  const here = { team: t.key, index: si };
                  const isPicking = picking?.team === t.key && picking.index === si;
                  if (!slot) {
                    return (
                      <View key={si}>
                        <Pressable onPress={() => setPicking(isPicking ? null : here)} style={styles.emptySlot} accessibilityRole="button" accessibilityLabel={`Add a player to team ${ti + 1}`}>
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
                              meta="Someone not on PinPals. Their team scores for them."
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
                            onChangeText={(v) => editSlot(t.key, si, { name: v })}
                            placeholder="Guest's name"
                            placeholderTextColor={colors.ink500}
                            style={styles.nameInput}
                            maxLength={60}
                            accessibilityLabel="Guest's name"
                          />
                        )}
                        <Text style={styles.meta}>
                          {w ? `Course handicap ${w.courseHandicap}${w.estimated ? " (estimated)" : ""}${hcp ? ` · share ${hcp.shares[si]}` : ""}` : "Index, e.g. 14.2 or +1.5"}
                        </Text>
                      </View>
                      <TextInput
                        value={slot.indexText}
                        onChangeText={(v) => editSlot(t.key, si, { indexText: v })}
                        placeholder="Index"
                        placeholderTextColor={colors.ink500}
                        keyboardType="numbers-and-punctuation"
                        style={styles.indexInput}
                        maxLength={5}
                        accessibilityLabel={`${slot.name || "Guest"}'s handicap index`}
                      />
                      <Pressable onPress={() => setSlot(here, null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${slot.name || "guest"}`}>
                        <Ionicons name="close-circle" size={22} color={colors.ink500} />
                      </Pressable>
                    </View>
                  );
                })}

                {(() => {
                  const set = hcp != null && t.byHand != null && t.byHand !== hcp.team;
                  return (
                    <Pressable
                      onPress={() => hcp && setHandFor(t.key)}
                      disabled={!hcp}
                      style={({ pressed }) => [styles.teamHcp, set && styles.teamHcpSet, pressed && { opacity: 0.85 }]}
                      accessibilityRole="button"
                      accessibilityLabel={hcp ? `Team ${ti + 1} plays off ${teamHandicapLabel(set ? t.byHand! : hcp.team)}${set ? ", set by hand" : ""}. Change` : `Team ${ti + 1} handicap`}
                    >
                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={styles.teamHcpTop}>
                          <Text style={styles.meta}>Team plays off</Text>
                          {set ? <SetByHandBadge small /> : null}
                        </View>
                        <Text style={styles.meta}>{!hcp ? "Worked out once every player has an index" : set ? `Worked out ${teamHandicapLabel(hcp.team)}` : "Worked out (WHS) · tap to set by hand"}</Text>
                      </View>
                      <Text style={styles.teamHcpNumber}>{hcp ? teamHandicapLabel(set ? t.byHand! : hcp.team) : "–"}</Text>
                      {hcp ? <Ionicons name="pencil" size={18} color={colors.green700} /> : null}
                    </Pressable>
                  );
                })()}
              </View>
            );
          })}

          {teams.some((t) => { const h = teamHcp(t); return h != null && t.byHand != null && t.byHand !== h.team; }) ? (
            <View style={styles.handSummary}>
              <Text style={[styles.meta, { flex: 1, color: colors.ink900 }]}>
                {(() => {
                  const n = teams.filter((t) => { const h = teamHcp(t); return h != null && t.byHand != null && t.byHand !== h.team; }).length;
                  return `${n} team${n === 1 ? "" : "s"} set by hand. The rest are worked out.`;
                })()}
              </Text>
              <Pressable onPress={() => setTeams((ts) => ts.map((x) => ({ ...x, byHand: null })))} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>Reset all</Text>
              </Pressable>
            </View>
          ) : null}

          {teams.length < 100 ? (
            <Pressable onPress={addTeam} style={styles.addTeam} accessibilityRole="button">
              <Ionicons name="add" size={20} color={colors.green700} />
              <Text style={styles.link}>Add a team</Text>
            </Pressable>
          ) : null}
        </Section>

        {problems.length > 0 ? <Text style={styles.problem}>{problems[0]}</Text> : null}
        <Text style={styles.footNote}>
          {memberCount > 0
            ? `${memberCount} PinPal${memberCount === 1 ? "" : "s"} will get a notification with their team.`
            : "PinPals you add get a notification with their team."}
        </Text>

        <Pressable
          onPress={() => void start()}
          disabled={problems.length > 0 || saving}
          style={({ pressed }) => [styles.start, (problems.length > 0 || saving) && styles.startOff, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: problems.length > 0 || saving }}
        >
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>Start the scramble</Text>}
        </Pressable>
      </ScrollView>
      {(() => {
        const idx = teams.findIndex((x) => x.key === handFor);
        const cur = idx >= 0 ? teams[idx] : null;
        const hcp = cur ? teamHcp(cur) : null;
        if (!cur || !hcp) return null;
        return (
          <TeamHandicapSheet
            open
            label={cur.name.trim() || `Team ${idx + 1}`}
            kind="scramble"
            players={cur.slots.map((sl) => ({ name: sl!.name.trim().split(" ")[0] || "Guest", courseHandicap: ch(sl!.indexText)!.courseHandicap }))}
            auto={hcp.team}
            value={cur.byHand ?? hcp.team}
            onClose={() => setHandFor(null)}
            onSave={(h) => {
              updateTeam(cur.key, (x) => ({ ...x, byHand: h === hcp.team ? null : h }));
              setHandFor(null);
            }}
          />
        );
      })()}
      {(() => {
        const idx = teams.findIndex((x) => x.key === timeFor);
        const cur = idx >= 0 ? teams[idx] : null;
        const prev = idx > 0 ? teams[idx - 1].teeTime : "";
        const suggestions = prev ? [8, 10, 12].map((n) => ({ label: `+${n} min`, time: addMinutes(prev, n) })) : [];
        return (
          <TimeSheet
            open={cur != null}
            title={cur ? `${cur.name.trim() || `Team ${idx + 1}`} tees off` : ""}
            value={cur?.teeTime ?? ""}
            suggestions={suggestions}
            onClose={() => setTimeFor(null)}
            onChange={(time) => cur && updateTeam(cur.key, (x) => ({ ...x, teeTime: time }))}
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
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  team: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  teamTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  teamName: { flex: 1, minHeight: 40, fontFamily: fonts.display, fontSize: 20, color: colors.navy900, borderBottomWidth: 1, borderBottomColor: colors.line },
  timeButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50 },
  timeButtonSet: { backgroundColor: colors.green700, borderColor: colors.green700 },
  timeButtonText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.green700 },
  timeButtonTextSet: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  emptySlot: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radii.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.line },
  picker: { marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: spacing.sm, backgroundColor: colors.cream50 },
  pickRow: { minHeight: 52, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 4 },
  slot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52 },
  playerName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  nameInput: { minHeight: 36, borderBottomWidth: 1, borderBottomColor: colors.line, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  indexInput: { width: 64, minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900, backgroundColor: colors.cream50 },
  teamHcp: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, backgroundColor: colors.cream100, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  teamHcpSet: { borderWidth: 2, borderColor: colors.gold500, backgroundColor: colors.surfaceTint },
  teamHcpTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  handSummary: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceTint, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, padding: spacing.sm },
  teamHcpNumber: { fontFamily: fonts.display, fontSize: 24, color: colors.navy900 },
  addTeam: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 48, borderRadius: radii.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.line },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  footNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, textAlign: "center" },
  start: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  startOff: { backgroundColor: colors.ink500 },
  startLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
