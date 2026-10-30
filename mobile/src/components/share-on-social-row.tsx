import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { loadSharedOnSocial, setSharedOnSocial, type Thread } from "@/lib/social-live";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * "Share live on PinPals Social" (Oct 2026, 0195, claude/social-live.md): one
 * switch, off unless someone turns it on. For a day, the organiser; for a
 * round outside a day, anyone playing in it. While it's on, every PinPals
 * member (18+) sees a red LIVE circle on Social and can watch the leaderboard,
 * add Great Shots and comment. The database refuses a secret leaderboard or a
 * game with a member under 18 playing, and says why.
 */
export function ShareOnSocialRow({ thread, what }: { thread: Thread; what: "day" | "round" }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadSharedOnSocial(thread)
        .then((v) => live && setOn(v))
        .catch(() => live && setOn(null));
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, ["dayId" in thread ? `d${thread.dayId}` : `r${thread.roundId}`])
  );

  const change = async (to: boolean) => {
    setBusy(true);
    try {
      await setSharedOnSocial(thread, to);
      setOn(to);
    } catch (e) {
      Alert.alert("Couldn't change it", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (to: boolean) => {
    if (!to) {
      void change(false);
      return;
    }
    Alert.alert(
      what === "day" ? "Share the day on Social?" : "Share your round on Social?",
      what === "day"
        ? "Everyone on PinPals will see it live on Social: the leaderboard with every player's name and score, and they can add Great Shots and comment. You can turn it off at any time."
        : "Everyone on PinPals will see it live on Social: the names and scores in your group, and they can add Great Shots and comment. You can turn it off at any time.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Share it", onPress: () => void change(true) },
      ]
    );
  };

  if (on === null) return null;
  const openView = () =>
    router.push({
      pathname: "/social-live/[id]",
      params: "dayId" in thread ? { id: String(thread.dayId) } : { id: String(thread.roundId), round: "1" },
    });

  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Ionicons name="globe-outline" size={20} color={colors.gold400} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Share live on PinPals Social</Text>
        <Text style={styles.sub}>
          {on ? "Everyone on PinPals can watch and comment" : what === "day" ? "Off: only your group can watch" : "Off: only people you share it with"}
        </Text>
        {on ? (
          <Pressable onPress={openView} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.link}>See it as they do</Text>
          </Pressable>
        ) : null}
      </View>
      <Switch
        value={on}
        onValueChange={toggle}
        disabled={busy}
        trackColor={{ true: colors.green600, false: "rgba(247,243,234,0.25)" }}
        thumbColor={colors.cream50}
        accessibilityLabel="Share live on PinPals Social"
      />
    </View>
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
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: "#c9d3e0" },
  link: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400, marginTop: 4 },
});
