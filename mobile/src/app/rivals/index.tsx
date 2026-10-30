import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/avatar";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { guestScorecardMessage } from "@/lib/find-pinpals";
import { loadRivalData, type RivalProfile } from "@/lib/rivalries";
import { recordLine, rivalLine, rivalries, type Rivalry } from "@/lib/rivalry-rules";
import { LastFive } from "@/components/rival-bits";
import type { RivalRound } from "@/lib/rivalry-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Rivalries (claude/rivalries.md): your head-to-head record with everyone
 * you've played against this season, as on the "PinPals Next Ideas" canvas.
 * Your biggest rivalry on top; guests you keep beating get a nudge to join.
 */
export default function RivalsScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [data, setData] = useState<{ rounds: RivalRound[]; profiles: Map<string, RivalProfile> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const year = new Date().getFullYear();

  const load = useCallback(
    async (fresh = false) => {
      if (!me) return;
      try {
        setData(await loadRivalData(me, fresh));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [me]
  );
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const list = useMemo(() => (data && me ? rivalries(data.rounds, me, year) : []), [data, me, year]);
  const members = list.filter((r) => r.memberId);
  const guests = list.filter((r) => !r.memberId && r.meetings.length >= 2);

  if (!isOn("rivalries")) return <StateMessage size="screen" icon="flash-outline" title="Rivalries are on their way" />;
  if (failed && !data) return <LoadError size="screen" onRetry={() => void load(true)} what="your rivals" />;
  if (!data) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: "Your rivals" }} />
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  const name = (r: Rivalry) => (r.memberId ? (data.profiles.get(r.memberId)?.firstName ?? r.name.split(" ")[0]) : r.name.split(" ")[0]);
  const open = (r: Rivalry) => router.push({ pathname: "/rivals/[key]", params: { key: r.key } });
  const top = members[0] ?? null;
  const rest = members.slice(1);

  const sendRecord = async (r: Rivalry) => {
    try {
      const msg = await guestScorecardMessage(r.lastPlayerId, r.name, r.lastRoundCourse);
      const line = r.won > r.lost ? `I lead you ${recordLine(r)} on PinPals` : r.won < r.lost ? `You lead me ${r.lost}–${r.won} on PinPals` : `We're all square on PinPals`;
      await Share.share({ message: `${line} — ${r.meetings.length} rounds against each other. ${msg}` });
    } catch (e) {
      Alert.alert("Couldn't make the link", e instanceof Error ? e.message : "Please try again.");
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.cream50 }}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load(true);
            setRefreshing(false);
          }}
        />
      }
    >
      <Stack.Screen options={{ title: "Your rivals" }} />
      <View style={styles.hero}>
        <Text style={styles.kicker}>{`${year} SEASON`}</Text>
        <Text style={styles.title}>Your rivals</Text>
        {top ? (
          <Pressable style={styles.topCard} onPress={() => open(top)} accessibilityRole="button" accessibilityLabel={`You v ${name(top)}, ${recordLine(top)}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Avatar url={data.profiles.get(top.memberId!)?.avatarUrl ?? null} color={data.profiles.get(top.memberId!)?.avatarColor ?? null} name={top.name} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={styles.topSmall}>Your biggest rivalry</Text>
                <Text style={styles.topName}>{`You v ${name(top)}`}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.topScore}>{recordLine(top)}</Text>
                <Text style={styles.topSmall}>{top.halved ? "won · lost · halved" : "won · lost"}</Text>
              </View>
            </View>
            <LastFive r={top} />
            <Text style={styles.topLine}>{rivalLine(top)}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.meta}>Every finished round you play against another PinPal settles it, net off your handicaps. Partners don&apos;t count. Nothing to enter.</Text>

        {list.length === 0 ? (
          <StateMessage
            icon="flash-outline"
            title="No rivals yet this season"
            body="Score a round live with friends — a match, or your own balls in the same group — and your record against each of them starts here."
          />
        ) : null}

        {rest.length > 0 ? (
          <View style={styles.card}>
            {rest.map((r, i) => (
              <Pressable key={r.key} style={[styles.row, i > 0 && styles.rowLine]} onPress={() => open(r)} accessibilityRole="button">
                <Avatar url={data.profiles.get(r.memberId!)?.avatarUrl ?? null} color={data.profiles.get(r.memberId!)?.avatarColor ?? null} name={r.name} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{name(r)}</Text>
                  <Text style={[styles.meta, r.won > r.lost && { color: colors.green700 }, r.won < r.lost && { color: colors.red600 }]}>{rivalLine(r)}</Text>
                </View>
                <Text style={styles.rowScore}>{recordLine(r)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {guests.map((g) => (
          <View key={g.key} style={styles.guestCard}>
            <Text style={styles.guestKicker}>NOT ON PINPALS YET</Text>
            <Text style={styles.rowName}>{`${g.name} · ${g.meetings.length} rounds as a guest`}</Text>
            <Text style={styles.guestBody}>
              {`${g.won > g.lost ? `You lead ${g.name.split(" ")[0]} ${recordLine(g)}` : g.won < g.lost ? `${g.name.split(" ")[0]} leads ${g.lost}–${g.won}` : "You're all square"}. Send the record — joining claims it and the rivalry carries on.`}
            </Text>
            <Pressable style={styles.guestButton} onPress={() => void sendRecord(g)} accessibilityRole="button">
              <Text style={styles.guestButtonText}>{`Send ${g.name.split(" ")[0]} the record`}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  hero: { backgroundColor: colors.navy900, padding: spacing.lg, gap: 6 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.cream50 },
  topCard: { marginTop: spacing.sm, backgroundColor: colors.navy800, borderRadius: radii.lg, padding: spacing.md, gap: 10 },
  topSmall: { fontFamily: fonts.body, fontSize: 12, color: "#c9d1dc" },
  topName: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.cream50 },
  topScore: { fontFamily: fonts.display, fontSize: 28, color: colors.cream50 },
  topLine: { fontFamily: fonts.body, fontSize: 13, color: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 56 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  rowScore: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  guestCard: { backgroundColor: "#fbf3dc", borderWidth: 1, borderColor: colors.gold500, borderRadius: radii.lg, padding: spacing.md, gap: 8 },
  guestKicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: "#5a4512" },
  guestBody: { fontFamily: fonts.body, fontSize: 13, color: "#3d3216" },
  guestButton: { alignSelf: "flex-start", minHeight: 42, paddingHorizontal: 16, borderRadius: radii.md, backgroundColor: colors.navy900, justifyContent: "center" },
  guestButtonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
});
