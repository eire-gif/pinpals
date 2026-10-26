import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldFrame } from "@/components/format-art";
import { TONES } from "@/components/live-scoring-card";
import { TintedHeader } from "@/components/tinted-header";
import { StateMessage } from "@/components/state-message";
import { LieArtTile } from "@/components/train-art";
import { Card, LevelPill, bits } from "@/components/train-bits";
import { RULES } from "@/lib/rules-of-golf";
import { forHand, lieById, type Hand, type LieCategory } from "@/lib/training";
import { useTraining } from "@/lib/training-store";
import { colors, fonts, radii } from "@/lib/theme";
import { useContentWidth } from "@/lib/content-width";

/**
 * One lie, explained (Training → What's your lie? → a lie). Laid out as the
 * approved uphill-lie mock-up: picture, club / aim / ball, the four keys,
 * the usual mistake, a drill and the rule that applies. Right- or
 * left-handed is remembered on the phone and flips every direction.
 */

const CATEGORY: Record<LieCategory, string> = { slopes: "SLOPES", sand: "SAND", rough: "ROUGH & TROUBLE", weather: "WIND" };

function HandSwitch({ hand, onChange }: { hand: Hand; onChange: (h: Hand) => void }) {
  return (
    <View style={styles.switch} accessibilityRole="radiogroup" accessibilityLabel="Which way you play">
      {(["right", "left"] as Hand[]).map((h) => {
        const on = hand === h;
        return (
          <Pressable key={h} onPress={() => onChange(h)} style={[styles.switchBtn, on && styles.switchOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[styles.switchText, on && styles.switchTextOn]}>{h === "right" ? "Right-handed" : "Left-handed"}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function LieScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { hand, setHand } = useTraining();
  const { width } = useContentWidth();
  const lie = lieById(String(id ?? ""));

  if (!lie) {
    return (
      <View style={bits.fill}>
        <Stack.Screen options={{ headerTitle: "Training", headerBackTitle: "Back" }} />
        <StateMessage size="screen" icon="golf-outline" title="Guide not found" body="It may have been renamed. Every lie is listed under What's your lie?" />
      </View>
    );
  }

  const h = (s: string) => forHand(s, hand);
  const rule = lie.rule ? RULES.find((r) => r.id === lie.rule!.id) : undefined;
  const artSize = Math.min(width - 32 - 40, 360);

  return (
    <View style={bits.fill}>
      <TintedHeader color={TONES.green.card} title={lie.name} subtitle="Shot Coach" />
      <ScrollView contentContainerStyle={bits.body}>
        <HandSwitch hand={hand} onChange={(x) => void setHand(x)} />

        <GoldFrame tone="navy">
          <View style={styles.heroTop}>
            <Text style={styles.kicker}>{CATEGORY[lie.category]}</Text>
            <LevelPill level={lie.level} />
          </View>
          <Text style={styles.name} accessibilityRole="header">
            {lie.name}
          </Text>
          <Text style={styles.intro}>{h(lie.intro)}</Text>
          <View style={{ alignItems: "center" }}>
            <LieArtTile art={lie.art} size={artSize} />
          </View>
          <View style={styles.stats}>
            {[
              ["CLUB", lie.club],
              ["AIM", h(lie.aim)],
              ["BALL", lie.ball],
            ].map(([k, v]) => (
              <View key={k} style={styles.stat}>
                <Text style={styles.statLabel}>{k}</Text>
                <Text style={styles.statValue}>{v.charAt(0).toUpperCase() + v.slice(1)}</Text>
              </View>
            ))}
          </View>
        </GoldFrame>

        <Card>
          <Text style={bits.h2}>The 4 keys</Text>
          {lie.keys.map((k, i) => (
            <View key={k.title} style={styles.key}>
              <View style={styles.num}>
                <Text style={styles.numText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.keyTitle}>{h(k.title)}</Text>
                <Text style={bits.text}>{h(k.body)}</Text>
              </View>
            </View>
          ))}
        </Card>

        <View style={styles.mistake}>
          <Ionicons name="alert-circle-outline" size={22} color={colors.red600} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.mistakeTitle}>Common mistake</Text>
            <Text style={styles.mistakeText}>{h(lie.mistake)}</Text>
          </View>
        </View>

        <Card style={styles.drill}>
          <Text style={bits.kicker}>{`PRACTISE THIS · ${lie.drill.minutes} MIN`}</Text>
          <Text style={styles.drillName}>{lie.drill.name}</Text>
          <Text style={bits.text}>{h(lie.drill.how)}</Text>
        </Card>

        {rule && lie.rule ? (
          <Pressable onPress={() => router.push("/rules")} style={({ pressed }) => [styles.rule, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityHint="Opens the Rules of Golf">
            <Ionicons name="reader-outline" size={20} color={colors.gold500} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.ruleRef}>{`Rules check · ${rule.ref}`}</Text>
              <Text style={bits.muted}>{lie.rule.note}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.gold500} />
          </Pressable>
        ) : null}

        <Text style={bits.foot}>Standard teaching for this lie. Your club professional can tailor it to your swing.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: "row", alignSelf: "center", backgroundColor: colors.cream100, borderRadius: radii.pill, padding: 3 },
  switchBtn: { paddingHorizontal: 16, minHeight: 38, borderRadius: radii.pill, justifyContent: "center" },
  switchOn: { backgroundColor: colors.navy900 },
  switchText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },
  switchTextOn: { color: colors.gold400 },

  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold400 },
  name: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.cream50, marginTop: -6 },
  intro: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.cream100 },
  stats: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "rgba(211,165,63,0.35)", paddingTop: 10, gap: 8 },
  stat: { flex: 1, gap: 3 },
  statLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.6, color: colors.gold500 },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 14.5, lineHeight: 19, color: colors.cream50 },

  key: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  numText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
  keyTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },

  mistake: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: colors.red100, borderWidth: 1, borderColor: "#e2b3aa", borderRadius: 22, padding: 16 },
  mistakeTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.red600 },
  mistakeText: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: "#5c2219" },

  drill: { borderColor: colors.gold500, borderWidth: 1.5, backgroundColor: colors.surfaceTint },
  drillName: { fontFamily: fonts.display, fontSize: 20, color: colors.navy900, marginTop: -4 },

  rule: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  ruleRef: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.navy900 },
});
