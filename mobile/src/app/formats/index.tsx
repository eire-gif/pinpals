import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { TILE } from "@/components/format-art";
import { FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import { ScreenHeader } from "@/components/screen-header";
import {
  FORMAT_CATEGORIES,
  GAME_FORMATS,
  categoryOf,
  formatsIn,
  popularFormats,
  searchFormats,
  type FormatCategory,
  type GameFormat,
} from "@/lib/game-formats";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Game formats (Menu → Play → Game formats, Oct 2026): every way to play,
 * explained. The content is lib/game-formats.ts, byte-identical with the
 * website's /formats. Works offline — it's all on the phone.
 *
 * Laid out as the approved mock-up: search, category chips, the most played
 * formats as a carousel, then every format in a bordered card per category.
 */

const FEATURE_TONES = [colors.navy900, colors.green700, colors.navy800];

type Filter = "all" | FormatCategory;

function FormatRow({ format, onPress, first }: { format: GameFormat; onPress: () => void; first: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowLine, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${format.name}. ${format.blurb} Players: ${format.players}.`}
    >
      <View style={[styles.tile, { backgroundColor: TILE[format.category] }]}>
        <Text style={styles.tileText}>{format.code}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName}>{format.name}</Text>
        <Text style={styles.rowBlurb}>{format.blurb}</Text>
      </View>
      <Text style={styles.players} numberOfLines={1}>
        {format.players}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.gold500} />
    </Pressable>
  );
}

export default function GameFormatsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searching = query.trim().length > 0;
  const hits = useMemo(() => searchFormats(query), [query]);
  const popular = useMemo(() => popularFormats(), []);

  const open = (f: GameFormat) => router.push(`/formats/${f.id}`);
  const groups = FORMAT_CATEGORIES.filter((c) => filter === "all" || c.id === filter);

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScreenHeader scene="parkland" title="Game formats" subtitle={`Every way to play · ${GAME_FORMATS.length} formats`} />
      <ScrollView contentContainerStyle={styles.body} {...FORM_SCROLL_KEYBOARD}>
        <View style={[styles.box, searching && styles.boxOn]}>
          <Ionicons name="search" size={20} color={searching ? colors.navy900 : colors.ink500} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search — e.g. greensomes, skins"
            placeholderTextColor={colors.ink500}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search game formats"
          />
        </View>

        {searching ? (
          <>
            <Text style={styles.eyebrow} accessibilityLiveRegion="polite">
              {hits.length === 0 ? "NO MATCHES" : `${hits.length} ${hits.length === 1 ? "FORMAT" : "FORMATS"} FOR “${query.trim().toUpperCase()}”`}
            </Text>
            {hits.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="golf-outline" size={22} color={colors.ink500} />
                <Text style={styles.emptyText}>{`Nothing matched “${query.trim()}”. Try a simpler word — pairs, team, points — or a format's other name.`}</Text>
              </View>
            ) : (
              <View style={styles.group}>
                {hits.map((f, i) => (
                  <FormatRow key={f.id} format={f} first={i === 0} onPress={() => open(f)} />
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {([{ id: "all", label: "All" }, ...FORMAT_CATEGORIES] as { id: Filter; label: string }[]).map((c) => {
                const on = filter === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setFilter(c.id)}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {filter === "all" ? (
              <>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Most played in Ireland</Text>
                  <Text style={styles.sectionAside}>Society favourites</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel} style={styles.carouselOuter}>
                  {popular.map((f, i) => (
                    <Pressable
                      key={f.id}
                      onPress={() => open(f)}
                      style={({ pressed }) => [styles.feature, { backgroundColor: FEATURE_TONES[i % FEATURE_TONES.length] }, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`${f.name}. ${f.blurb}`}
                    >
                      <View style={styles.featureInner}>
                        <Text style={styles.featureKicker} numberOfLines={1}>
                          {`${categoryOf(f.category).label} · ${f.scoring}`.toUpperCase()}
                        </Text>
                        <Text style={styles.featureName} numberOfLines={2}>
                          {f.name}
                        </Text>
                        <Text style={styles.featureBlurb} numberOfLines={2}>
                          {f.blurb}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {groups.map((c) => {
              const items = formatsIn(c.id);
              return (
                <View key={c.id} style={styles.group}>
                  <View style={styles.groupHead}>
                    <View style={styles.groupHeadInner}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.groupKicker}>{c.kicker}</Text>
                        <Text style={styles.groupTitle} accessibilityRole="header">
                          {c.title}
                        </Text>
                      </View>
                      <View style={styles.count}>
                        <Text style={styles.countText}>{items.length}</Text>
                      </View>
                    </View>
                  </View>
                  {items.map((f, i) => (
                    <FormatRow key={f.id} format={f} first={i === 0} onPress={() => open(f)} />
                  ))}
                </View>
              );
            })}
          </>
        )}

        <Text style={styles.foot}>
          Handicap allowances follow the World Handicap System recommendations used by Golf Ireland. Your club, society or competition may set its own — the entry sheet wins.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  pressed: { opacity: 0.75 },

  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  boxOn: { borderColor: colors.navy900 },
  input: { flex: 1, paddingVertical: 14, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.green700, marginTop: 4 },

  chips: { gap: 8, paddingRight: spacing.md },
  chip: { minHeight: 38, paddingHorizontal: 15, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.gold500 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.navy900 },
  chipTextOn: { color: colors.gold400 },

  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.navy900 },
  sectionAside: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green700 },
  carouselOuter: { marginHorizontal: -spacing.md },
  carousel: { gap: 12, paddingHorizontal: spacing.md, paddingBottom: 8 },
  feature: {
    width: 220,
    borderRadius: 22,
    padding: 5,
    shadowColor: colors.navy900,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  featureInner: { borderWidth: 1, borderColor: "rgba(232,196,107,0.7)", borderRadius: 17, padding: 14, gap: 8, height: 150 },
  featureKicker: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.8, color: colors.gold400 },
  featureName: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: colors.cream50 },
  featureBlurb: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.cream100, marginTop: "auto" },

  group: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    overflow: "hidden",
  },
  groupHead: { backgroundColor: colors.navy900, padding: 5 },
  groupHeadInner: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "rgba(211,165,63,0.55)", borderRadius: 17, paddingHorizontal: 14, paddingVertical: 12 },
  groupKicker: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 2, color: colors.gold500 },
  groupTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.cream50 },
  count: { minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  countText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400 },

  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 62 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  tile: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  tileText: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.5, color: colors.gold400 },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.navy900 },
  rowBlurb: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17, color: colors.ink500 },
  players: { maxWidth: 92, fontFamily: fonts.bodyBold, fontSize: 11, color: colors.green700, backgroundColor: colors.green100, borderRadius: radii.pill, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },

  empty: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 16, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  emptyText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.ink500 },

  foot: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.ink500, textAlign: "center", paddingHorizontal: 8 },
});
