import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScoreMark } from "@/components/score-mark";
import { StateMessage } from "@/components/state-message";
import { ApiError } from "@/lib/api";
import { isOn } from "@/lib/features";
import { loadFollowCard, newHighlight, stopFollow, type FollowCard, type FollowHole } from "@/lib/live-follow";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/**
 * A card a PinPal shared with you (Follow my round, 0158): their scores
 * hole by hole, where they stand, and the hole they're on. Built by the
 * website, so it matches the link version and the Home Screen widget — and
 * never shows anyone else in the game.
 *
 * Reloads every 20 seconds while live and whenever the app comes back to the
 * front. A birdie or better since the last load gets a banner.
 */

const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;

export default function FollowRoundScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const followId = Number(params.id);
  const [card, setCard] = useState<FollowCard | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const prev = useRef<FollowCard | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(followId)) {
      setGone("That link doesn't open a round.");
      return;
    }
    try {
      const next = await loadFollowCard(followId);
      const hl = newHighlight(prev.current, next);
      if (hl) setBanner(`${hl.word} for ${next.firstName} on the ${nth(hl.hole)}!`);
      prev.current = next;
      setCard(next);
      setFailed(false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 410 || e.status === 404)) setGone(e.message || "This round is no longer being shared.");
      else setFailed(true);
    }
  }, [followId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useLiveRefresh(load, card?.state === "live" && !gone);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  if (!isOn("liveFollow")) {
    return <StateMessage size="screen" icon="radio-outline" title="Following rounds is on its way" body="Soon you'll be able to follow a PinPal's round, hole by hole." />;
  }
  if (gone && !card) {
    return <StateMessage size="screen" icon="radio-outline" title="Sharing has ended" body={gone} />;
  }
  if (!card) {
    return failed ? (
      <StateMessage size="screen" icon="cloud-offline-outline" title="Couldn't load the card" body="Check your signal and pull down to try again." />
    ) : (
      <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
    );
  }

  const unfollow = () =>
    Alert.alert(`Stop following ${card.firstName}?`, "You can be sent it again any time.", [
      { text: "Keep following", style: "cancel" },
      {
        text: "Stop",
        style: "destructive",
        onPress: async () => {
          try {
            await stopFollow(followId);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't stop it", e instanceof Error ? e.message : "Please try again.");
          }
        },
      },
    ]);

  const s = card.summary;
  const out = card.holes.filter((h) => h.hole <= 9);
  const inn = card.holes.filter((h) => h.hole > 9);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `Following ${card.firstName}` }} />
      {banner ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Ionicons name="sparkles" size={18} color={colors.navy900} />
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.green700}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.eyebrow}>Following</Text>
            {gone ? (
              <Text style={styles.final}>SHARING ENDED</Text>
            ) : card.state === "live" ? (
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.live}>LIVE</Text>
              </View>
            ) : (
              <Text style={styles.final}>FINAL</Text>
            )}
          </View>
          <Text style={styles.name} accessibilityRole="header">
            {card.name}
          </Text>
          <Text style={styles.meta}>
            {[card.course, card.formatLabel, card.dateLabel].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.meta}>{card.handicapLine}</Text>
          <View style={styles.scoreRow}>
            <Text style={[styles.big, !/^([-+]?\d+|E|–)$/.test(s.big) && styles.bigWord]} accessibilityLabel={`${s.big} ${s.unit}`}>
              {s.big}
              {s.unit ? <Text style={styles.unit}> {s.unit}</Text> : null}
            </Text>
            <View style={styles.scoreSide}>
              <Text style={styles.progress}>{s.progress}</Text>
              {s.place ? (
                <View style={styles.placeChip}>
                  <Text style={styles.placeText}>{s.place}</Text>
                </View>
              ) : null}
            </View>
          </View>
          {s.extra ? <Text style={styles.extra}>{s.extra}</Text> : null}
        </View>

        {card.state === "live" && card.nowPlaying && !gone ? (
          <View style={styles.now}>
            <View style={[styles.liveDot, { backgroundColor: colors.green600 }]} />
            <Text style={styles.nowText}>{s.progress === "Not started" ? `Starting on the ${nth(card.nowPlaying)}` : `Playing the ${nth(card.nowPlaying)}`}</Text>
          </View>
        ) : null}

        <View style={styles.table}>
          <View style={[styles.tr, styles.th]}>
            <Text style={[styles.thText, styles.cHole]}>Hole</Text>
            <Text style={[styles.thText, { flex: 1 }]}>Par</Text>
            <Text style={[styles.thText, styles.cSi]}>SI</Text>
            <Text style={[styles.thText, styles.cScore]}>Score</Text>
            <Text style={[styles.thText, styles.cVal]}>{card.valueHeading}</Text>
          </View>
          {out.map((h) => (
            <HoleRow key={h.hole} card={card} h={h} />
          ))}
          <TotalRow half={card.halves.find((x) => x.label === "Out")} />
          {inn.map((h) => (
            <HoleRow key={h.hole} card={card} h={h} />
          ))}
          <TotalRow half={card.halves.find((x) => x.label === "In")} />
        </View>

        {card.cardIncomplete ? <Text style={styles.note}>Some stroke indexes aren&apos;t on the card yet, so points and nets may move a little.</Text> : null}
        <Text style={styles.note}>
          Add the PinPals widget to your Home Screen to see {card.firstName}&apos;s score at a glance while you follow.
        </Text>

        <Pressable onPress={unfollow} style={styles.unfollow} accessibilityRole="button">
          <Text style={styles.unfollowText}>Stop following</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function HoleRow({ card, h }: { card: FollowCard; h: FollowHole }) {
  const now = card.state === "live" && card.nowPlaying === h.hole;
  const good = card.valueHeading === "PTS" ? Number(h.value) >= 3 : card.valueHeading === "MATCH" ? h.value === "W" : h.value.startsWith("-");
  const bad = card.valueHeading === "PTS" ? h.value === "0" : card.valueHeading === "MATCH" ? h.value === "L" : h.value.startsWith("+");
  return (
    <View style={[styles.tr, now && styles.trNow]} accessibilityLabel={`Hole ${h.hole}, par ${h.par}${h.strokes === undefined ? ", not played" : h.strokes === null ? ", picked up" : `, ${h.strokes}`}${h.value ? `, ${h.value}` : ""}`}>
      <Text style={[styles.hole, styles.cHole, now && { color: colors.green700 }]}>{h.hole}</Text>
      <Text style={[styles.cell, { flex: 1 }]}>
        {h.par}
        {h.shots > 0 ? <Text style={styles.shots}>{"  " + "•".repeat(Math.min(h.shots, 3))}</Text> : null}
      </Text>
      <Text style={[styles.cell, styles.cSi, { color: colors.ink500 }]}>{h.strokeIndex ?? "–"}</Text>
      <View style={styles.cScore}>{h.strokes === undefined ? <Text style={styles.cell}>{now ? "•" : ""}</Text> : <ScoreMark strokes={h.strokes} par={h.par} size={28} />}</View>
      <Text style={[styles.val, styles.cVal, good && { color: colors.green700 }, bad && { color: colors.red600 }]}>{h.value}</Text>
    </View>
  );
}

