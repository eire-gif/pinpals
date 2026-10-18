import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { FormatArt, GoldFrame, TILE } from "@/components/format-art";
import { ScreenHeader, type Scene } from "@/components/screen-header";
import { StateMessage } from "@/components/state-message";
import { categoryOf, formatById, relatedFormats, type FormatCategory } from "@/lib/game-formats";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * One game format, explained (Menu → Play → Game formats → a format).
 * Content from lib/game-formats.ts; the pictures from components/format-art.
 * Laid out as the approved Stableford / Foursomes / Scramble mock-ups, and
 * every other format follows the same page.
 */

const SCENE: Record<FormatCategory, Scene> = {
  individual: "ballybunion",
  matchplay: "oldHead",
  pairs: "parkland",
  team: "coastAerial",
  side: "dunesGold",
};

const HERO_TONE: Record<FormatCategory, "navy" | "green" | "navy800"> = {
  individual: "navy",
  matchplay: "navy800",
  pairs: "green",
  team: "navy800",
  side: "navy",
};

function Stat({ label, value, top }: { label: string; value: string; top?: boolean }) {
  return (
    <View style={[styles.stat, top && styles.statTop]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export default function FormatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const format = formatById(String(id ?? ""));

  if (!format) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ headerTitle: "Game formats", headerBackTitle: "Back" }} />
        <StateMessage size="screen" icon="golf-outline" title="Format not found" body="It may have been renamed. Every format is listed under Game formats." />
      </View>
    );
  }

  const category = categoryOf(format.category);
  const related = relatedFormats(format);

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Formats" }} />
      <ScreenHeader scene={SCENE[format.category]} title={category.title.split(" — ")[0]} subtitle="Game formats" />
      <ScrollView contentContainerStyle={styles.body}>
        <GoldFrame tone={HERO_TONE[format.category]}>
          <Text style={styles.kicker}>{`${category.label} · ${format.scoring}`.toUpperCase()}</Text>
          <Text style={styles.name} accessibilityRole="header">
            {format.name}
          </Text>
          {format.aka && format.aka.length > 0 ? <Text style={styles.aka}>{`Also called ${format.aka.join(", ")}`}</Text> : null}
          <Text style={styles.intro}>{format.intro}</Text>
          <View style={styles.stats}>
            <Stat label="PLAYERS" value={format.players} />
            <Stat label="SCORING" value={format.scoring} />
            <Stat label="ALLOWANCE" value={format.allowance} top />
            <Stat label="WINNER" value={format.winner} top />
          </View>
        </GoldFrame>

        <View style={styles.card}>
          <Text style={styles.h2}>How it works</Text>
          {format.steps.map((s, i) => (
            <View key={s} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}
        </View>

        {format.visual ? <FormatArt visual={format.visual} /> : null}

        {format.example && format.visual !== "scramble" ? (
          <View style={[styles.card, styles.dashed]}>
            <Text style={styles.label}>WORKED EXAMPLE</Text>
            <Text style={styles.bodyText}>{format.example}</Text>
          </View>
        ) : null}

        {format.ties ? (
          <View style={styles.card}>
            <Text style={styles.h3}>Ties</Text>
            <Text style={styles.muted}>{format.ties}</Text>
          </View>
        ) : null}

        {format.tips && format.tips.length > 0 ? (
          <View style={styles.tip}>
            <Ionicons name="bulb-outline" size={22} color={colors.green700} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.tipTitle}>Good to know</Text>
              {format.tips.map((t) => (
                <Text key={t} style={styles.tipText}>
                  {t}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {related.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.h3}>Close relations</Text>
            {related.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/formats/${r.id}`)}
                style={({ pressed }) => [styles.related, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}. ${r.blurb}`}
              >
                <View style={[styles.tile, { backgroundColor: TILE[r.category] }]}>
                  <Text style={styles.tileText}>{r.code}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.relatedName}>{r.name}</Text>
                  <Text style={styles.relatedBlurb}>{r.blurb}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.gold500} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {format.live ? (
          <Pressable
            onPress={() => router.push("/live")}
            style={({ pressed }) => [styles.gold, pressed && styles.goldPressed]}
            accessibilityRole="button"
            accessibilityHint="Opens live scoring, where you choose the format"
          >
            <Ionicons name="podium-outline" size={18} color={colors.navy900} />
            <Text style={styles.goldText}>Play it with live scoring</Text>
          </Pressable>
        ) : null}

        <Text style={styles.foot}>Allowances follow the World Handicap System recommendations used by Golf Ireland. Your club or society may set its own.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: 18, paddingBottom: spacing.xl * 2 },
  pressed: { opacity: 0.75 },

  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold400 },
  name: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.cream50, marginTop: -6 },
  aka: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.gold400, marginTop: -8 },
  intro: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.cream100 },
  stats: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderTopColor: "rgba(211,165,63,0.35)", paddingTop: 4 },
  stat: { width: "50%", paddingVertical: 8, paddingRight: 8, gap: 3 },
  statTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(211,165,63,0.3)" },
  statLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.6, color: colors.gold500 },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 15.5, lineHeight: 20, color: colors.cream50 },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 22, padding: 18, gap: 14 },
  dashed: { backgroundColor: colors.surfaceTint, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.gold500, gap: 8 },
  h2: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  h3: { fontFamily: fonts.display, fontSize: 19, color: colors.navy900, marginBottom: -4 },
  label: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold500 },
  bodyText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink900 },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink500 },

  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNum: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontFamily: fonts.display, fontSize: 15, color: colors.gold500 },
  stepText: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink900, paddingTop: 3 },

  tip: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: colors.green100, borderWidth: 1, borderColor: colors.green600, borderRadius: 22, padding: 16 },
  tipTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green800 },
  tipText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.green800 },

  related: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, minHeight: 56, borderWidth: 1, borderColor: colors.line, borderRadius: 14 },
  tile: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  tileText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.gold400 },
  relatedName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  relatedBlurb: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.ink500 },

  gold: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 54,
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

  foot: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.ink500, textAlign: "center", paddingHorizontal: 8 },
});
