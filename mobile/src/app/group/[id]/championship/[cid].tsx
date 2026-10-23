import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { biggestMovers, boardOf, ruleLine, type BoardRow, type ChampionshipPayload } from "@/lib/championship";
import { cancelChampionship, loadChampionship, setChampionshipEntry } from "@/lib/championships";
import { SITE_URL } from "@/lib/config";
import { loadGroupPage } from "@/lib/groups-data";
import { officeAreas } from "@/lib/groups";
import { outingDateLabel } from "@/lib/outing-rules";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing } from "@/lib/theme";

const NAVY = "#0b1b33";
const PANEL = "#11284a";
const LINE = "#2b4369";
const UP = "#7fdca6";
const DOWN = "#f79a8b";
const SOFT = "#b9c3d3";

/**
 * A multi-day championship's leaderboard (0187), as approved on the
 * "PinPals — multi-round leaderboard" canvas: R1–R4 tabs (the board after
 * that day), position with ▲/▼ against the end of the day before, the total,
 * today and thru; you highlighted. Under it, each day — tap for its entries,
 * draw and live day — and Join every day in one tap. Refreshes every 30
 * seconds while a day is live.
 */
export default function ChampionshipScreen() {
  const { id: rawId, cid } = useLocalSearchParams<{ id: string; cid: string }>();
  const groupId = Number(rawId);
  const champId = Number(cid);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [data, setData] = useState<ChampionshipPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const [officer, setOfficer] = useState(false);
  const [myDays, setMyDays] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [p, page] = await Promise.all([loadChampionship(champId), loadGroupPage(groupId, me).catch(() => null)]);
      setData(p);
      setOfficer(officeAreas(page?.myRole ?? null, page?.myOffice ?? null).includes("events"));
      const outingIds = p.days.map((d) => d.outingId).filter((x): x is number => x != null);
      if (outingIds.length) {
        const { data: rows } = await supabase.from("society_outing_entries").select("outing_id").eq("member_id", me).in("outing_id", outingIds);
        setMyDays(new Set(((rows ?? []) as { outing_id: number }[]).map((r) => r.outing_id)));
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [champId, groupId, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const live = !!data?.scoring.some((d) => d.status === "live");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [live, load]);

  const latest = useMemo(() => (data ? boardOf(data).through : 1), [data]);
  const through = view ?? latest;
  const board = useMemo(() => (data ? boardOf(data, through) : null), [data, through]);

  if (failed && !data) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Leaderboard", headerBackTitle: "Back" }} />
        <LoadError onRetry={() => void load()} what="the leaderboard" />
      </View>
    );
  }
  if (!data || !board) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Leaderboard", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.gold400} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  const rounds = data.scoring.map((s) => s.round);
  const viewed = data.days.find((d) => d.round === rounds[through - 1]);
  const line = ruleLine(board.rule, data.scoring.map((d) => d.kind));
  const movers = biggestMovers(board);
  const dayOuts = data.days.filter((d) => d.outingId != null);
  const allIn = dayOuts.length > 0 && dayOuts.every((d) => myDays.has(d.outingId as number));
  const anyIn = dayOuts.some((d) => myDays.has(d.outingId as number));
  const canJoin = !data.tripOutingId && data.status === "open" && dayOuts.some((d) => d.status === "upcoming");

  async function join(inIt: boolean) {
    setBusy(true);
    try {
      const n = await setChampionshipEntry(champId, inIt);
      await load();
      if (inIt && n < dayOuts.length) Alert.alert("You're in", `You're in ${n} of the ${dayOuts.length} days — the others can't be joined any more.`);
    } catch (err) {
      Alert.alert(inIt ? "Couldn't join" : "Couldn't take you out", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Leaderboard", headerBackTitle: "Back", headerStyle: { backgroundColor: NAVY }, headerTintColor: colors.cream50 }} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            tintColor={colors.gold400}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ gap: 6 }}>
          <View style={styles.headRow}>
            <Text style={styles.kicker}>{data.tripOutingId ? "TRIP LEADERBOARD" : `CHAMPIONSHIP · ${data.days.length} DAYS`}</Text>
            {live ? (
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE · R{rounds[latest - 1]}</Text>
              </View>
            ) : data.status === "cancelled" ? (
              <Text style={styles.cancelled}>Cancelled</Text>
            ) : null}
          </View>
          <Text style={styles.title}>{data.title}</Text>
          <Text style={styles.sub}>{line.title.replace("Overall: ", "Overall · ")}</Text>
        </View>

        {rounds.length > 0 ? (
          <View style={styles.tabs} accessibilityRole="tablist">
            {data.scoring.map((s, i) => {
              const d = data.days.find((x) => x.round === s.round);
              const on = i + 1 === through;
              const open = s.status !== "upcoming";
              return (
                <Pressable
                  key={s.round}
                  style={[styles.tab, on && styles.tabOn, !open && { opacity: 0.55 }]}
                  onPress={() => open && setView(i + 1)}
                  disabled={!open}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on, disabled: !open }}
                  accessibilityLabel={`Round ${s.round}${d ? `, ${d.courseName}` : ""}`}
                >
                  <Text style={[styles.tabNum, on && styles.tabTextOn]}>R{s.round}</Text>
                  <Text style={[styles.tabDay, on && styles.tabTextOn]}>{d ? outingDateLabel(d.playsOn).split(" ")[0] : ""}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {viewed ? (
          <View style={styles.courseRow}>
            <Text style={styles.course} numberOfLines={1}>
              {viewed.courseName}
            </Text>
            <Text style={styles.courseSub}>{[viewed.formatLabel, board.live ? "Live now" : viewed.status === "final" ? "Final" : null].filter(Boolean).join(" · ")}</Text>
          </View>
        ) : null}

        <View style={styles.table} accessibilityRole="list">
          <View style={[styles.tr, styles.th]}>
            <Text style={[styles.thText, styles.cPos]}>POS</Text>
            <Text style={[styles.thText, styles.cMove]} />
            <Text style={[styles.thText, { flex: 1 }]}>PLAYER</Text>
            <Text style={[styles.thText, styles.cNum]}>{board.unit === "to par" ? "TOT" : "PTS"}</Text>
            <Text style={[styles.thText, styles.cNum]}>{board.live ? "TODAY" : "RND"}</Text>
            <Text style={[styles.thText, styles.cThru]}>THRU</Text>
          </View>
          {board.rows.length === 0 ? (
            <Text style={styles.empty}>{viewed?.hidden ? "The organiser is keeping this round's leaderboard secret until the results." : "No scores yet — the board fills in as the first cards come in."}</Text>
          ) : (
            board.rows.map((r, k) => <Row key={r.key} r={r} me={me} odd={k % 2 === 1} />)
          )}
          <Text style={styles.legend}>▲▼ places gained or lost since the end of the previous round. {line.body}</Text>
        </View>

        {movers.length > 0 ? (
          <View style={styles.panel}>
            <Text style={styles.panelKicker}>{board.live ? "BIGGEST MOVERS TODAY" : `BIGGEST MOVERS · R${viewed?.round ?? through}`}</Text>
            {movers.map((m) => (
              <View key={m.key} style={styles.moverRow}>
                <Text style={styles.moverName}>{m.name}</Text>
                <Text style={styles.moverMeta}>{`now ${m.positionLabel}`}</Text>
                <Text style={[styles.move, { color: UP }]}>{`▲${m.move}`}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {canJoin ? (
          <Pressable style={[styles.join, allIn && styles.joinMine]} onPress={() => void join(!allIn)} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={allIn ? colors.navy900 : colors.cream50} /> : <Text style={[styles.joinText, allIn && styles.joinTextMine]}>{allIn ? "You're in every day · Leave" : anyIn ? "Join the other days" : `Join all ${dayOuts.length} days`}</Text>}
          </Pressable>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Text style={styles.sectionTitle}>The days</Text>
          {data.days.map((d) => (
            <Pressable
              key={d.round}
              style={styles.day}
              onPress={() => {
                if (d.outingId) router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(d.outingId) } });
                else if (data.tripOutingId) router.push({ pathname: "/group/[id]/itinerary/[outingId]", params: { id: String(groupId), outingId: String(data.tripOutingId) } });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Day ${d.round}, ${d.courseName}, ${outingDateLabel(d.playsOn)}`}
            >
              <View style={styles.dayBadge}>
                <Text style={styles.dayBadgeSmall}>DAY</Text>
                <Text style={styles.dayBadgeNum}>{d.round}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.dayCourse} numberOfLines={1}>
                  {d.courseName}
                </Text>
                <Text style={styles.dayMeta}>{[outingDateLabel(d.playsOn), d.firstTee ? `first tee ${d.firstTee}` : null].filter(Boolean).join(" · ")}</Text>
                <Text style={styles.dayFormat}>
                  {d.formatLabel}
                  {d.excluded ? " · not on the leaderboard" : ""}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={[styles.status, d.status === "live" && { color: UP }]}>{d.status === "live" ? "LIVE" : d.status === "final" ? "FINAL" : "TO COME"}</Text>
                {d.outingId && myDays.has(d.outingId) ? <Text style={styles.youIn}>You&apos;re in</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={styles.tv}
          onPress={() => void Share.share({ message: `${data.title} — live leaderboard\n${SITE_URL}/championships/${data.id}?tv=1` })}
          accessibilityRole="button"
        >
          <Ionicons name="tv-outline" size={20} color={colors.cream50} />
          <Text style={styles.tvText}>Share the TV link</Text>
        </Pressable>

        {officer && !data.tripOutingId && data.status === "open" ? (
          <Pressable
            onPress={() =>
              Alert.alert(`Cancel ${data.title}?`, "Every day not yet played is cancelled too.", [
                { text: "Keep it", style: "cancel" },
                {
                  text: "Cancel the championship",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      await cancelChampionship(champId);
                      router.back();
                    } catch (err) {
                      Alert.alert("Couldn't cancel", err instanceof Error ? err.message : "Please try again.");
                    }
                  },
                },
              ])
            }
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.cancelLink}>Cancel the championship</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ r, me, odd }: { r: BoardRow; me: string | null; odd: boolean }) {
  const mine = !!me && r.memberId === me;
  const up = (r.move ?? 0) > 0;
  const down = (r.move ?? 0) < 0;
  return (
    <View
      style={[styles.tr, odd && { backgroundColor: PANEL }, mine && styles.mine]}
      accessible
      accessibilityLabel={`${r.positionLabel || "Not placed"}, ${r.name}${mine ? " (you)" : ""}, ${r.totalLabel}${up ? `, up ${r.move}` : down ? `, down ${-(r.move as number)}` : ""}, thru ${r.thruLabel}`}
    >
      <Text style={[styles.pos, styles.cPos, r.position === 1 && { color: colors.gold400 }]}>{r.positionLabel}</Text>
      <Text style={[styles.move, styles.cMove, { color: up ? UP : down ? DOWN : "#7f8da3" }]}>{up ? `▲${r.move}` : down ? `▼${-(r.move as number)}` : "–"}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1}>
          {mine ? `${r.name} (you)` : r.name}
        </Text>
        {r.detail || r.missed.length ? (
          <Text style={styles.club} numberOfLines={1}>
            {[r.detail, r.missed.length ? `missed R${r.missed.join(", R")}` : null].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.total, styles.cNum, r.position === 1 && { color: UP }]}>{r.totalLabel}</Text>
      <Text style={[styles.today, styles.cNum]}>{r.todayLabel}</Text>
      <Text style={[styles.thru, styles.cThru]}>{r.thruLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: NAVY },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1.6, color: colors.gold400 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: "rgba(92,201,138,0.16)" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#5cc98a" },
  liveText: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1.2, color: UP },
  cancelled: { fontFamily: fonts.bodyBold, fontSize: 13, color: DOWN },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.cream50, lineHeight: 34 },
  sub: { fontFamily: fonts.body, fontSize: 15, color: SOFT },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, height: 58, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: PANEL, borderWidth: 1, borderColor: LINE },
  tabOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  tabNum: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  tabDay: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.cream100 },
  tabTextOn: { color: NAVY },
  courseRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  course: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  courseSub: { fontFamily: fonts.body, fontSize: 13.5, color: SOFT },
  table: { borderRadius: radii.lg, overflow: "hidden", borderWidth: 1, borderColor: LINE, backgroundColor: "#132c51" },
  tr: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 58, borderBottomWidth: 1, borderBottomColor: "#1e3659" },
  th: { minHeight: 36, backgroundColor: "#0e2240" },
  thText: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1, color: "#a9b5c8" },
  cPos: { width: 38 },
  cMove: { width: 38 },
  cNum: { width: 50, textAlign: "center" },
  cThru: { width: 40, textAlign: "center" },
  mine: { backgroundColor: "#24406a", borderLeftWidth: 4, borderLeftColor: colors.gold400, paddingLeft: 8 },
  pos: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.cream50 },
  move: { fontFamily: fonts.bodyBold, fontSize: 15 },
  name: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.cream50 },
  club: { fontFamily: fonts.body, fontSize: 13, color: "#a9b5c8" },
  total: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.cream50 },
  today: { fontFamily: fonts.bodySemi, fontSize: 16, color: "#d5dce6" },
  thru: { fontFamily: fonts.bodySemi, fontSize: 15, color: "#d5dce6" },
  empty: { fontFamily: fonts.body, fontSize: 15, color: SOFT, padding: spacing.md },
  legend: { fontFamily: fonts.body, fontSize: 13, color: "#a9b5c8", padding: 12 },
  panel: { gap: 10, padding: spacing.md, borderRadius: radii.lg, backgroundColor: PANEL, borderWidth: 1, borderColor: LINE },
  panelKicker: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 1.4, color: colors.gold400 },
  moverRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  moverName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.cream50 },
  moverMeta: { fontFamily: fonts.body, fontSize: 14, color: SOFT },
  join: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  joinMine: { backgroundColor: colors.green100 },
  joinText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.cream50 },
  joinTextMine: { color: colors.green800 },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  day: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radii.lg, backgroundColor: PANEL, borderWidth: 1, borderColor: LINE },
  dayBadge: { width: 50, height: 50, borderRadius: radii.md, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  dayBadgeSmall: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: NAVY },
  dayBadgeNum: { fontFamily: fonts.bodyBold, fontSize: 20, color: NAVY, lineHeight: 22 },
  dayCourse: { fontFamily: fonts.bodyBold, fontSize: 16.5, color: colors.cream50 },
  dayMeta: { fontFamily: fonts.body, fontSize: 13.5, color: SOFT },
  dayFormat: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: UP },
  status: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: SOFT },
  youIn: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.gold400 },
  tv: { flexDirection: "row", gap: 8, minHeight: 50, borderRadius: radii.pill, borderWidth: 1, borderColor: LINE, alignItems: "center", justifyContent: "center" },
  tvText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  cancelLink: { fontFamily: fonts.bodySemi, fontSize: 14, color: DOWN, textAlign: "center", textDecorationLine: "underline" },
});
