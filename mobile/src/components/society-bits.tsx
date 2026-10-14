import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { PlaceStatus } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Small pieces the society screens share (0142–0145): the status chips that
 * say where a member stands, a white card, a labelled section, a row that
 * opens something. One look everywhere, so "Waiting list" means the same
 * colour on the fixtures list, the event and the organiser's tabs.
 */

export type ChipTone = "ok" | "asked" | "wait" | "due" | "grey" | "navy";

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  ok: { bg: colors.green100, fg: colors.green800 },
  asked: { bg: "#dce6f5", fg: "#1d4682" },
  wait: { bg: "#f5e6c6", fg: "#6b4403" },
  due: { bg: colors.red100, fg: "#8c1d16" },
  grey: { bg: "#e7e3da", fg: "#454e60" },
  navy: { bg: colors.navy900, fg: colors.gold400 },
};

export function Chip({ tone, children, style }: { tone: ChipTone; children: string; style?: StyleProp<ViewStyle> }) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.chipText, { color: t.fg }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** "Confirmed", "Requested", "Waiting list · 2nd", "Place offered". */
export function placeChip(status: PlaceStatus, linePosition?: number | null): { tone: ChipTone; label: string } {
  switch (status) {
    case "confirmed":
      return { tone: "ok", label: "Confirmed" };
    case "requested":
      return { tone: "asked", label: "Requested" };
    case "waiting":
      return { tone: "wait", label: linePosition ? `Waiting list · ${ordinal(linePosition)}` : "Waiting list" };
    case "offered":
      return { tone: "wait", label: "Place offered" };
  }
}

export function PlaceChip({ status, linePosition }: { status: PlaceStatus; linePosition?: number | null }) {
  const c = placeChip(status, linePosition);
  return <Chip tone={c.tone}>{c.label}</Chip>;
}

export const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Kicker({ children, color }: { children: string; color?: string }) {
  return <Text style={[styles.kicker, color ? { color } : null]}>{children.toUpperCase()}</Text>;
}

/** A tappable row: icon, title, detail, chevron. */
export function LinkRow({ icon, title, detail, onPress, right, accessibilityLabel }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail?: string | null; onPress: () => void; right?: ReactNode; accessibilityLabel?: string }) {
  return (
    <Pressable style={styles.linkRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? [title, detail].filter(Boolean).join(", ")}>
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={19} color={colors.navy900} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={styles.linkTitle}>{title}</Text>
        {detail ? <Text style={styles.linkDetail}>{detail}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={colors.ink500} />}
    </Pressable>
  );
}

/** A big button: navy (main), gold, or outlined. */
export function Button({ label, onPress, tone = "navy", icon, disabled, busy, style }: { label: string; onPress: () => void; tone?: "navy" | "gold" | "line" | "danger"; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  const bg = tone === "navy" ? colors.navy900 : tone === "gold" ? colors.gold400 : colors.surface;
  const fg = tone === "navy" ? colors.cream50 : tone === "gold" ? colors.navy900 : tone === "danger" ? colors.red600 : colors.navy900;
  return (
    <Pressable
      style={[styles.button, { backgroundColor: bg }, tone === "line" || tone === "danger" ? styles.buttonLine : null, (disabled || busy) && { opacity: 0.5 }, style]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    >
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{busy ? "Saving…" : label}</Text>
    </Pressable>
  );
}

/** €80, €65.50. */
export const euro = (cents: number | null | undefined): string => {
  if (cents == null) return "";
  return cents % 100 === 0 ? `€${(cents / 100).toLocaleString("en-IE")}` : `€${(cents / 100).toFixed(2)}`;
};

const styles = StyleSheet.create({
  chip: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.sm },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: "#7e5f14" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  linkIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream100 },
  linkTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  linkDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  button: { flexDirection: "row", gap: 8, minHeight: 50, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  buttonLine: { borderWidth: 1.5, borderColor: colors.line },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: type.body },
});
