import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { TONES } from "@/components/guide-bits";
import { GUIDES, GUIDE_CHANGES, GUIDE_JOURNEY } from "@/lib/guide";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * How-to guides (Menu → Help). The content lives in lib/guide.ts; this
 * screen only lays it out: the journey at the top (group → event → round),
 * a card per guide, and what changed most recently.
 */

const open = (id: string) => router.push({ pathname: "/guide/[id]", params: { id } });

function changeDate(on: string): string {
  const d = new Date(`${on}T12:00:00`);
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

export default function GuidesScreen() {
  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScreenHeader scene="parkland" title="How-to guides" subtitle="Step by step, with pictures" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>From starting a society to a certified scorecard — each guide shows the exact buttons to tap, one step at a time.</Text>

        {/* The journey: three stops, joined by a line. */}
        <View style={styles.journey} accessibilityRole="summary">
          <Text style={styles.kicker}>HOW IT FITS TOGETHER</Text>
          <View style={styles.track}>
            <View style={styles.trackLine} />
            {GUIDE_JOURNEY.map((j, i) => (
              <Pressable key={j.guide} style={styles.stop} onPress={() => open(j.guide)} accessibilityRole="button" accessibilityLabel={`Step ${i + 1}: ${j.label}. Open the guide.`}>
                <View style={styles.stopDot}>
                  <Ionicons name={j.icon} size={24} color={colors.cream50} />
                  <View style={styles.stopNum}>
                    <Text style={styles.stopNumText}>{i + 1}</Text>
                  </View>
                </View>
                <Text style={styles.stopLabel}>{j.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.section}>Guides</Text>
        {GUIDES.map((g) => {
          const tone = TONES[g.tone];
          return (
            <Pressable key={g.id} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => open(g.id)} accessibilityRole="button" accessibilityLabel={`${g.title}. ${g.blurb} ${g.steps.length} steps.`}>
              <View style={[styles.cardIcon, { backgroundColor: tone.bg }]}>
                <Ionicons name={g.icon} size={26} color={tone.ink} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{g.title}</Text>
                <Text style={styles.cardBlurb}>{g.blurb}</Text>
                <View style={styles.cardMeta}>
                  <View style={[styles.badge, { backgroundColor: tone.soft }]}>
                    <Text style={styles.badgeText}>{g.audience}</Text>
                  </View>
                  <Text style={styles.steps}>{`${g.steps.length} steps`}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.ink500} />
            </Pressable>
          );
        })}

        <Text style={styles.section}>What&apos;s new in the guides</Text>
        <View style={styles.changes}>
          {GUIDE_CHANGES.slice(0, 5).map((c, i) => (
            <View key={`${c.on}-${i}`} style={styles.change}>
              <Text style={styles.changeDate}>{changeDate(c.on)}</Text>
              <Text style={styles.changeText}>{c.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.foot}>Stuck on something that isn&apos;t here? Menu → Contact us.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm + 4, paddingBottom: spacing.xl * 2 },
  intro: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 23, color: colors.ink900 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.gold400, textAlign: "center" },

  journey: { padding: spacing.md, paddingBottom: spacing.md + 2, borderRadius: radii.lg, backgroundColor: colors.navy900, gap: spacing.md },
  track: { flexDirection: "row", justifyContent: "space-between" },
  trackLine: { position: "absolute", left: "16%", right: "16%", top: 27, height: 2, backgroundColor: colors.gold500 },
  stop: { flex: 1, alignItems: "center", gap: 8 },
  stopDot: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700, borderWidth: 2, borderColor: colors.gold400 },
  stopNum: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold400 },
  stopNumText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.navy900 },
  stopLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream50, textAlign: "center" },

  section: { fontFamily: fonts.display, fontSize: type.heading + 2, color: colors.navy900, marginTop: spacing.sm },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  cardIcon: { width: 52, height: 52, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body + 1, color: colors.ink900 },
  cardBlurb: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill },
  badgeText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.navy900 },
  steps: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },

  changes: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 14 },
  change: { paddingVertical: 12, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  changeDate: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green700 },
  changeText: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink900 },
  foot: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", marginTop: spacing.sm },
});
