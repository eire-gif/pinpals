import { useCallback, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { coursePhoto } from "@/components/course-photos";
import { dismissRecap, loadRecapOffers } from "@/lib/recap-prompts";
import type { ConfirmedRound } from "@/lib/rounds";
import { playedWhen, withWhom } from "@/lib/round-recap";
import { todayIso } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * "How did it go?" — the offer to share a round you've played (phase 7).
 * Shown on Home and at the top of the Feed for the most recent played round
 * not yet shared or waved away. "Share your round" opens the composer with
 * the recap filled in; nothing is posted until the member presses Post.
 * Renders nothing when there's nothing to offer.
 */
export function RecapPrompt({ userId, style }: { userId: string | null; style?: StyleProp<ViewStyle> }) {
  const [round, setRound] = useState<ConfirmedRound | null>(null);

  // On focus, so coming back from posting the recap takes the offer away.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let live = true;
      loadRecapOffers(userId)
        .then((offers) => live && setRound(offers[0] ?? null))
        .catch(() => live && setRound(null));
      return () => {
        live = false;
      };
    }, [userId])
  );

  if (!round) return null;
  const who = withWhom(round.players.map((p) => p.name));

  return (
    <View style={[styles.card, style]} accessibilityRole="summary">
      <Image source={coursePhoto(round.clubRef?.id ?? null, round.club)} style={styles.photo} />
      <View style={styles.main}>
        <Text style={styles.kicker}>YOUR ROUND</Text>
        <Text style={styles.title} numberOfLines={2}>
          How did it go at {round.club}?
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          Played {playedWhen(round.playDate, todayIso())}
          {who ? ` with ${who}` : ""}
        </Text>
        <View style={styles.buttons}>
          <Pressable
            onPress={() => router.push({ pathname: "/new-post", params: { type: "round", recap: String(round.inviteId) } })}
            style={styles.share}
            accessibilityRole="button"
          >
            <Text style={styles.shareLabel}>Share your round</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setRound(null);
              void dismissRecap(round.inviteId);
            }}
            style={styles.later}
            accessibilityRole="button"
            accessibilityLabel={`Not now — don't offer a recap for ${round.club}`}
          >
            <Text style={styles.laterLabel}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.sm + 4,
    shadowColor: colors.navy900,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  photo: { width: 76, height: 96, borderRadius: radii.md, backgroundColor: colors.cream100 },
  main: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: fonts.bodySemi, fontSize: 10.5, letterSpacing: 1.4, color: colors.gold500 },
  title: { fontFamily: fonts.display, fontSize: 17, color: colors.ink900, marginTop: 2 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 2 },
  buttons: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  share: { backgroundColor: colors.green700, borderRadius: radii.pill, paddingHorizontal: spacing.md - 2, minHeight: 44, justifyContent: "center" },
  shareLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  later: { paddingHorizontal: spacing.sm, minHeight: 44, justifyContent: "center" },
  laterLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
});
