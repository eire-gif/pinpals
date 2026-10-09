import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { HeaderPill, headerButtons } from "@/components/header-actions";
import { LoadError, StateMessage } from "@/components/state-message";
import { TeeDot } from "@/components/tee-chip";
import { goHome } from "@/lib/go-home";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { indexLabel } from "@/lib/live-scoring";
import { holeResult, playedLabel, scorecardTotals, shareText, shotsOnCard, vsParText, type ScorecardHole } from "@/lib/scorecard-math";
import {
  VISIBILITY_LABELS,
  createScorecardShareLink,
  deleteScorecard,
  loadScorecard,
  saveScorecard,
  scorecardFromLiveRound,
  toInput,
  type Scorecard,
  type Visibility,
} from "@/lib/scorecards";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * One scorecard (0110): the card itself, laid out like the paper one —
 * front nine and back nine, yards, par, stroke index, the score ringed for
 * a birdie and boxed for a bogey — and what you can do with it.
 */
export default function ScorecardScreen() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const cardId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [card, setCard] = useState<Scorecard | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | "share" | "refresh" | "visibility">(null);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      setCard(await loadScorecard(cardId));
    } catch {
      setFailed(true);
    }
  }, [cardId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("scorecards")) return <StateMessage size="screen" icon="document-text-outline" title="Scorecards are on their way" />;
  if (failed) return <LoadError size="screen" what="this scorecard" onRetry={() => void load()} />;
  if (card === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (card === null) return <StateMessage size="screen" icon="lock-closed-outline" title="This scorecard isn't available" body="It may have been deleted, or it isn't shared with you." />;

  const mine = card.memberId === me;
  const t = scorecardTotals(card.holeList, card.playingHandicap);
  const shots = shotsOnCard(card.holeList, card.playingHandicap);
  const front = card.holeList.filter((h) => h.hole <= 9);
  const back = card.holeList.filter((h) => h.hole > 9);
  const hasYards = card.holeList.some((h) => h.yards != null);
  const hasSI = card.holeList.some((h) => h.strokeIndex != null);
  const hasPutts = card.holeList.some((h) => h.putts != null);

  const send = async () => {
    setBusy("share");
    let link: string | null = null;
    try {
      link = (await createScorecardShareLink(card.id)).url;
    } catch {
      // The text still goes; it just has no link to the card.
    }
    setBusy(null);
    try {
      await Share.share({ message: shareText(card, card.holeList, link) });
    } catch {
      // Dismissed.
    }
  };

  const refresh = async () => {
    if (card.liveRoundId == null) return;
    setBusy("refresh");
    try {
      await scorecardFromLiveRound(card.liveRoundId);
      await load();
    } catch (e) {
      Alert.alert("Couldn't update it", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const setVisibility = async (v: Visibility) => {
    if (v === card.visibility) return;
    setBusy("visibility");
    try {
      await saveScorecard(card.id, { ...toInput(card), visibility: v }, card.holeList);
      setCard({ ...card, visibility: v });
    } catch (e) {
      const msg = (e as { message?: unknown } | null)?.message;
      Alert.alert("Couldn't change that", typeof msg === "string" && msg ? msg : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert("Delete this scorecard?", "It goes for good, along with its share link. Posts you made from it stay.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteScorecard(card.id);
            router.back();
          } catch {
            Alert.alert("Couldn't delete it", "Please try again.");
          }
        },
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream50 }}>
      <Stack.Screen options={{ title: "Scorecard", ...headerButtons({ right: <HeaderPill label="Home" variant="secondary" onPress={goHome} accessibilityLabel="Back to Home" /> }) }} />
      <ScrollView contentContainerStyle={styles.page}>
        {mine && saved ? (
          <View style={styles.savedBanner} accessibilityRole="text">
            <Ionicons name="checkmark-circle" size={18} color={colors.green700} />
            <Text style={styles.savedText}>Saved to My scorecards</Text>
          </View>
        ) : null}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>{playedLabel(card.playedOn)}</Text>
          <Text style={styles.heroTitle}>{card.courseName}</Text>
          <View style={styles.heroSubRow}>
          {card.teeName ? <TeeDot name={card.teeName} size={12} /> : null}
          <Text style={styles.heroSub}>
            {[card.teeName ? `${card.teeName} tees` : null, card.holes === 9 ? "9 holes" : "18 holes", card.handicapIndex != null ? `Index ${indexLabel(card.handicapIndex)}` : null, card.playingHandicap != null ? `plays off ${card.playingHandicap}` : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          </View>
          <View style={styles.tiles}>
            <Tile label={t.complete ? "Score" : `Thru ${t.played}`} value={t.complete && t.total.strokes != null ? String(t.total.strokes) : t.played > 0 ? vsParText(t.vsPar) : "—"} big />
            <Tile label="To par" value={vsParText(t.vsPar)} />
            {t.points != null ? <Tile label="Points" value={String(t.points)} /> : null}
            {t.net != null ? <Tile label="Net" value={String(t.net)} /> : null}
            {t.total.putts != null ? <Tile label="Putts" value={String(t.total.putts)} /> : null}
          </View>
        </View>

        <Nine title={card.holes === 9 ? "Holes 1–9" : "Out"} holes={front} total={t.out} shots={shots} yards={hasYards} si={hasSI} putts={hasPutts} />
        {back.length > 0 && t.in ? <Nine title="In" holes={back} total={t.in} shots={shots} yards={hasYards} si={hasSI} putts={hasPutts} /> : null}

        <View style={styles.counts}>
          {(["eagle", "birdie", "par", "bogey", "double"] as const).map((k) => (
            <View key={k} style={styles.count}>
              <Text style={styles.countValue}>{k === "eagle" ? t.counts.eagle + t.counts.albatross : k === "double" ? t.counts.double + t.counts.worse : t.counts[k]}</Text>
              <Text style={styles.countLabel}>{k === "eagle" ? "Eagles+" : k === "double" ? "Doubles+" : `${k[0].toUpperCase()}${k.slice(1)}s`}</Text>
            </View>
          ))}
        </View>

        {mine ? (
          <>
            <View style={styles.actions}>
              <Action icon="chatbubbles-outline" label="Post to Social" onPress={() => router.push({ pathname: "/new-post", params: { type: "round", scorecard: String(card.id) } })} />
              <Action icon="share-outline" label="Send" busy={busy === "share"} onPress={() => void send()} />
              <Action icon="create-outline" label="Edit" onPress={() => router.push({ pathname: "/scorecards/new", params: { id: String(card.id) } })} />
            </View>
            {card.source === "live" && card.liveRoundId != null ? (
              <Pressable onPress={() => void refresh()} disabled={busy != null} style={styles.refresh} accessibilityRole="button">
                {busy === "refresh" ? <ActivityIndicator color={colors.green700} /> : <Ionicons name="refresh" size={16} color={colors.green700} />}
                <Text style={styles.link}>Update from the live round</Text>
              </Pressable>
            ) : null}
            <View style={styles.visibility}>
              <Text style={styles.visTitle}>Who can see this card</Text>
              <View style={styles.chips}>
                {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => void setVisibility(v)}
                    disabled={busy != null}
                    style={[styles.chip, card.visibility === v && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: card.visibility === v }}
                  >
                    <Text style={[styles.chipText, card.visibility === v && styles.chipTextOn]}>{VISIBILITY_LABELS[v]}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.muted}>"Send" makes a link anyone you send it to can open, whoever this is set to.</Text>
            </View>
            <Pressable onPress={goHome} style={({ pressed }) => [styles.homeButton, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Ionicons name="home-outline" size={18} color={colors.cream50} />
              <Text style={styles.homeLabel}>Done — back to Home</Text>
            </Pressable>
            <Pressable onPress={remove} style={styles.delete} accessibilityRole="button">
              <Text style={styles.deleteText}>Delete scorecard</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Nine({
  title,
  holes,
  total,
  shots,
  yards,
  si,
  putts,
}: {
  title: string;
  holes: ScorecardHole[];
  total: { par: number; strokes: number | null; yards: number | null; putts: number | null };
  shots: Map<number, number>;
  yards: boolean;
  si: boolean;
  putts: boolean;
}) {
  return (
    <View style={styles.nine}>
      <Row label="Hole" cells={holes.map((h) => String(h.hole))} total={title} head />
      {yards ? <Row label="Yds" cells={holes.map((h) => (h.yards != null ? String(h.yards) : "–"))} total={total.yards != null ? String(total.yards) : "–"} small /> : null}
      <Row label="Par" cells={holes.map((h) => String(h.par))} total={String(total.par)} />
      {si ? <Row label="SI" cells={holes.map((h) => (h.strokeIndex != null ? String(h.strokeIndex) : "–"))} total="" small /> : null}
      <View style={styles.row}>
        <Text style={[styles.rowLabel, styles.scoreLabel]}>Score</Text>
        {holes.map((h) => (
          <View key={h.hole} style={styles.cell}>
            <ScoreMark hole={h} shots={shots.get(h.hole) ?? 0} />
          </View>
        ))}
        <Text style={[styles.cell, styles.totalCell, styles.scoreTotal]}>{total.strokes ?? "–"}</Text>
      </View>
      {putts ? <Row label="Putts" cells={holes.map((h) => (h.putts != null ? String(h.putts) : "–"))} total={total.putts != null ? String(total.putts) : "–"} small /> : null}
    </View>
  );
}

function Row({ label, cells, total, head = false, small = false }: { label: string; cells: string[]; total: string; head?: boolean; small?: boolean }) {
  return (
    <View style={[styles.row, head && styles.headRow]}>
      <Text style={[styles.rowLabel, head && styles.headText]}>{label}</Text>
      {cells.map((c, i) => (
        <Text key={i} style={[styles.cell, styles.cellText, small && styles.smallText, head && styles.headText]}>
          {c}
        </Text>
      ))}
      <Text style={[styles.cell, styles.totalCell, styles.cellText, small && styles.smallText, head && styles.headText]}>{total}</Text>
    </View>
  );
}

/** Ringed for under par, boxed for over, the way a card is marked up. */
function ScoreMark({ hole, shots }: { hole: ScorecardHole; shots: number }) {
  if (hole.strokes == null) return <Text style={styles.cellText}>–</Text>;
  const r = holeResult(hole.strokes, hole.par);
  const ring = r === "birdie" || r === "eagle" || r === "albatross";
  const box = r === "bogey" || r === "double" || r === "worse";
  return (
    <View>
      <View
        style={[
          styles.mark,
          ring && styles.ring,
          (r === "eagle" || r === "albatross") && styles.ringDouble,
          box && styles.box,
          (r === "double" || r === "worse") && styles.boxDouble,
        ]}
      >
        <Text style={[styles.markText, ring && { color: colors.green800 }]}>{hole.strokes}</Text>
      </View>
      {shots > 0 ? <Text style={styles.dot}>{"•".repeat(Math.min(shots, 2))}</Text> : null}
    </View>
  );
}

function Tile({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, big && styles.tileBig]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, busy = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      {busy ? <ActivityIndicator color={colors.navy900} /> : <Ionicons name={icon} size={20} color={colors.navy900} />}
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const CELL = 1;

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md + 4, gap: 4 },
  heroEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.cream50 },
  heroSub: { fontFamily: fonts.body, fontSize: 13.5, color: creamAlpha(0.8) },
  tiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  tile: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: creamAlpha(0.08) },
  tileValue: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  tileBig: { fontSize: 30, color: colors.gold400 },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: creamAlpha(0.7) },
  nine: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 28, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  headRow: { backgroundColor: colors.green800 },
  rowLabel: { width: 44, paddingLeft: 8, fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  scoreLabel: { color: colors.ink900 },
  headText: { color: colors.cream50, fontFamily: fonts.bodyBold },
  cell: { flex: CELL, alignItems: "center", justifyContent: "center", textAlign: "center", paddingVertical: 4 },
  cellText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink900, textAlign: "center" },
  smallText: { fontSize: 10.5, color: colors.ink500 },
  totalCell: { flex: 1.5, backgroundColor: colors.cream100 },
  scoreTotal: { fontFamily: fonts.display, fontSize: 16, color: colors.ink900 },
  mark: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  ring: { borderRadius: 12, borderWidth: 1.5, borderColor: colors.green700 },
  ringDouble: { borderWidth: 3 },
  box: { borderWidth: 1.5, borderColor: colors.red600, borderRadius: 2 },
  boxDouble: { borderWidth: 3 },
  markText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink900 },
  dot: { position: "absolute", top: -6, right: -4, fontSize: 10, color: colors.green700 },
  counts: { flexDirection: "row", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, paddingVertical: spacing.sm },
  count: { flex: 1, alignItems: "center" },
  countValue: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
  countLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.ink500 },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, alignItems: "center", gap: 4, paddingVertical: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.gold400 },
  actionLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },
  refresh: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  visibility: { gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, padding: spacing.md },
  visTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green700 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: 14, minHeight: 36, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },
  muted: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.ink500 },
  savedBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.green100 },
  savedText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green800 },
  heroSubRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  homeButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.navy900 },
  homeLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  delete: { alignItems: "center", paddingVertical: spacing.sm },
  deleteText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.red600 },
});