function TotalRow({ half }: { half: FollowCard["halves"][number] | undefined }) {
  if (!half) return null;
  return (
    <View style={[styles.tr, styles.total]}>
      <Text style={[styles.totalLabel, styles.cHole]}>{half.label}</Text>
      <Text style={[styles.cell, { flex: 1 }]}>{half.par}</Text>
      <Text style={styles.cSi} />
      <Text style={[styles.val, styles.cScore, { textAlign: "center" }]}>{half.strokes}</Text>
      <Text style={[styles.val, styles.cVal]}>{half.value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.gold400,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  bannerText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.lg, gap: 4, borderWidth: 1, borderColor: "rgba(232,196,107,0.35)" },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.6, textTransform: "uppercase", color: colors.gold400 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4fc274" },
  live: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.4, color: "#6fd08c" },
  final: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.4, color: "#9fb0c4" },
  name: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.cream50 },
  meta: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: "#c9d3e0" },
  scoreRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: spacing.sm },
  big: { fontFamily: fonts.bodyBold, fontSize: 56, lineHeight: 60, color: colors.gold400 },
  bigWord: { fontSize: 36, lineHeight: 42 },
  unit: { fontFamily: fonts.bodyBold, fontSize: 18, color: "#c9d3e0" },
  scoreSide: { alignItems: "flex-end", gap: 6, paddingBottom: 6 },
  progress: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  placeChip: { borderRadius: radii.pill, backgroundColor: "rgba(232,196,107,0.16)", paddingHorizontal: 10, paddingVertical: 3 },
  placeText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400 },
  extra: { fontFamily: fonts.body, fontSize: 13, color: "#9fb0c4" },
  now: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: colors.green100, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  nowText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green800 },
  table: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.line },
  trNow: { backgroundColor: "#f3f8f2" },
  th: { minHeight: 34, borderTopWidth: 0, backgroundColor: colors.surfaceTint },
  thText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: colors.ink500 },
  total: { backgroundColor: colors.cream50 },
  totalLabel: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.navy900 },
  cHole: { width: 44 },
  cSi: { width: 36, textAlign: "center" },
  cScore: { width: 56, alignItems: "center" },
  cVal: { width: 48, textAlign: "right" },
  hole: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  cell: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  shots: { color: colors.gold500, fontSize: 12 },
  val: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink500, textAlign: "center" },
  unfollow: { alignSelf: "center", padding: spacing.sm },
  unfollowText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
});
