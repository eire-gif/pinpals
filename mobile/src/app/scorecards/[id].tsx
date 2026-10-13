import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CertifyPanel } from "@/components/certify-panel";
import { HeaderPill, headerButtons } from "@/components/header-actions";
import { LoadError, StateMessage } from "@/components/state-message";
import { TeeDot } from "@/components/tee-chip";
import { goHome } from "@/lib/go-home";
import { Nine } from "@/components/scorecard-grid";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { indexLabel } from "@/lib/live-scoring";
import { playedLabel, scorecardTotals, shareText, shotsOnCard, vsParText, type ScorecardHole } from "@/lib/scorecard-math";
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
  // token: opened from a shared link (/c/<token>, lib/incoming-links.ts).
  // certify=1: arrived from "Get my card certified" after finishing a round.
  const { id, saved, token, certify } = useLocalSearchParams<{ id: string; saved?: string; token?: string; certify?: string }>();
  const cardId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [card, setCard] = useState<Scorecard | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<null | "share" | "refresh" | "visibility">(null);
  // Certification (0128): reloads with the card; marks a queried hole.
  const [version, setVersion] = useState(0);
  const [autoAsk, setAutoAsk] = useState(certify === "1");
  const [queried, setQueried] = useState<number | null>(null);
  const autoAsked = useCallback(() => setAutoAsk(false), []);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      setCard(await loadScorecard(cardId));
      setVersion((v) => v + 1);
    } catch {
      setFailed(true);
    }
  }, [cardId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // A shared card the member can't see in the app (Only me, or My PinPals
  // and they aren't connected): the link still works — show the public page,
  // which checks the link's signature, exactly as a friend without the app sees it.
  useEffect(() => {
    if (card === null && token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      router.replace({ pathname: "/web", params: { path: `/c/${token}`, title: "Scorecard" } });
    }
  }, [card, token]);

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
        {card.teamCard ? (
          <View style={styles.teamNote} accessibilityRole="text">
            <Ionicons name="people" size={18} color={colors.navy900} />
            <Text style={styles.teamNoteText}>
              {card.teamCard === "scramble" ? "A scramble team's card" : card.teamCard === "greensomes" ? "A greensomes pair's card" : "A foursomes pair's card"}: one ball, played off the{" "}
              {card.teamCard === "scramble" ? "team's" : "pair's"} handicap. It's certified by the other side, and it isn't used for your handicap.
            </Text>
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

        {isOn("scorecardCertification") ? (
          <CertifyPanel scorecardId={card.id} mine={mine} autoAsk={autoAsk} onAutoAsked={autoAsked} version={version} onQueryHole={setQueried} />
        ) : null}

        <Nine title={card.holes === 9 ? "Holes 1–9" : "Out"} holes={front} total={t.out} shots={shots} yards={hasYards} si={hasSI} putts={hasPutts} highlight={queried} />
        {back.length > 0 && t.in ? <Nine title="In" holes={back} total={t.in} shots={shots} yards={hasYards} si={hasSI} putts={hasPutts} highlight={queried} /> : null}

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

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md + 4, gap: 4 },
  teamNote: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.cream100, borderRadius: radii.md, padding: spacing.md },
  teamNoteText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink900 },
  heroEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.cream50 },
  heroSub: { fontFamily: fonts.body, fontSize: 13.5, color: creamAlpha(0.8) },
  tiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  tile: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: creamAlpha(0.08) },
  tileValue: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  tileBig: { fontSize: 30, color: colors.gold400 },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: creamAlpha(0.7) },
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
