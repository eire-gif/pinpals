import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Kicker } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage, type GroupPage } from "@/lib/groups-data";
import { meritSeason, orderOfMerit, type MeritRow, type MeritRules } from "@/lib/order-of-merit";
import { irishToday, outingDateLabel } from "@/lib/outing-rules";
import { loadMeritRules, loadSeasonResults, saveMeritRules } from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { myRoundRight } from "@/components/my-round-pill";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Draft = { points: string; attendance: string; bestOf: string; includeTeam: boolean; startMonth: number };

const toDraft = (r: MeritRules): Draft => ({
  points: r.points.join(", "),
  attendance: String(r.attendancePoints),
  bestOf: r.bestOf != null ? String(r.bestOf) : "",
  includeTeam: r.includeTeam,
  startMonth: r.seasonStartMonth,
});

/** The rules a draft stands for, or a message saying what's wrong with it. */
function fromDraft(d: Draft): MeritRules | string {
  const parts = d.points.split(/[,\s]+/).filter(Boolean);
  const points = parts.map(Number);
  if (points.length === 0) return "Give points for at least 1st place.";
  if (points.some((p) => !Number.isInteger(p) || p < 0)) return "Points must be whole numbers, like 25, 20, 16.";
  const attendance = d.attendance.trim() === "" ? 0 : Number(d.attendance);
  if (!Number.isInteger(attendance) || attendance < 0) return "Attendance points must be a whole number.";
  const bestOf = d.bestOf.trim() === "" ? null : Number(d.bestOf);
  if (bestOf != null && (!Number.isInteger(bestOf) || bestOf < 1)) return "Best of must be a whole number, or blank for every event.";
  return { points, attendancePoints: attendance, bestOf, includeTeam: d.includeTeam, seasonStartMonth: d.startMonth };
}

/**
 * A society's order of merit (0145): points for places and turning up,
 * from the results published on its page this season. Tap a member to see
 * their events; the owner and admins can change the rules here.
 */
