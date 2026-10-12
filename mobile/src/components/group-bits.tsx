import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GROUP_KIND_INFO, roleLabel, type GroupKind, type GroupOffice, type GroupRole } from "@/lib/groups";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Small pieces the group screens share (0120): the row a group is listed
 * as, its kind's badge, and the owner/admin label on a member.
 */

/** Each kind keeps one colour everywhere it appears. */
const KIND_TINT: Record<GroupKind, string> = {
  crew: colors.green700,
  trip: colors.navy800,
  society: "#7a5a12",
  area: colors.green600,
  club: colors.navy900,
};

export function GroupIcon({ kind, size = 44 }: { kind: GroupKind; size?: number }) {
  return (
    <View style={[styles.icon, { width: size, height: size, borderRadius: size * 0.27, backgroundColor: KIND_TINT[kind] }]}>
      <Ionicons name={GROUP_KIND_INFO[kind].icon as keyof typeof Ionicons.glyphMap} size={size * 0.5} color={colors.cream50} />
    </View>
  );
}

export function membersLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

export function GroupRow({
  kind,
  name,
  detail,
  onPress,
  right,
}: {
  kind: GroupKind;
  name: string;
  detail: string;
  onPress: () => void;
  right?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${name}, ${detail}`}>
      <GroupIcon kind={kind} />
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={colors.ink500} />}
    </Pressable>
  );
}

/** "Owner", "Captain", "Owner · Secretary" or "Admin"; nothing for a member. */
export function RoleBadge({ role, office = null }: { role: GroupRole; office?: GroupOffice | null }) {
  const label = roleLabel(role, office);
  if (!label) return null;
  const owner = role === "owner";
  return (
    <View style={[styles.badge, owner ? styles.badgeOwner : styles.badgeAdmin]}>
      <Text style={[styles.badgeText, owner ? styles.badgeOwnerText : styles.badgeAdminText]}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <Text style={styles.section} accessibilityRole="header">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  icon: { alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  rowBody: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  detail: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radii.pill },
  badgeOwner: { backgroundColor: "#f6ead0" },
  badgeAdmin: { backgroundColor: colors.green100 },
  badgeText: { fontFamily: fonts.bodySemi, fontSize: 12.5 },
  badgeOwnerText: { color: "#6b4d0c" },
  badgeAdminText: { color: colors.green800 },
  section: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    color: colors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
});
