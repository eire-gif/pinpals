import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { loadMyShares } from "@/lib/live-follow";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * "Share live" on the scoring screen (Follow my round, 0158): one tap to
 * let a parent or a friend follow the card. Says how many are watching, so
 * a player always knows their card is out there, and opens Share live to
 * add someone or stop it.
 */
export function ShareLiveRow({ roundId, organiser, guestOnly }: { roundId: number; organiser: boolean; guestOnly: boolean }) {
  const [watching, setWatching] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let on = true;
      loadMyShares(roundId)
        .then((s) => on && setWatching(s.length))
        .catch(() => on && setWatching(null));
      return () => {
        on = false;
      };
    }, [roundId])
  );

  const sub =
    watching && watching > 0
      ? `${watching} watching · tap to add someone or stop`
      : guestOnly
        ? "Let a guest's family follow their card, hole by hole"
        : "Let family or a friend follow your card, hole by hole";

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/live/share/[id]", params: organiser ? { id: String(roundId), org: "1" } : { id: String(roundId) } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={`Share live. ${sub}`}
    >
      <View style={styles.icon}>
        <Ionicons name="radio" size={20} color={colors.gold400} />
        {watching && watching > 0 ? <View style={styles.dot} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Share live</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.gold400} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.navy900,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(232,196,107,0.16)", alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 4, right: 4, width: 9, height: 9, borderRadius: 5, backgroundColor: "#4fc274", borderWidth: 1.5, borderColor: colors.navy900 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: "#c9d3e0" },
});
