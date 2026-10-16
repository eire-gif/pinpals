import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { GoldButton } from "@/components/gold-button";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { createFollowLink, expiresLabel, loadMyShares, shareWithPinPals, stopFollow, type MyShare } from "@/lib/live-follow";
import { loadLiveRound, type LiveRoundData } from "@/lib/live-rounds";
import { listConnections, type Member } from "@/lib/members";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Share live (Follow my round, 0158, claude/follow-my-round.md).
 *
 * Opened from the scoring screen. Lets someone who isn't playing — a parent
 * at home, a friend at work — follow a card hole by hole:
 *
 *   - a LINK, for anyone: no app or account; text it or drop it in a chat
 *   - to PINPALS: it opens in their app and on their Home Screen widget, and
 *     they're told about birdies and the finish
 *
 * Whose card: your own; and if you started the round (or organise its day),
 * a guest's — a junior playing as a guest, say. Never another member's: they
 * share their own. The server checks all of this too (live_follow_share).
 *
 * Who's watching lists what you've shared, with Stop. Everything stops by
 * itself 18 hours after it was shared.
 */
export default function ShareLiveScreen() {
  const params = useLocalSearchParams<{ id: string; player?: string; org?: string }>();
  const roundId = Number(params.id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [data, setData] = useState<LiveRoundData | null>(null);
  const [shares, setShares] = useState<MyShare[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [playerId, setPlayerId] = useState<number | null>(params.player ? Number(params.player) : null);
  const [pals, setPals] = useState<Member[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"link" | "pals" | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(roundId)) return;
    try {
      setFailed(false);
      const [d, s] = await Promise.all([loadLiveRound(roundId), loadMyShares(roundId)]);
      setData(d);
      setShares(s);
    } catch {
      setFailed(true);
    }
  }, [roundId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useFocusEffect(
    useCallback(() => {
      if (!me || pals != null) return;
      listConnections(me)
        .then((c) => setPals(c.accepted))
        .catch(() => setPals([]));
    }, [me, pals])
  );

  // Cards this member may share: their own, and guests' if they run the game.
  const choices = useMemo(() => {
    if (!data || !me) return [];
    const runsIt = data.round.createdBy === me || params.org === "1";
    return [...data.players]
      .sort((a, b) => a.position - b.position)
      .filter((p) => p.memberId === me || (runsIt && p.memberId == null));
  }, [data, me, params.org]);

  const chosen = choices.find((p) => p.id === playerId) ?? choices.find((p) => p.memberId === me) ?? choices[0] ?? null;
  const ownCard = chosen?.memberId === me;
  const whose = chosen ? (ownCard ? "your" : `${chosen.name.split(" ")[0]}'s`) : "your";
  const theirName = chosen ? (ownCard ? "my" : `${chosen.name.split(" ")[0]}'s`) : "my";

  if (!isOn("liveFollow")) {
    return <StateMessage size="screen" icon="radio-outline" title="Sharing live is on its way" body="Soon you'll be able to let family and friends follow your round, hole by hole." />;
  }
  if (failed) return <LoadError size="screen" what="this round" onRetry={() => void load()} />;
  if (!data || shares == null) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (data.round.status !== "live") {
    return <StateMessage size="screen" icon="flag-outline" title="This round has finished" body="Sharing live is for rounds in play. To send the finished card, use Share on the scorecard." />;
  }
  if (!chosen) {
    return (
      <StateMessage
        size="screen"
        icon="lock-closed-outline"
        title="Nothing here you can share"
        body="You can share your own card, or a guest's in a round you started. Players share their own."
      />
    );
  }

  const shareLink = async () => {
    setBusy("link");
    let url: string | null = null;
    try {
      url = await createFollowLink(roundId, chosen.id);
    } catch (e) {
      Alert.alert("Couldn't make a link", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
    if (!url) return;
    void load();
    const message = `Follow ${theirName} round at ${data.round.courseName} live, hole by hole: ${url}`;
    try {
      await Share.share({ message });
    } catch {
      // Dismissed: the link still works and is listed under Who's watching.
    }
  };

  const sendToPals = async () => {
    if (picked.size === 0) return;
    setBusy("pals");
    try {
      const n = await shareWithPinPals(roundId, chosen.id, [...picked]);
      setPicked(new Set());
      void load();
      Alert.alert("Shared", n === 1 ? "They'll get a notification to follow along." : "They'll each get a notification to follow along.");
    } catch (e) {
      Alert.alert("Couldn't share it", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const stop = (s: MyShare) =>
    Alert.alert(
      s.kind === "link" ? "Stop this link?" : `Stop sharing with ${s.name}?`,
      s.kind === "link" ? "Anyone with it will see that sharing has ended. A new link can be made any time." : "They'll stop seeing the card.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Stop",
          style: "destructive",
          onPress: async () => {
            setShares((all) => (all ?? []).filter((x) => x.id !== s.id));
            try {
              await stopFollow(s.id);
            } catch (e) {
              Alert.alert("Couldn't stop it", e instanceof Error ? e.message : "Please try again.");
              void load();
            }
          },
        },
      ]
    );

  const mineShares = shares.filter((s) => s.playerId === chosen.id);
  const following = new Set(mineShares.map((s) => s.followerId).filter(Boolean) as string[]);
  const q = query.trim().toLowerCase();
  const palList = (pals ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  const inRound = new Set(data.players.map((p) => p.memberId).filter(Boolean) as string[]);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Ionicons name="radio" size={22} color={colors.gold400} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Let someone follow {whose === "your" ? "your round" : `${whose} round`}
        </Text>
        <Text style={styles.body}>
          They see {whose} card update as {ownCard ? "you score" : "it's scored"}, hole by hole, and the place in your game — not anyone
          else&apos;s scores. Great for a parent at home or a friend at work.
        </Text>
      </View>

      {choices.length > 1 ? (
        <View style={styles.section}>
          <Text style={styles.label}>Whose card</Text>
          <View style={styles.chips}>
            {choices.map((p) => {
              const on = p.id === chosen.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPlayerId(p.id)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.memberId === me ? "Mine" : `${p.name} (guest)`}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="link" size={20} color={colors.green700} />
          <Text style={styles.cardTitle}>Send a link</Text>
        </View>
        <Text style={styles.body}>Works for anyone — no app or account needed. Text it, or drop it in the family chat.</Text>
        <GoldButton label="Share a link" busy={busy === "link"} disabled={busy != null} onPress={() => void shareLink()} />
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Ionicons name="people" size={20} color={colors.green700} />
          <Text style={styles.cardTitle}>Send to PinPals</Text>
        </View>
        <Text style={styles.body}>It opens in their app and on their Home Screen widget, and they hear about birdies and the finish.</Text>
        {pals == null ? (
          <ActivityIndicator color={colors.green700} />
        ) : pals.length === 0 ? (
          <Text style={styles.muted}>No PinPals yet. Send a link instead.</Text>
        ) : (
          <>
            {pals.length > 8 ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your PinPals"
                placeholderTextColor={colors.ink500}
                style={styles.search}
                accessibilityLabel="Search your PinPals"
              />
            ) : null}
            <View style={styles.list}>
              {palList.slice(0, 40).map((p, i) => {
                const on = picked.has(p.id);
                const already = following.has(p.id);
                const playing = inRound.has(p.id);
                const disabled = already || playing;
                return (
                  <Pressable
                    key={p.id}
                    disabled={disabled}
                    onPress={() =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (next.has(p.id)) next.delete(p.id);
                        else if (next.size < 10) next.add(p.id);
                        return next;
                      })
                    }
                    style={[styles.palRow, i > 0 && styles.divider, disabled && styles.palOff]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled }}
                    accessibilityLabel={`${p.name}${already ? ", already following" : playing ? ", playing in this round" : ""}`}
                  >
                    <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.palName}>{p.name}</Text>
                      {already ? <Text style={styles.muted}>Following</Text> : playing ? <Text style={styles.muted}>Playing in this round</Text> : null}
                    </View>
                    {!disabled ? <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? colors.green700 : colors.line} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <GoldButton
              label={picked.size === 0 ? "Choose who" : `Share with ${picked.size}`}
              busy={busy === "pals"}
              disabled={picked.size === 0 || busy != null}
              onPress={() => void sendToPals()}
            />
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Who&apos;s watching</Text>
        {mineShares.length === 0 ? (
          <Text style={styles.muted}>Nobody yet.</Text>
        ) : (
          <View style={styles.list}>
            {mineShares.map((s, i) => (
              <View key={s.id} style={[styles.palRow, i > 0 && styles.divider]}>
                <Ionicons name={s.kind === "link" ? "link-outline" : "person-outline"} size={20} color={colors.navy900} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.palName}>{s.kind === "link" ? "A shared link" : s.name}</Text>
                  <Text style={styles.muted}>{expiresLabel(s.expiresAt)}</Text>
                </View>
                <Pressable onPress={() => stop(s)} style={styles.stop} accessibilityRole="button" accessibilityLabel={s.kind === "link" ? "Stop this link" : `Stop sharing with ${s.name}`}>
                  <Text style={styles.stopText}>Stop</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Text style={styles.muted}>Sharing stops by itself after the round. Your location is never shared.</Text>
      </View>

      <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
        <Text style={styles.backText}>Back to the scorecard</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  intro: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  introIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(232,196,107,0.16)", alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.cream50 },
  body: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
  section: { gap: spacing.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.navy900 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.sm + 2 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.ink900 },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink500 },
  search: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surfaceTint,
  },
  list: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  palRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 54 },
  palOff: { opacity: 0.6 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  palName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  stop: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.red600, paddingHorizontal: 12, paddingVertical: 6 },
  stopText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.red600 },
  back: { alignSelf: "center", padding: spacing.sm },
  backText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
});
