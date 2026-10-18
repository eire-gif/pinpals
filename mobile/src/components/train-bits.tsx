import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LieArtTile } from "@/components/train-art";
import { forHand, type Drill, type DrillFocus, type Hand, type Level, type Lie } from "@/lib/training";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/** Pieces shared by the Training screens (app/train/…). */

export const LEVEL_LOOK: Record<Level, { bg: string; fg: string }> = {
  Easy: { bg: colors.green100, fg: colors.green700 },
  Medium: { bg: "#f6ecd2", fg: "#7a5a12" },
  Hard: { bg: colors.red100, fg: colors.red600 },
};

export const FOCUS_LOOK: Record<DrillFocus, { label: string; fg: string }> = {
  speed: { label: "SPEED", fg: "#8a6a1f" },
  line: { label: "START LINE", fg: colors.navy800 },
  short: { label: "SHORT PUTTS", fg: colors.green700 },
  game: { label: "GAME", fg: colors.red600 },
};

export function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={bits.sectionHead}>
      <Text style={bits.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Text style={bits.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function GoldButton({ label, icon, onPress, hint }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; hint?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [bits.gold, pressed && bits.goldPressed]} accessibilityRole="button" accessibilityHint={hint}>
      {icon ? <Ionicons name={icon} size={18} color={colors.navy900} /> : null}
      <Text style={bits.goldText}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({ label, icon, onPress, dark = false }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; dark?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [bits.ghost, dark && bits.ghostDark, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      {icon ? <Ionicons name={icon} size={17} color={dark ? colors.cream50 : colors.navy900} /> : null}
      <Text style={[bits.ghostText, dark && { color: colors.cream50 }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [bits.chip, on && bits.chipOn, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[bits.chipText, on && bits.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function LevelPill({ level }: { level: Level }) {
  const look = LEVEL_LOOK[level];
  return <Text style={[bits.level, { backgroundColor: look.bg, color: look.fg }]}>{level}</Text>;
}

export function LieRow({ lie, hand, onPress, first }: { lie: Lie; hand: Hand; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [bits.row, !first && bits.rowLine, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={`${lie.name}. ${forHand(lie.key, hand)}. ${lie.level}.`}
    >
      <LieArtTile art={lie.art} size={52} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={bits.rowName}>{lie.name}</Text>
        <Text style={bits.rowBlurb}>{forHand(lie.key, hand)}</Text>
      </View>
      <LevelPill level={lie.level} />
    </Pressable>
  );
}

export function DrillRow({ drill, best, onPress, first }: { drill: Drill; best?: string; onPress: () => void; first?: boolean }) {
  const look = FOCUS_LOOK[drill.focus];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [bits.row, !first && bits.rowLine, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={`${drill.name}. ${drill.blurb}. ${drill.minutes} minutes.${drill.home ? " Works at home." : ""}${best ? ` Your best: ${best}.` : ""}`}
    >
      <View style={bits.drillIcon}>
        <Text style={bits.drillMins}>{drill.minutes}</Text>
        <Text style={bits.drillMinsUnit}>min</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[bits.kicker, { color: look.fg }]}>
          {look.label}
          {drill.home ? "  ·  AT HOME" : ""}
        </Text>
        <Text style={bits.rowName}>{drill.name}</Text>
        <Text style={bits.rowBlurb}>{drill.blurb}</Text>
        {best ? <Text style={bits.best}>{`Your best: ${best}`}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.gold500} />
    </Pressable>
  );
}

export function Card({ children, dark = false, style }: { children: ReactNode; dark?: boolean; style?: object }) {
  return <View style={[bits.card, dark && bits.cardDark, style]}>{children}</View>;
}

export const bits = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },

  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 6 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.navy900 },
  sectionAction: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 22, padding: 18, gap: 12 },
  cardDark: { backgroundColor: colors.navy900, borderColor: "rgba(211,165,63,0.55)" },
  group: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 22, overflow: "hidden" },

  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.6, color: colors.gold500 },
  h2: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink900 },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink500 },

  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11, minHeight: 66 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.navy900 },
  rowBlurb: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17, color: colors.ink500 },
  best: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.green700 },
  level: { fontFamily: fonts.bodyBold, fontSize: 11, borderRadius: radii.pill, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 4 },

  drillIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.navy900, borderWidth: 1, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  drillMins: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold400, lineHeight: 18 },
  drillMinsUnit: { fontFamily: fonts.body, fontSize: 10, color: colors.cream100 },

  chips: { gap: 8, paddingRight: spacing.md },
  chip: { minHeight: 38, paddingHorizontal: 15, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.gold500 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.navy900 },
  chipTextOn: { color: colors.gold400 },

  gold: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
    shadowColor: "#9c7a2c",
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  goldPressed: { transform: [{ translateY: 3 }], shadowOpacity: 0 },
  goldText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  ghost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  ghostDark: { backgroundColor: "transparent", borderColor: "rgba(247,243,234,0.4)" },
  ghostText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },

  foot: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.ink500, textAlign: "center", paddingHorizontal: 8 },
});
