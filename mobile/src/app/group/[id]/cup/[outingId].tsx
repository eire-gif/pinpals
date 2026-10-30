import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadGroupPage } from "@/lib/groups-data";
import { officeAreas } from "@/lib/groups";
import { cancelCup, loadCupPage, saveCup, sessionTitle, subscribeToCup, type CupPage, type CupSession } from "@/lib/trip-cup";
import { cupResultLine, matchLine, pts, type PickMode, type Team } from "@/lib/trip-cup-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { Segments, TEAM_INK } from "@/components/cup-bits";

/**
 * Ryder Cup mode (0200): a trip's Cup — the running score, the session on
 * the course now, and every session by day. As on the "PinPals Ryder Cup
 * Mode" canvas. Whoever runs the trip sets it up here.
 */
export default function TripCupScreen() {
  const { id: rawId, outingId: rawOuting } = useLocalSearchParams<{ id: string; outingId: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [page, setPage] = useState<CupPage | null | undefined>(undefined);
  const [officer, setOfficer] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [p, g] = await Promise.all([loadCupPage(outingId), loadGroupPage(groupId, me).catch(() => null)]);
      setPage(p);
      setOfficer(officeAreas(g?.myRole ?? null, g?.myOffice ?? null).includes("events"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, outingId, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Live: any group scoring in a session moves the Cup.
  useEffect(() => {
    if (!page) return;
    return subscribeToCup(page, () => void load());
  }, [page, load]);

  if (!isOn("tripCup")) {
    return <StateMessage size="screen" icon="trophy-outline" title="Ryder Cup mode is on its way" />;
  }
  if (failed && page === undefined) return <LoadError size="screen" onRetry={() => void load()} what="the Cup" />;
  if (page === undefined) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "The Cup" }} />
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  if (page == null || page.cup.status === "cancelled" || editing) {
    if (!officer) {
      return (
        <>
          <Stack.Screen options={{ title: "The Cup" }} />
          <StateMessage size="screen" icon="trophy-outline" title="No Cup on this trip" body="Whoever runs the trip can set one up from the itinerary." />
        </>
      );
    }
    return (
      <CupSetup
        initial={page && page.cup.status === "open" ? page.cup : null}
        onCancel={page && page.cup.status === "open" ? () => setEditing(false) : undefined}
        onSave={async (s) => {
          await saveCup(outingId, s);
          setEditing(false);
          await load();
        }}
        onTurnOff={
          page && page.cup.status === "open"
            ? () =>
                Alert.alert("Turn off the Cup?", "The teams and sessions are kept, and the rounds already played stay as they are. You can turn it back on.", [
                  { text: "Keep it", style: "cancel" },
                  {
                    text: "Turn off",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await cancelCup(page.cup.id);
                        setEditing(false);
                        await load();
                      } catch (e) {
                        Alert.alert("Couldn't turn it off", e instanceof Error ? e.message : "Please try again.");
                      }
                    },
                  },
                ])
            : undefined
        }
      />
    );
  }

  const { cup, state, sessions } = page;
  const names = cup.teamNames;
  const result = cupResultLine(state, names, cup.holders);
  const live = sessions.filter((s) => s.score.started && !s.score.done && s.day);
  const share = () => {
    const lines = [
      `${page.tripTitle} — the Cup`,
      result ?? `${names[0]} ${pts(state.final[0])} – ${pts(state.final[1])} ${names[1]}`,
      ...sessions.filter((s) => s.score.started).map((s) => `${sessionTitle(s, page.tripStartsOn)}: ${pts(s.score.final[0])} – ${pts(s.score.final[1])}`),
    ];
    void Share.share({ message: lines.join("\n") });
  };
  const pct = (n: number): `${number}%` => (state.points > 0 ? `${Math.min(100, (n / state.points) * 100)}%` : "0%");

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.cream50 }}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Stack.Screen options={{ title: "The Cup" }} />

      <View style={styles.hero}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={styles.kicker} numberOfLines={1}>
            {page.tripTitle.toUpperCase()}
          </Text>
          {live.length > 0 ? <Text style={styles.live}>LIVE</Text> : null}
        </View>
        {result ? (
          <View style={styles.finish}>
            <Ionicons name="trophy" size={40} color={colors.gold400} />
            <Text style={styles.finishText}>{result}</Text>
          </View>
        ) : null}
        <View style={styles.scoreRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.teamName} numberOfLines={1}>
              {names[0]}
            </Text>
            {cup.holders === 1 ? <Text style={styles.heroMeta}>Holders</Text> : null}
            <Text style={[styles.bigScore, { color: TEAM_INK[1].bg }]}>{pts(state.final[0])}</Text>
          </View>
          <View style={{ alignItems: "center", paddingBottom: 8 }}>
            <Text style={styles.heroMeta}>{state.points > 0 ? `${pts(state.toWin)} to win` : "Make the teams"}</Text>
            <Text style={styles.heroMeta}>{state.points > 0 ? `${pts(state.points)} points` : "and sessions"}</Text>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={styles.teamName} numberOfLines={1}>
              {names[1]}
            </Text>
            {cup.holders === 2 ? <Text style={styles.heroMeta}>Holders</Text> : null}
            <Text style={[styles.bigScore, { color: TEAM_INK[2].bg }]}>{pts(state.final[1])}</Text>
          </View>
        </View>
        <View style={styles.bar} accessibilityRole="progressbar" accessibilityLabel={`${names[0]} ${pts(state.final[0])}, ${names[1]} ${pts(state.final[1])}, of ${pts(state.points)} points`}>
          <View style={{ width: pct(state.final[0]), backgroundColor: TEAM_INK[1].bg }} />
          <View style={{ width: pct(Math.max(0, state.projected[0] - state.final[0])), backgroundColor: "rgba(247,243,234,0.4)" }} />
          <View style={{ flex: 1 }} />
          <View style={{ width: pct(Math.max(0, state.projected[1] - state.final[1])), backgroundColor: "rgba(232,196,107,0.45)" }} />
          <View style={{ width: pct(state.final[1]), backgroundColor: TEAM_INK[2].bg }} />
          <View style={styles.halfway} />
        </View>
        {!result && state.points > 0 ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={styles.heroMeta}>{needLine(names[0], state.needs[0], cup.holders === 1)}</Text>
            <Text style={styles.heroMeta}>{needLine(names[1], state.needs[1], cup.holders === 2)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        {live.map((s) => (
          <LiveSession key={s.id} s={s} page={page} groupId={groupId} />
        ))}

        <Text style={styles.section}>SESSIONS</Text>
        {sessions.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.meta}>{officer ? "Plan a session for each round on the itinerary." : "The sessions aren't planned yet."}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {sessions.map((s, i) => (
              <Pressable
                key={s.id}
                style={[styles.sessionRow, i > 0 && styles.rowLine]}
                onPress={() => router.push({ pathname: "/group/[id]/cup/session/[sessionId]", params: { id: String(groupId), sessionId: String(s.id), outing: String(outingId) } })}
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{sessionTitle(s, page.tripStartsOn)}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{`${s.item?.title ?? "Round"} · ${s.score.points} ${s.score.points === 1 ? "match" : "matches"}`}</Text>
                </View>
                {s.score.started ? (
                  <Text style={styles.rowScore}>{`${pts(s.score.final[0])} – ${pts(s.score.final[1])}`}</Text>
                ) : (
                  <Text style={styles.meta}>{`${s.score.points} pts`}</Text>
                )}
                {s.score.started && !s.score.done ? <Text style={styles.liveSmall}>LIVE</Text> : null}
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.buttons}>
          <Pressable style={styles.button} onPress={() => router.push({ pathname: "/group/[id]/cup/teams/[outingId]", params: { id: String(groupId), outingId: String(outingId) } })} accessibilityRole="button">
            <Text style={styles.buttonText}>Teams</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => router.push({ pathname: "/group/[id]/cup/sessions/[outingId]", params: { id: String(groupId), outingId: String(outingId) } })} accessibilityRole="button">
            <Text style={styles.buttonText}>Sessions</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.buttonMain]} onPress={share} accessibilityRole="button">
            <Text style={[styles.buttonText, { color: colors.cream50 }]}>Share</Text>
          </Pressable>
        </View>
        {officer ? (
          <Pressable style={styles.settings} onPress={() => setEditing(true)} accessibilityRole="button">
            <Ionicons name="settings-outline" size={16} color={colors.green700} />
            <Text style={styles.settingsText}>Cup settings</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

function needLine(name: string, need: number, holders: boolean): string {
  if (need <= 0) return holders ? `${name} keep it` : `${name} have it`;
  return `${name} need ${pts(need)}${holders ? " to keep it" : ""}`;
}

function LiveSession({ s, page, groupId }: { s: CupSession; page: CupPage; groupId: number }) {
  const names = page.cup.teamNames;
  const day = s.day!;
  const st = page.state;
  return (
    <Pressable style={[styles.card, styles.liveCard]} onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(day.day.id) } })} accessibilityRole="button" accessibilityLabel={`Watch ${sessionTitle(s, page.tripStartsOn)}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={styles.dot} />
        <Text style={styles.onNow}>ON THE COURSE NOW</Text>
        <Text style={styles.watch}>Watch</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <Text style={styles.rowTitle}>{sessionTitle(s, page.tripStartsOn)}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {day.day.courseName}
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        {day.matches.map((m) => {
          const line = matchLine(m.state ? { finished: m.state.finished || m.round.status === "finished", leader: m.state.leader, margin: m.state.margin, played: m.state.holes.length } : null, names);
          const lead = m.state?.leader ?? 0;
          return (
            <View key={m.round.id} style={[styles.matchPill, lead === 1 && { backgroundColor: colors.navy900 }, lead === 2 && { backgroundColor: colors.gold400 }]}>
              <Text style={[styles.matchPillText, lead === 1 && { color: colors.cream50 }]} numberOfLines={1}>
                {`${m.round.matchNumber ?? ""}. ${line}`}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.meta}>{`If it stays like this: ${names[0]} ${pts(st.projected[0])} – ${pts(st.projected[1])} ${names[1]}`}</Text>
    </Pressable>
  );
}

function CupSetup({
  initial,
  onSave,
  onCancel,
  onTurnOff,
}: {
  initial: { teamNames: [string, string]; holders: Team | null; pickMode: PickMode; secretPairings: boolean } | null;
  onSave: (s: { teamNames: [string, string]; holders: Team | null; pickMode: PickMode; secretPairings: boolean }) => Promise<void>;
  onCancel?: () => void;
  onTurnOff?: () => void;
}) {
  const [a, setA] = useState(initial?.teamNames[0] ?? "Team Navy");
  const [b, setB] = useState(initial?.teamNames[1] ?? "Team Gold");
  const [holders, setHolders] = useState<Team | null>(initial?.holders ?? null);
  const [mode, setMode] = useState<PickMode>(initial?.pickMode ?? "captains");
  const [secret, setSecret] = useState(initial?.secretPairings ?? true);
  const [saving, setSaving] = useState(false);
  const problem = !a.trim() || !b.trim() ? "Name both teams" : a.trim().toLowerCase() === b.trim().toLowerCase() ? "The teams need different names" : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: initial ? "Cup settings" : "Set up the Cup" }} />
      {!initial ? (
        <View style={[styles.card, { backgroundColor: colors.navy900, borderColor: colors.navy900 }]}>
          <Ionicons name="trophy" size={28} color={colors.gold400} />
          <Text style={[styles.rowTitle, { color: colors.cream50 }]}>Ryder Cup mode</Text>
          <Text style={[styles.meta, { color: colors.cream100 }]}>Two teams for the whole trip, a format for each round, and one running points total. Every match is worth a point.</Text>
        </View>
      ) : null}

      <Text style={styles.label}>The teams</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <TextInput value={a} onChangeText={setA} maxLength={30} style={styles.input} accessibilityLabel="Team 1's name" />
        <TextInput value={b} onChangeText={setB} maxLength={30} style={styles.input} accessibilityLabel="Team 2's name" />
      </View>

      <Text style={styles.label}>Who holds the Cup?</Text>
      <Segments
        options={[
          { value: "none", label: "Nobody yet" },
          { value: "1", label: a.trim() || "Team 1" },
          { value: "2", label: b.trim() || "Team 2" },
        ]}
        value={holders ? String(holders) : "none"}
        onChange={(v) => setHolders(v === "1" ? 1 : v === "2" ? 2 : null)}
      />
      <Text style={styles.meta}>The holders keep the Cup on a tie.</Text>

      <Text style={styles.label}>How are the teams picked?</Text>
      <Segments
        options={[
          { value: "captains", label: "Captains pick" },
          { value: "balanced", label: "Balanced" },
          { value: "random", label: "Random" },
        ]}
        value={mode}
        onChange={(v) => setMode(v as PickMode)}
      />
      <Text style={styles.meta}>Captains take turns on their own phones. Balanced splits by handicap; Random is a draw.</Text>

      <View style={styles.switchRow}>
        <Text style={[styles.rowTitle, { flex: 1, fontFamily: fonts.body }]}>Captains send pairings in secret; both are shown at once</Text>
        <Switch value={secret} onValueChange={setSecret} trackColor={{ true: colors.green600 }} accessibilityLabel="Secret pairings" />
      </View>

      {problem ? <Text style={[styles.meta, { color: colors.red600 }]}>{problem}</Text> : null}
      <Pressable
        style={[styles.button, styles.buttonMain, { marginTop: spacing.md }, (problem || saving) && { opacity: 0.5 }]}
        disabled={!!problem || saving}
        onPress={async () => {
          setSaving(true);
          try {
            await onSave({ teamNames: [a.trim(), b.trim()], holders, pickMode: mode, secretPairings: secret });
          } catch (e) {
            Alert.alert("Couldn't save the Cup", e instanceof Error ? e.message : "Please try again.");
          } finally {
            setSaving(false);
          }
        }}
        accessibilityRole="button"
      >
        {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={[styles.buttonText, { color: colors.cream50 }]}>{initial ? "Save" : "Start the Cup"}</Text>}
      </Pressable>
      {onCancel ? (
        <Pressable style={styles.settings} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.settingsText}>Back to the Cup</Text>
        </Pressable>
      ) : null}
      {onTurnOff ? (
        <Pressable style={styles.settings} onPress={onTurnOff} accessibilityRole="button">
          <Text style={[styles.settingsText, { color: colors.red600 }]}>Turn off the Cup</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  hero: { backgroundColor: colors.navy900, padding: spacing.lg, gap: spacing.md },
  kicker: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: colors.gold400 },
  live: { fontFamily: fonts.bodyBold, fontSize: 12, color: "#fff", backgroundColor: colors.red600, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill, overflow: "hidden" },
  finish: { alignItems: "center", gap: 6, paddingVertical: spacing.sm },
  finishText: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50, textAlign: "center" },
  scoreRow: { flexDirection: "row", alignItems: "flex-end" },
  teamName: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  bigScore: { fontFamily: fonts.display, fontSize: 56, lineHeight: 62 },
  heroMeta: { fontFamily: fonts.body, fontSize: 12.5, color: "#c9d1dc" },
  bar: { height: 14, borderRadius: radii.pill, backgroundColor: colors.navy800, overflow: "hidden", flexDirection: "row" },
  halfway: { position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, backgroundColor: colors.navy900 },
  body: { padding: spacing.md, gap: spacing.md },
  section: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: colors.ink500, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  liveCard: { borderColor: colors.green700, borderWidth: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red600 },
  onNow: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: colors.red600 },
  watch: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  matchPill: { borderRadius: radii.sm, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: colors.cream100 },
  matchPillText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100, paddingTop: spacing.sm },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  rowScore: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  liveSmall: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.red600 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  buttons: { flexDirection: "row", gap: spacing.sm },
  button: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface },
  buttonMain: { backgroundColor: colors.green700 },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  settings: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 },
  settingsText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900, marginTop: spacing.sm },
  input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.surface },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52 },
});
