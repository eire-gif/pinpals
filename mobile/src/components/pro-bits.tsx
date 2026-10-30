import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { coursePhoto } from "@/components/course-photos";
import { PRO_BADGE, SERVICE_KIND_LABEL, euroCents, type ProKind, type ServiceKind } from "@/lib/pro-rules";
import type { Pro, ProService } from "@/lib/pros";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/** Book a pro (0204): the pieces the screens share. */

export const SERVICE_ICON: Record<ServiceKind, keyof typeof Ionicons.glyphMap> = {
  lesson: "golf-outline",
  playing: "flag-outline",
  fitting: "construct-outline",
};

/** A pro's course photograph, steady per club, until pros can upload their own. */
export function proPhoto(club: string): ImageSourcePropType {
  return coursePhoto(null, club);
}

export function KindBadge({ kind, onDark = false }: { kind: ProKind; onDark?: boolean }) {
  return (
    <View style={[styles.badge, onDark && { backgroundColor: colors.gold400 }]}>
      <Ionicons name="shield-checkmark" size={12} color={onDark ? colors.ink900 : colors.green800} />
      <Text style={[styles.badgeText, onDark && { color: colors.ink900 }]}>{PRO_BADGE[kind]}</Text>
    </View>
  );
}

export function fromPrice(p: Pro): number | null {
  return p.services.length ? Math.min(...p.services.map((s) => s.priceCents)) : null;
}

/** One pro in Find a pro. */
export function ProCard({ pro, onPress }: { pro: Pro; onPress: () => void }) {
  const from = fromPrice(pro);
  const kinds = [...new Set(pro.services.map((s) => SERVICE_KIND_LABEL[s.kind]))].join(" · ");
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${pro.name}, ${pro.club}`}>
      <Image source={proPhoto(pro.club)} style={styles.cardPhoto} resizeMode="cover" />
      <View style={styles.cardBody}>
        <View style={styles.cardAvatar}>
          <Avatar url={pro.avatarUrl} color={pro.avatarColor} name={pro.name} size={52} />
        </View>
        <View style={{ flex: 1, gap: 3, paddingTop: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={styles.cardName} numberOfLines={1}>
              {pro.name}
            </Text>
            <KindBadge kind={pro.kind} />
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {pro.club}
            {pro.county ? `, Co. ${pro.county}` : ""}
          </Text>
          <Text style={styles.cardOffer} numberOfLines={1}>
            {kinds}
          </Text>
        </View>
        {from != null ? (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.meta}>from</Text>
            <Text style={styles.cardPrice}>{euroCents(from)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** One thing a pro offers, as a tappable row. */
export function ServiceRow({ s, onPress, last, right }: { s: ProService; onPress?: () => void; last?: boolean; right?: React.ReactNode }) {
  return (
    <Pressable style={({ pressed }) => [styles.serviceRow, !last && styles.rowLine, pressed && onPress && { opacity: 0.8 }]} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined}>
      <View style={styles.serviceIcon}>
        <Ionicons name={SERVICE_ICON[s.kind]} size={20} color={colors.green700} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.serviceTitle}>{s.title}</Text>
        <Text style={styles.meta} numberOfLines={2}>
          {[`${s.minutes} min`, s.details].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {right ?? <Text style={styles.servicePrice}>{euroCents(s.priceCents)}</Text>}
    </Pressable>
  );
}

export function Kicker({ children, color = colors.ink500 }: { children: string; color?: string }) {
  return <Text style={[styles.kicker, { color }]}>{children}</Text>;
}

export const proStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink900,
  },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  primary: { minHeight: 52, borderRadius: radii.md, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  secondary: { minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  secondaryText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },
  terms: { flexDirection: "row", gap: 10, backgroundColor: "#fbf3dc", borderRadius: radii.md, padding: 12, alignItems: "flex-start" },
  termsText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: "#5a4512" },
});

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.green100, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.4, color: colors.green800 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, overflow: "hidden" },
  cardPhoto: { width: "100%", height: 86 },
  cardBody: { flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingBottom: 12, alignItems: "flex-start" },
  cardAvatar: { marginTop: -26, borderWidth: 3, borderColor: colors.surface, borderRadius: 30 },
  cardName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900, flexShrink: 1 },
  cardOffer: { fontFamily: fonts.body, fontSize: 13, color: colors.ink900 },
  cardPrice: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.cream100 },
  serviceIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  serviceTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  servicePrice: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8 },
});