export default function OrderOfMeritScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [page, setPage] = useState<GroupPage | null | undefined>(undefined);
  const [rules, setRules] = useState<MeritRules | null>(null);
  const [rows, setRows] = useState<MeritRow[] | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(groupId)) return;
    try {
      const [p, r] = await Promise.all([loadGroupPage(groupId, userId), loadMeritRules(groupId)]);
      const s = meritSeason(r.seasonStartMonth, irishToday());
      const events = await loadSeasonResults(groupId, s.from, s.to);
      const names = new Map((p?.members ?? []).map((m) => [m.id, m.name]));
      setPage(p);
      setRules(r);
      setEventCount(events.length);
      setRows(orderOfMerit(events, r, names));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const season = useMemo(() => (rules ? meritSeason(rules.seasonStartMonth, irishToday()) : null), [rules]);
  const canEdit = page?.myRole === "owner" || page?.myRole === "admin";
  const parsed = draft ? fromDraft(draft) : null;

  async function save() {
    if (!parsed || typeof parsed === "string") return;
    setSaving(true);
    try {
      await saveMeritRules(groupId, parsed);
      setDraft(null);
      await load();
    } catch (err) {
      Alert.alert("Couldn't save the rules", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <Stack.Screen
      options={{
        title: "Order of merit",
        headerBackTitle: "Back",
        ...myRoundRight(() =>
          canEdit && rules ? (
            <Pressable onPress={() => setDraft((d) => (d ? null : toDraft(rules)))} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={draft ? "Close rules" : "Edit the rules"}>
              <Ionicons name="options-outline" size={18} color={colors.navy900} />
              <Text style={styles.headerBtnText}>Rules</Text>
            </Pressable>
          ) : null),
      }}
    />
  );

  if (failed && !rows) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="the order of merit" size="screen" />
      </View>
    );
  }
  if (page === undefined || !rules || !rows || !season) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="people-outline" title="This society isn't available" size="screen" />
      </View>
    );
  }

  const bestOfText = rules.bestOf != null ? `best of ${rules.bestOf}` : "every event counts";

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      {header}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.introKicker}>{`SEASON ${season.label}`}</Text>
          <Text style={styles.introTitle}>{page.group.name}</Text>
          <Text style={styles.introBody}>{`${eventCount} ${eventCount === 1 ? "event" : "events"} · ${bestOfText}`}</Text>
        </View>

        {draft ? (
          <Card>
            <Kicker>The rules</Kicker>
            <View style={styles.field}>
              <Text style={styles.label}>Points for 1st, 2nd, 3rd…</Text>
              <TextInput
                style={styles.input}
                value={draft.points}
                onChangeText={(v) => setDraft({ ...draft, points: v })}
                placeholder="25, 20, 16"
                placeholderTextColor={colors.ink500}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                accessibilityLabel="Points for each place, separated by commas"
              />
            </View>
            <View style={styles.fieldRow}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>For playing</Text>
                <TextInput
                  style={styles.input}
                  value={draft.attendance}
                  onChangeText={(v) => setDraft({ ...draft, attendance: v })}
                  placeholder="0"
                  placeholderTextColor={colors.ink500}
                  keyboardType="number-pad"
                  accessibilityLabel="Attendance points for everyone who returns a card"
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Best of</Text>
                <TextInput
                  style={styles.input}
                  value={draft.bestOf}
                  onChangeText={(v) => setDraft({ ...draft, bestOf: v })}
                  placeholder="All"
                  placeholderTextColor={colors.ink500}
                  keyboardType="number-pad"
                  accessibilityLabel="Best of how many events. Leave blank for every event"
                />
              </View>
            </View>
            <View style={styles.switchRow}>
              <Text style={[styles.label, { flex: 1 }]}>Include team and pairs events</Text>
              <Switch value={draft.includeTeam} onValueChange={(v) => setDraft({ ...draft, includeTeam: v })} trackColor={{ true: colors.green600 }} accessibilityLabel="Include team and pairs events" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Season starts in</Text>
              <View style={styles.months}>
                {MONTHS.map((m, i) => {
                  const on = draft.startMonth === i + 1;
                  return (
                    <Pressable key={m} onPress={() => setDraft({ ...draft, startMonth: i + 1 })} style={[styles.month, on && styles.monthOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Season starts in ${m}`}>
                      <Text style={[styles.monthText, on && styles.monthTextOn]}>{m}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {typeof parsed === "string" ? <Text style={styles.error}>{parsed}</Text> : null}
            <View style={styles.fieldRow}>
              <Button label="Cancel" tone="line" onPress={() => setDraft(null)} style={{ flex: 1 }} />
              <Button label="Save" onPress={() => void save()} busy={saving} disabled={typeof parsed === "string"} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : null}

        {rows.length === 0 ? (
          <StateMessage icon="trophy-outline" title="No results yet this season" body="Results appear here once the organiser publishes them to the society's page." />
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHead} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={[styles.headText, styles.colPos]}>#</Text>
              <Text style={[styles.headText, { flex: 1 }]}>Player</Text>
              <Text style={[styles.headText, styles.colNum]}>Events</Text>
              <Text style={[styles.headText, styles.colPts]}>Pts</Text>
            </View>
            {rows.map((r, i) => {
              const me = r.memberId === userId;
              const expanded = open === r.memberId;
              return (
                <View key={r.memberId} style={[i > 0 && styles.rowLine, me && styles.rowMe]}>
                  <Pressable
                    style={styles.row}
                    onPress={() => setOpen(expanded ? null : r.memberId)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${r.positionLabel.startsWith("=") ? `Joint ${r.position}` : `Position ${r.position}`}, ${r.name}${me ? " (you)" : ""}, ${r.events} ${r.events === 1 ? "event" : "events"}, ${r.points} points`}
                  >
                    <Text style={[styles.pos, styles.colPos, me && styles.meText]}>{r.positionLabel}</Text>
                    <Text style={[styles.name, me && styles.meText]} numberOfLines={1}>
                      {me ? `${r.name} (you)` : r.name}
                    </Text>
                    <Text style={[styles.num, styles.colNum]}>{r.events}</Text>
                    <Text style={[styles.pts, styles.colPts, me && styles.meText]}>{r.points}</Text>
                  </Pressable>
                  {expanded ? (
                    <View style={styles.scores}>
                      {r.scores.map((s) => (
                        <View key={s.eventId} style={styles.score} accessible accessibilityLabel={`${s.title}, ${outingDateLabel(s.playedOn)}, ${s.place ? `placed ${s.place}` : "no place"}, ${s.points} points${s.counted ? "" : ", dropped"}`}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.scoreTitle, !s.counted && styles.dropped]} numberOfLines={1}>
                              {s.title}
                            </Text>
                            <Text style={styles.scoreMeta}>{[outingDateLabel(s.playedOn), s.place ? `Placed ${s.place}` : null].filter(Boolean).join(" · ")}</Text>
                          </View>
                          {!s.counted ? <Text style={styles.droppedTag}>dropped</Text> : null}
                          <Text style={[styles.scorePts, !s.counted && styles.dropped]}>{s.points}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.small}>
          {`Points: ${rules.points.join(", ")}${rules.attendancePoints ? `, plus ${rules.attendancePoints} for playing` : ""}. ${rules.includeTeam ? "Team events count." : "Team events don't count."} Guests don't score.`}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 6, justifyContent: "center" },
  headerBtnText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
  intro: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  introKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.gold400 },
  introTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  introBody: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.cream100 },
  field: { gap: 6 },
  fieldRow: { flexDirection: "row", gap: spacing.sm },
  label: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900 },
  input: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.cream50,
  },
  switchRow: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: spacing.sm },
  months: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  month: { minWidth: 52, minHeight: 44, paddingHorizontal: 10, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  monthOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  monthText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  monthTextOn: { color: colors.cream50 },
  error: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.red600 },
  table: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  tableHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceTint, borderBottomWidth: 1, borderBottomColor: colors.line },
  headText: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 0.8, color: colors.ink500, textTransform: "uppercase" },
  colPos: { width: 44 },
  colNum: { width: 56, textAlign: "center" },
  colPts: { width: 52, textAlign: "right" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 12 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  rowMe: { backgroundColor: colors.green100 },
  meText: { color: colors.green800 },
  pos: { fontFamily: fonts.display, fontSize: 20, color: colors.navy900 },
  name: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  num: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  pts: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  scores: { paddingHorizontal: 12, paddingBottom: 10, paddingLeft: 56, gap: 6 },
  score: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scoreTitle: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  scoreMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  scorePts: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900, minWidth: 28, textAlign: "right" },
  dropped: { color: colors.ink500, textDecorationLine: "line-through" },
  droppedTag: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, lineHeight: 18 },
});
