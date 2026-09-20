import { Image, StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "@/lib/theme";

/**
 * A member, shown as themselves.
 *
 * `avatar_url` is a full public Supabase Storage URL, so it renders directly
 * — no signing, no path building. `avatar_color` is the fallback, and it is
 * the reason this never looks sparse: one member in ten has uploaded a
 * photograph, but every member has a colour, so the initials treatment is
 * the normal case rather than the sad case. The website does exactly this.
 *
 * Initials, not a generic silhouette. A grey outline of a person says "we
 * know nothing about you"; two letters on your own colour says "this is
 * you", and in a list of four golfers they are actually distinguishable.
 */
export function Avatar({
  url,
  color,
  name,
  size = 34,
}: {
  url?: string | null;
  color?: string | null;
  name?: string | null;
  size?: number;
}) {
  const box = { width: size, height: size, borderRadius: size / 2 };

  if (url) {
    return <Image source={{ uri: url }} style={[styles.image, box]} />;
  }

  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <View
      style={[
        styles.fallback,
        box,
        { backgroundColor: color || colors.green700 },
      ]}
    >
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}>
        {initials || "·"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.cream100 },
  fallback: { alignItems: "center", justifyContent: "center" },
  initials: {
    fontFamily: fonts.bodyBold,
    color: colors.cream50,
    letterSpacing: 0.3,
  },
});
