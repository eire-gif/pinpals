import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { circleDetail, initialsOf, type LiveCircle } from "@/lib/social-live-rules";
import { colors, fonts, spacing } from "@/lib/theme";

/**
 * The row of circles across the top of Social (Oct 2026, claude/social-live.md),
 * Instagram-style: you (+, to post), the round you're playing, your groups'
 * days going on now (red LIVE — the full-screen live view), cards friends
 * have shared with you (green LIVE), and results just published (gold).
 */
const RING = 64;

export function LiveCircles({
  circles,
  me,
}: {
  circles: readonly LiveCircle[];
  me: { name: string; avatarUrl: string | null; avatarColor: string | null } | null;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Going on now"
    >
      {circles.map((c) => (
        <Circle key={keyOf(c)} circle={c} me={me} />
      ))}
    </ScrollView>
  );
}

const keyOf = (c: LiveCircle) =>
  c.kind === "post" ? "post" : c.kind === "mine" ? `mine-${c.roundId}` : c.kind === "day" ? `day-${c.dayId}` : c.kind === "follow" ? `f-${c.followId}` : `r-${c.dayId}`;

function open(c: LiveCircle) {
  switch (c.kind) {
    case "post":
      router.push("/compose");
      return;
    case "mine":
      router.push({ pathname: "/live/round/[id]", params: { id: String(c.roundId) } });
      return;
    case "day":
      router.push({ pathname: "/social-live/[id]", params: { id: String(c.dayId) } });
      return;
    case "follow":
      router.push({ pathname: "/live/follow/[id]", params: { id: String(c.followId) } });
      return;
    case "results":
      router.push({ pathname: "/live/day/results/[id]", params: { id: String(c.dayId) } });
      return;
  }
}

function Circle({ circle: c, me }: { circle: LiveCircle; me: { name: string; avatarUrl: string | null; avatarColor: string | null } | null }) {
  const ring = c.kind === "day" ? colors.red600 : c.kind === "results" ? colors.gold500 : c.kind === "post" ? "transparent" : colors.green600;
  const tag = c.kind === "day" || c.kind === "mine" || c.kind === "follow" ? "LIVE" : null;
  const name =
    c.kind === "post"
      ? "Post"
      : c.kind === "mine"
        ? "Your round"
        : c.kind === "day"
          ? c.title
          : c.kind === "follow"
            ? c.name
            : (c.groupName ?? "Results");
  const detail = c.kind === "post" ? null : circleDetail(c);
  const label =
    c.kind === "post"
      ? "Share a post"
      : c.kind === "day"
        ? `${c.title}${c.groupName ? `, ${c.groupName}` : ""}, live now, ${detail}. Watch`
        : c.kind === "results"
          ? `${c.groupName}: results in for ${c.title}`
          : `${name}, live, ${detail}`;

  return (
    <Pressable onPress={() => open(c)} style={styles.item} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.ring, { borderColor: ring }]}>
        <Face circle={c} me={me} />
        {c.kind === "post" && (
          <View style={styles.plus}>
            <Ionicons name="add" size={14} color={colors.cream50} />
          </View>
        )}
        {tag && (
          <View style={[styles.tag, { backgroundColor: c.kind === "day" ? colors.red600 : colors.green600 }]}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {detail ? (
        <Text style={[styles.detail, { color: c.kind === "day" ? colors.red600 : c.kind === "results" ? GOLD_TEXT : colors.green700 }]} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Gold dark enough to read on white (4.5:1). */
const GOLD_TEXT = "#7a5c16";

function Face({ circle: c, me }: { circle: LiveCircle; me: { name: string; avatarUrl: string | null; avatarColor: string | null } | null }) {
  if (c.kind === "post" || c.kind === "mine") {
    return <Avatar url={me?.avatarUrl} color={me?.avatarColor} name={me?.name} size={RING - 10} />;
  }
  if (c.kind === "day" && c.logoUrl) {
    return <Image source={{ uri: c.logoUrl }} style={styles.logo} accessibilityIgnoresInvertColors />;
  }
  const text = c.kind === "day" ? initialsOf(c.groupName ?? c.title) : c.kind === "results" ? initialsOf(c.groupName) : initialsOf(c.name);
  const navy = c.kind !== "follow";
  return (
    <View style={[styles.initials, { backgroundColor: navy ? colors.navy900 : colors.green700 }]}>
      <Text style={[styles.initialsText, navy && { color: colors.gold400, fontFamily: fonts.display }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md - 4, paddingTop: spacing.md - 4, paddingBottom: spacing.sm + 2, gap: spacing.md - 4 },
  item: { width: 70, alignItems: "center" },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { width: RING - 10, height: RING - 10, borderRadius: (RING - 10) / 2 },
  initials: { width: RING - 10, height: RING - 10, borderRadius: (RING - 10) / 2, alignItems: "center", justifyContent: "center" },
  initialsText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  plus: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green700,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  tag: {
    position: "absolute",
    bottom: -8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.6, color: "#ffffff" },
  name: { marginTop: 9, fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink900, maxWidth: 70 },
  detail: { fontFamily: fonts.bodyBold, fontSize: 11, marginTop: 1, maxWidth: 70 },
});
