import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { TONES } from "@/components/guide-bits";
import { AUDIENCES, GUIDES, GUIDE_CHANGES, GUIDE_JOURNEY, SECTIONS, resolveGuide, type Audience, type ResolvedGuide } from "@/lib/guide";
import { useGuideAudience } from "@/lib/guide-audience";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * How-to guides (Menu → Help). The content lives in lib/guide.ts; this
 * screen lays it out:
 *
 *   1. Who do you play with? Friends, a golf trip or a society — remembered,
 *      and the group guides are written for that (a crew of friends never
 *      sees captains, secretaries or join requests).
 *   2. The journey for that choice, then the group guides.
 *   3. Everything else, by part of the app: playing, messages and friends,
 *      the marketplace, Social.
 *   4. What changed in the guides lately.
 */

const open = (id: string, a: Audience) => router.push({ pathname: "/guide/[id]", params: { id, for: a } });

function changeDate(on: string): string {
  const d = new Date(`${on}T12:00:00`);
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

function GuideCard({ g, a }: { g: ResolvedGuide; a: Audience }) {
  const tone = TONES[g.tone];
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => open(g.id, a)} accessibilityRole="button" accessibilityLabel={`${g.title}. ${g.blurb} ${g.steps.length} steps.`}>
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
}

export default function GuidesScreen() {
  const { audience, ready, choose } = useGuideAudience();
  // Until they choose, the group guides read as for a society — the fullest
  // version — and the picker says so.
  const a: Audience = audience ?? "society";
  const picked = AUDIENCES.find((x) => x.id === a)!;
  const resolved = GUIDES.map((g) => resolveGuide(g, a)).filter((g): g is ResolvedGuide => g !== null);

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScreenHeader scene="parkland" title="How-to guides" subtitle="Step by step, with pictures" />
      <ScrollView contentContainerStyle={styles.body}>
        {/* Who do you play with? */}
        <View style={styles.pickerWrap}>
          <Text style={styles.pickerTitle}>Who do you play with?</Text>
          <Text style={styles.pickerHint}>
            {ready && !audience ? "Pick one and the group guides are written for you." : "The group guides below are written for this. Change it any time."}
          </Text>
          <View style={styles.picker} accessibilityRole="radiogroup">
            {AUDIENCES.map((x) => {
              const on = audience === x.id;
              return (
                <Pressable
                  key={x.id}
                  style={[styles.choice, on && styles.choiceOn]}
                  onPress={() => choose(x.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${x.label}. ${x.blurb}`}
                >
                  <View style={[styles.choiceIcon, on && styles.choiceIconOn]}>
                    <Ionicons name={x.icon} size={22} color={on ? colors.cream50 : colors.navy900} />
                  </View>
                  <Text style={[styles.choiceLabel, on && styles.choiceLabelOn]}>{x.label}</Text>
                  <Text style={[styles.choiceBlurb, on && styles.choiceBlurbOn]} numberOfLines={3}>
                    {x.blurb}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* The journey, for that choice */}
        <View style={styles.journey}>
          <Text style={styles.kicker}>{`YOUR ${picked.group.toUpperCase()}, START TO FINISH`}</Text>
          <View style={styles.track}>
            <View style={styles.trackLine} />
            {GUIDE_JOURNEY[a].map((j, i) => (
              <Pressable key={j.guide} style={styles.stop} onPress={() => open(j.guide, a)} accessibilityRole="button" accessibilityLabel={`Step ${i + 1}: ${j.label}. Open the guide.`}>
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

        {SECTIONS.map((section) => {
          const list = resolved.filter((g) => g.section === section.id);
          if (list.length === 0) return null;
          return (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.id === "groups" ? `Your ${picked.group}` : section.title}</Text>
              {list.map((g) => (
                <GuideCard key={g.id} g={g} a={a} />
              ))}
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>What&apos;s new in the guides</Text>
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
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.gold400, textAlign: "center" },

  pickerWrap: { gap: 6 },
  pickerTitle: { fontFamily: fonts.display, fontSize: type.title, color: colors.navy900 },
  pickerHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  picker: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  choice: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 6, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  choiceOn: { borderWidth: 2, borderColor: colors.green700, backgroundColor: colors.green700 },
  choiceIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream100 },
  choiceIconOn: { backgroundColor: colors.green800 },
  choiceLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  choiceLabelOn: { color: colors.cream50 },
  choiceBlurb: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.ink500, textAlign: "center" },
  choiceBlurbOn: { color: colors.cream100 },

  journey: { padding: spacing.md, paddingBottom: spacing.md + 2, borderRadius: radii.lg, backgroundColor: colors.navy900, gap: spacing.md },
  track: { flexDirection: "row", justifyContent: "space-between" },
  trackLine: { position: "absolute", left: "16%", right: "16%", top: 27, height: 2, backgroundColor: colors.gold500 },
  stop: { flex: 1, alignItems: "center", gap: 8 },
  stopDot: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700, borderWidth: 2, borderColor: colors.gold400 },
  stopNum: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold400 },
  stopNumText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.navy900 },
  stopLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream50, textAlign: "center" },

  section: { gap: spacing.sm + 2 },
  sectionTitle: { fontFamily: fonts.display, fontSize: type.heading + 2, color: colors.navy900 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
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
  foot: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
});
