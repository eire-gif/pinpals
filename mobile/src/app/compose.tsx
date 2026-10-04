import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { openPostType } from "@/lib/post-compose";
import { POST_TYPE_INFO, menuPostTypes, type PostType } from "@/lib/post-details";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * "Create a post": choose what kind (Oct 2026 feed redesign, phase 3).
 *
 * The list comes from post-details.ts — order, words, icons and whether each
 * one is live — so adding or holding back a type is a change there, not
 * here. A type marked "soon" shows, greyed, so members know it's coming.
 *
 * Pushed, not presented as a modal: see the note in new-post.tsx about iOS
 * refusing a presentation change after push. Choosing a type REPLACES this
 * screen, so Back from the composer returns to the feed rather than here.
 */

/** Each type's tile colour, from the palette. */
const TILE: Record<PostType, string> = {
  general: colors.green700,
  round: colors.gold500,
  hole: colors.red600,
  shot: colors.navy800,
  photo: colors.green600,
  tee_time: colors.navy900,
};

export default function ComposeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Create a post", headerBackTitle: "Social" }} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        {menuPostTypes().map((t) => {
          const info = POST_TYPE_INFO[t];
          const soon = info.status === "soon";
          return (
            <Pressable
              key={t}
              onPress={soon ? undefined : () => openPostType(t, "replace")}
              disabled={soon}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed, soon && styles.rowSoon]}
              accessibilityRole="button"
              accessibilityState={{ disabled: soon }}
              accessibilityLabel={`${info.title}. ${info.description}${soon ? " Coming soon." : ""}`}
            >
              <View style={[styles.tile, { backgroundColor: TILE[t] }]}>
                <Ionicons name={info.icon as keyof typeof Ionicons.glyphMap} size={22} color={colors.cream50} />
              </View>
              <View style={styles.text}>
                <Text style={styles.title}>{info.title}</Text>
                <Text style={styles.description}>{info.description}</Text>
              </View>
              {soon ? (
                <Text style={styles.soon}>Coming soon</Text>
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md - 2,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.md - 2,
    minHeight: 72,
    shadowColor: colors.navy900,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  rowPressed: { backgroundColor: colors.surfaceTint },
  rowSoon: { opacity: 0.55 },
  tile: { width: 46, height: 46, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  description: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500, marginTop: 2 },
  soon: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },
});
