import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { Segments, TEAM_INK } from "@/components/cup-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { officeAreas } from "@/lib/groups";
import { indexLabel } from "@/lib/live-scoring";
import { loadCupPage, pickForCup, setCupTeams, type CupPage } from "@/lib/trip-cup";
import { averageIndex, balancedTeams, pickTurn, randomTeams, type CupPlayer, type Team } from "@/lib/trip-cup-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

type Place = "out" | Team;

/**
 * Ryder Cup mode (0200): the two teams. Whoever runs the trip puts players
 * on teams (by hand, balanced by handicap, or a random draw) and names the
 * captains; in a captains' pick each captain picks in turn on their own phone.
 */
export default function CupTeamsScreen() {
  const { id: rawId, outingId: rawOuting } = useLocalSearchParams<{ id: string; outingId: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [page, setPage] = useState<CupPage | null | undefined>(undefined);
  const [officer, setOfficer] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [places, setPlaces] = useState<Map<string, Place>>(new Map());
  const [captains, setCaptains] = useState<{ 1?: string; 2?: string }>({});
  const [busy, setBusy] = useState(false);

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

  const startEditing = () => {
    if (!page) return;
    setPlaces(new Map(page.members.map((m) => [m.id, m.team])));
    const c: { 1?: string; 2?: string } = {};
    for (const m of page.members) if (m.captain) c[m.team] = m.id;
    setCaptains(c);
    setEditing(true);
  };

  const teamOf = useMemo(() => new Map((page?.members ?? []).map((m) => [m.id, m])), [page]);

  if (failed && page === undefined) return <LoadError size="screen" onRetry={() => void load()} what="the teams" />;
  if (page === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!page) return <StateMessage size="screen" icon="trophy-outline" title="No Cup on this trip" />;

  const { cup, members, candidates } = page;
  const names = cup.teamNames;
  const n1 = members.filter((m) => m.team === 1).length;
  const n2 = members.length - n1;
  const mine = me ? teamOf.get(me) : undefined;
  const turn = pickTurn(n1, n2);
  const unpicked = candidates.filter((c) => !teamOf.has(c.id));
  const captainOf = (t: Team) => members.find((m) => m.team === t && m.captain) ?? null;
  const canPick = cup.pickMode === "captains" && mine?.captain && mine.team === turn && unpicked.length > 0;

  const pick = async (memberId: string) => {
    setBusy(true);
    try {
      await pickForCup(cup.id, memberId);
      await load();
    } catch (e) {
      Alert.alert("Couldn't pick them", e instanceof Error ? e.message : "Please try again.");
      void load();
    } finally {
      setBusy(false);
    }
  };

  // ---- Editing (whoever runs the trip) ----
  if (editing) {
    const asPlayers = (ids: string[]): CupPlayer[] => ids.map((id) => candidates.find((c) => c.id === id)).filter((c) => c != null).map((c) => ({ memberId: c.id, name: c.name, index: c.index }));
    const inIds = [...places.entries()].filter(([, p]) => p !== "out").map(([id]) => id);
    const resplit = (how: "balanced" | "random") => {
      const keep = { 1: captains[1] && places.get(captains[1]) !== "out" ? captains[1] : undefined, 2: captains[2] && places.get(captains[2]) !== "out" ? captains[2] : undefined };
      const split = how === "balanced" ? balancedTeams(asPlayers(inIds), keep) : randomTeams(asPlayers(inIds), keep);
      setPlaces((prev) => {
        const next = new Map(prev);
        for (const [id, t] of split) next.set(id, t);
        return next;
      });
    };
    const save = async () => {
      setBusy(true);
      try {
        await setCupTeams(
          cup.id,
          [...places.entries()].filter((e): e is [string, Team] => e[1] !== "out").map(([memberId, team]) => ({ memberId, team, captain: captains[team] === memberId }))
        );
        setEditing(false);
        await load();
      } catch (e) {
        Alert.alert("Couldn't save the teams", e instanceof Error ? e.message : "Please try again.");
      } finally {
        setBusy(false);
      }
    };
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={styles.body}>
        <Stack.Screen options={{ title: "Change the teams" }} />
        <Text style={styles.meta}>
          {cup.pickMode === "captains"
            ? "Name a captain for each team (tap the star). The captains then pick the rest in turn on their phones — or put players on teams here yourself."
            : "Put everyone playing on a team, or tick them in and let PinPals split them."}
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable style={styles.button} onPress={() => resplit("balanced")} accessibilityRole="button">
            <Text style={styles.buttonText}>Balance by handicap</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => resplit("random")} accessibilityRole="button">
            <Text style={styles.buttonText}>Random draw</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          {candidates.map((c, i) => {
            const place = places.get(c.id) ?? "out";
            const isCaptain = place !== "out" && captains[place] === c.id;
            return (
              <View key={c.id} style={[styles.editRow, i > 0 && styles.rowLine]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Avatar url={c.avatarUrl} color={c.avatarColor} name={c.name} size={32} />
                  <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                    {c.name}
                    <Text style={styles.meta}>{c.index != null ? `  ${indexLabel(c.index)}` : ""}</Text>
                  </Text>
                  {place !== "out" ? (
                    <Pressable
                      onPress={() => setCaptains((prev) => ({ ...prev, [place]: isCaptain ? undefined : c.id }))}
                      style={styles.star}
                      accessibilityRole="button"
                      accessibilityLabel={isCaptain ? `${c.name} is ${names[place - 1]}'s captain` : `Make ${c.name} ${names[place - 1]}'s captain`}
                    >
                      <Ionicons name={isCaptain ? "star" : "star-outline"} size={22} color={isCaptain ? colors.gold500 : colors.ink500} />
                    </Pressable>
                  ) : null}
                </View>
                <Segments
                  options={[
                    { value: "out", label: "Not in" },
                    { value: "1", label: names[0] },
                    { value: "2", label: names[1] },
                  ]}
                  value={String(place)}
                  onChange={(v) => {
                    const to: Place = v === "1" ? 1 : v === "2" ? 2 : "out";
                    setPlaces((prev) => new Map(prev).set(c.id, to));
                    setCaptains((prev) => {
                      const next = { ...prev };
                      for (const t of [1, 2] as const) if (next[t] === c.id && to !== t) next[t] = undefined;
                      return next;
                    });
                  }}
                />
              </View>
            );
          })}
        </View>
        <Pressable style={[styles.button, styles.buttonMain, busy && { opacity: 0.5 }]} disabled={busy} onPress={save} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={[styles.buttonText, { color: colors.cream50 }]}>Save the teams</Text>}
        </Pressable>
        <Pressable style={styles.link} onPress={() => setEditing(false)} accessibilityRole="button">
          <Text style={styles.linkText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ---- The teams ----
  const column = (t: Team) => {
    const list = members.filter((m) => m.team === t);
    const avg = averageIndex(list.map((m) => ({ memberId: m.id, name: m.name, index: m.index })));
    const ink = TEAM_INK[t];
    const dark = t === 1;
    return (
      <View style={[styles.team, { backgroundColor: ink.panel }]}>
        <Text style={[styles.teamName, { color: dark ? colors.cream50 : colors.ink900 }]} numberOfLines={1}>
          {names[t - 1]}
        </Text>
        <Text style={[styles.teamMeta, { color: dark ? "#c9d1dc" : "#3d3216" }]}>{`${cup.holders === t ? "Holders · " : ""}${avg != null ? `avg ${avg.toFixed(1)}` : `${list.length} players`}`}</Text>
        {list.length === 0 ? <Text style={[styles.teamMeta, { color: dark ? "#c9d1dc" : "#3d3216" }]}>Nobody yet</Text> : null}
        {list.map((m) => (
          <View key={m.id} style={styles.teamRow}>
            <Text style={[styles.teamPlayer, { color: dark ? colors.cream50 : colors.ink900 }, m.captain && { fontFamily: fonts.bodyBold }]} numberOfLines={1}>
              {m.name.split(" ")[0]}
              {m.captain ? <Text style={{ fontSize: 11, color: dark ? colors.gold400 : "#5a4512" }}>{"  CAPT"}</Text> : null}
            </Text>
            <Text style={[styles.teamPlayer, { color: dark ? colors.cream50 : colors.ink900 }]}>{m.index != null ? indexLabel(m.index) : ""}</Text>
          </View>
        ))}
      </View>
    );
  };

  const waitingFor = captainOf(turn);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "Teams" }} />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {column(1)}
        {column(2)}
      </View>

      {cup.pickMode === "captains" && unpicked.length > 0 && captainOf(1) && captainOf(2) ? (
        canPick ? (
          <View style={styles.card}>
            <Text style={styles.rowTitle}>{`Your pick for ${names[mine!.team - 1]}`}</Text>
            <Text style={styles.meta}>{`${unpicked.length} still to pick`}</Text>
            {unpicked.map((c) => (
              <View key={c.id} style={styles.pickRow}>
                <Avatar url={c.avatarUrl} color={c.avatarColor} name={c.name} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={styles.meta}>{c.index != null ? `Handicap ${indexLabel(c.index)}` : "No handicap shown"}</Text>
                </View>
                <Pressable style={[styles.pickButton, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => void pick(c.id)} accessibilityRole="button" accessibilityLabel={`Pick ${c.name}`}>
                  <Text style={styles.pickText}>Pick</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.rowTitle}>{`${names[turn - 1]}'s pick`}</Text>
            <Text style={styles.meta}>{`Waiting for ${waitingFor?.name.split(" ")[0] ?? "their captain"} · ${unpicked.length} still to pick`}</Text>
          </View>
        )
      ) : null}

      {cup.pickMode === "captains" && (!captainOf(1) || !captainOf(2)) ? (
        <View style={styles.card}>
          <Text style={styles.meta}>{officer ? "Name a captain for each team, and they'll pick the rest in turn." : "Waiting for the captains to be named."}</Text>
        </View>
      ) : null}

      {officer ? (
        <Pressable style={[styles.button, styles.buttonMain]} onPress={startEditing} accessibilityRole="button">
          <Text style={[styles.buttonText, { color: colors.cream50 }]}>{members.length ? "Change the teams" : "Make the teams"}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  team: { flex: 1, borderRadius: radii.lg, padding: 12, gap: 6 },
  teamName: { fontFamily: fonts.display, fontSize: 20 },
  teamMeta: { fontFamily: fonts.body, fontSize: 12 },
  teamRow: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  teamPlayer: { fontFamily: fonts.body, fontSize: type.small, flexShrink: 1 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52 },
  pickButton: { minHeight: 40, paddingHorizontal: 16, borderRadius: radii.md, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  pickText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  editRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100, paddingTop: spacing.sm },
  star: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  button: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface, paddingHorizontal: 8 },
  buttonMain: { backgroundColor: colors.green700 },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
