import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Segments, TEAM_INK } from "@/components/cup-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { officeAreas } from "@/lib/groups";
import { loadCupPage, loadLineups, sessionTitle, submitLineup, subscribeToCup, type CupPage, type Lineup } from "@/lib/trip-cup";
import { CUP_ALLOWANCE_LABEL, defaultLineup, lineupProblem, matchLine, pairUp, perSide, pts, type Team } from "@/lib/trip-cup-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Ryder Cup mode (0200): one session. Before it starts, each captain puts
 * their team in order (match 1 first) — kept secret from the other side
 * until both are in, if the Cup says so — and whoever runs the trip starts
 * it, which opens Groups & Societies with the matches made from the two
 * lineups. Once started: every match and the session's score.
 */
export default function CupSessionScreen() {
  const { id: rawId, sessionId: rawSession, outing } = useLocalSearchParams<{ id: string; sessionId: string; outing: string }>();
  const groupId = Number(rawId);
  const sessionId = Number(rawSession);
  const outingId = Number(outing);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [page, setPage] = useState<CupPage | null | undefined>(undefined);
  const [lineups, setLineups] = useState<Lineup[]>([]);
  const [officer, setOfficer] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [p, l, g] = await Promise.all([loadCupPage(outingId), loadLineups(sessionId), loadGroupPage(groupId, me).catch(() => null)]);
      setPage(p);
      setLineups(l);
      setOfficer(officeAreas(g?.myRole ?? null, g?.myOffice ?? null).includes("events"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, outingId, sessionId, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useEffect(() => {
    if (!page) return;
    return subscribeToCup(page, () => void load());
  }, [page, load]);

  const s = page?.sessions.find((x) => x.id === sessionId) ?? null;
  const mine = page?.members.find((m) => m.id === me) ?? null;
  const myCaptaincy: Team | null = mine?.captain ? mine.team : null;
  const editable: Team[] = officer ? [1, 2] : myCaptaincy ? [myCaptaincy] : [];
  const nameOf = useMemo(() => new Map((page?.members ?? []).map((m) => [m.id, m.name.split(" ")[0] || m.name])), [page]);

  // The team being put in order: a captain's own first.
  const team: Team | null = editTeam ?? myCaptaincy ?? (officer ? 1 : null);
  useEffect(() => {
    if (!page || !s || team == null) return;
    const players = page.members.filter((m) => m.team === team).map((m) => m.id);
    const sent = lineups.find((l) => l.team === team)?.pairs?.flat() ?? [];
    setOrder([...sent.filter((id) => players.includes(id)), ...players.filter((id) => !sent.includes(id))]);
  }, [page, s, team, lineups]);

  if (failed && page === undefined) return <LoadError size="screen" onRetry={() => void load()} what="the session" />;
  if (page === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!page || !s) return <StateMessage size="screen" icon="trophy-outline" title="That session has gone" />;

  const names = page.cup.teamNames;
  const title = sessionTitle(s, page.tripStartsOn);
  const size = perSide(s.format);
  const lineupOf = (t: Team) => lineups.find((l) => l.team === t) ?? null;
  const both = lineupOf(1)?.pairs && lineupOf(2)?.pairs ? pairUp(lineupOf(1)!.pairs!, lineupOf(2)!.pairs!) : null;
  const statusOf = (t: Team) => {
    const l = lineupOf(t);
    if (!l) return "Not in yet";
    if (!l.pairs) return "In · shown when both are";
    return "In";
  };
  const move = (i: number, by: -1 | 1) =>
    setOrder((prev) => {
      const j = i + by;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const proposed = defaultLineup(order, s.format);
  const problem = lineupProblem(proposed, s.format);
  const send = async () => {
    if (team == null || problem) return;
    setSending(true);
    try {
      await submitLineup(s.id, team, proposed);
      await load();
    } catch (e) {
      Alert.alert("Couldn't send the lineup", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSending(false);
    }
  };
  const startSession = () =>
    router.push({
      pathname: "/live/day/group",
      params: { group: String(groupId), round: String(s.itemId), cup: String(page.cup.id), session: String(s.id) },
    });

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
      <Stack.Screen options={{ title: title.split(" · ")[1] ?? "Session" }} />
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{title}</Text>
        <Text style={styles.heroMeta}>{`${s.item?.title ?? "Round"} · ${CUP_ALLOWANCE_LABEL[s.format]}`}</Text>
        <View style={styles.heroScore}>
          <Text style={styles.heroLabel}>{s.score.started ? "This session" : "Worth"}</Text>
          <Text style={styles.heroBig}>{s.score.started ? `${names[0]} ${pts(s.score.final[0])} – ${pts(s.score.final[1])} ${names[1]}` : `${s.score.points} points`}</Text>
        </View>
      </View>

      <View style={styles.body}>
        {s.day ? (
          <>
            {s.day.matches.map((m) => {
              const side = (t: 1 | 2) =>
                m.players
                  .filter((p) => (p.side ?? 1) === t)
                  .map((p) => p.name.split(" ")[0])
                  .join(" & ");
              const lead = m.state?.leader ?? 0;
              const line = matchLine(m.state ? { finished: m.state.finished || m.round.status === "finished", leader: m.state.leader, margin: m.state.margin, played: m.state.holes.length } : null, names);
              return (
                <Pressable key={m.round.id} style={styles.card} onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(m.round.id) } })} accessibilityRole="button">
                  <Text style={styles.kicker}>{`MATCH ${m.round.matchNumber ?? ""}`}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={[styles.stripe, { backgroundColor: lead === 1 ? colors.navy900 : lead === 2 ? colors.gold500 : colors.line }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, lead !== 1 && { fontFamily: fonts.body, color: colors.ink500 }]}>{side(1)}</Text>
                      <Text style={[styles.rowTitle, lead !== 2 && { fontFamily: fonts.body, color: colors.ink500 }]}>{side(2)}</Text>
                    </View>
                    <Text style={[styles.pill, lead === 1 && { backgroundColor: colors.navy900, color: colors.cream50 }, lead === 2 && { backgroundColor: colors.gold400 }]}>{line}</Text>
                  </View>
                </Pressable>
              );
            })}
            <Pressable style={[styles.button, styles.buttonMain]} onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(s.day!.day.id) } })} accessibilityRole="button">
              <Text style={[styles.buttonText, { color: colors.cream50 }]}>Open the board</Text>
            </Pressable>
          </>
        ) : s.score.started ? (
          <View style={styles.card}>
            <Text style={styles.meta}>This session has started, but its matches can't be shown to you.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.section}>LINEUPS</Text>
            <View style={styles.card}>
              {([1, 2] as const).map((t) => (
                <View key={t} style={styles.statusRow}>
                  <View style={[styles.teamDot, { backgroundColor: TEAM_INK[t].panel }]} />
                  <Text style={[styles.rowTitle, { flex: 1 }]}>{names[t - 1]}</Text>
                  <Text style={styles.meta}>{statusOf(t)}</Text>
                </View>
              ))}
              {page.cup.secretPairings && !both ? <Text style={styles.meta}>Each captain sees only their own until both are in.</Text> : null}
            </View>

            {both ? (
              <View style={styles.card}>
                <Text style={styles.rowTitle}>The matches</Text>
                {both.map((m, i) => (
                  <Text key={i} style={styles.meta}>{`${i + 1}. ${m.one.map((id) => nameOf.get(id) ?? "?").join(" & ")}  v  ${m.two.map((id) => nameOf.get(id) ?? "?").join(" & ")}`}</Text>
                ))}
              </View>
            ) : null}

            {team != null && editable.includes(team) ? (
              <View style={styles.card}>
                {editable.length > 1 ? (
                  <Segments
                    options={[
                      { value: "1", label: names[0] },
                      { value: "2", label: names[1] },
                    ]}
                    value={String(team)}
                    onChange={(v) => setEditTeam(v === "2" ? 2 : 1)}
                  />
                ) : null}
                <Text style={styles.rowTitle}>{`${names[team - 1]}'s order of play`}</Text>
                <Text style={styles.meta}>{size === 1 ? "Match 1 first. Use the arrows to move players." : "Each two make a pair, match 1 first. Use the arrows to move players."}</Text>
                {order.length === 0 ? <Text style={styles.meta}>Nobody on this team yet.</Text> : null}
                {order.map((id, i) => {
                  const matchNo = Math.floor(i / size) + 1;
                  const sitting = matchNo > proposed.length;
                  const firstOfMatch = i % size === 0;
                  return (
                    <View key={id}>
                      {firstOfMatch ? <Text style={styles.kicker}>{sitting ? "SITTING OUT" : `MATCH ${matchNo}`}</Text> : null}
                      <View style={styles.orderRow}>
                        <Text style={[styles.rowTitle, { flex: 1 }]}>{nameOf.get(id) ?? "A member"}</Text>
                        <Pressable style={styles.arrow} onPress={() => move(i, -1)} disabled={i === 0} accessibilityRole="button" accessibilityLabel={`Move ${nameOf.get(id)} up`}>
                          <Ionicons name="chevron-up" size={20} color={i === 0 ? colors.line : colors.ink900} />
                        </Pressable>
                        <Pressable style={styles.arrow} onPress={() => move(i, 1)} disabled={i === order.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${nameOf.get(id)} down`}>
                          <Ionicons name="chevron-down" size={20} color={i === order.length - 1 ? colors.line : colors.ink900} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                {problem && order.length > 0 ? <Text style={[styles.meta, { color: colors.red600 }]}>{problem}</Text> : null}
                <Pressable style={[styles.button, styles.buttonMain, (!!problem || sending) && { opacity: 0.5 }]} disabled={!!problem || sending} onPress={send} accessibilityRole="button">
                  {sending ? <ActivityIndicator color={colors.cream50} /> : <Text style={[styles.buttonText, { color: colors.cream50 }]}>{lineupOf(team) ? "Send the new order" : "Send the lineup"}</Text>}
                </Pressable>
              </View>
            ) : null}

            {officer ? (
              <View style={{ gap: 6 }}>
                <Pressable style={[styles.button, styles.buttonMain, page.members.length === 0 && { opacity: 0.5 }]} disabled={page.members.length === 0} onPress={startSession} accessibilityRole="button">
                  <Text style={[styles.buttonText, { color: colors.cream50 }]}>Start the session</Text>
                </Pressable>
                <Text style={styles.meta}>{both ? "The matches are made from the two lineups. You can still swap players within a team before teeing off." : "Without both lineups the matches are made from the teams in order; swap players within a team before teeing off."}</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  hero: { backgroundColor: colors.navy900, padding: spacing.lg, gap: 6 },
  heroTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  heroMeta: { fontFamily: fonts.body, fontSize: 13, color: "#c9d1dc" },
  heroScore: { marginTop: spacing.sm, backgroundColor: colors.navy800, borderRadius: radii.md, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  heroLabel: { fontFamily: fonts.body, fontSize: type.small, color: colors.cream100 },
  heroBig: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50, flexShrink: 1, textAlign: "right" },
  body: { padding: spacing.md, gap: spacing.md },
  section: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: colors.ink500 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, color: colors.ink500, marginTop: 4 },
  stripe: { width: 6, alignSelf: "stretch", borderRadius: 3 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  pill: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink900, backgroundColor: colors.cream100, borderRadius: radii.sm, paddingHorizontal: 10, paddingVertical: 6, overflow: "hidden", maxWidth: 170 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  teamDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.line },
  orderRow: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44 },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  button: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface },
  buttonMain: { backgroundColor: colors.green700 },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
});
