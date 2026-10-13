import { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import { ScreenHeader } from "@/components/screen-header";
import { RA_RULES_HUB, RULES_EDITION, SUGGESTED_SEARCHES, officialUrl, searchRules, type RuleEntry } from "@/lib/rules-of-golf";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Rules of Golf lookup (Menu → Courses, news & rules).
 *
 * The content is in lib/rules-of-golf.ts — our own summaries, byte-identical
 * with the website's /rules page — and every card opens the R&A's official
 * page for that Rule. Works offline: the search runs on the phone, which is
 * the point on a course with one bar of signal. Only the official link needs
 * the network.
 */

function RuleCard({ entry }: { entry: RuleEntry }) {
  const link = entry.rule === 0 ? "Read the official Definitions" : `Read the official Rule ${entry.rule}`;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.ref}>
          <Text style={styles.refText}>{entry.ref}</Text>
        </View>
        {entry.kind === "topic" && entry.rule > 0 ? <Text style={styles.inRule}>{`in Rule ${entry.rule}`}</Text> : null}
      </View>
      <Text style={styles.cardTitle}>{entry.title}</Text>
      <Text style={styles.summary}>{entry.summary}</Text>
      {entry.points?.map((p) => (
        <View key={p} style={styles.point}>
          <View style={styles.dot} />
          <Text style={styles.pointText}>{p}</Text>
        </View>
      ))}
      <Pressable
        style={({ pressed }) => [styles.official, pressed && styles.pressed]}
        onPress={() => void Linking.openURL(officialUrl(entry))}
        accessibilityRole="link"
        accessibilityLabel={`${link} on the R&A website`}
      >
        <Text style={styles.officialText}>{link}</Text>
        <Ionicons name="open-outline" size={16} color={colors.green700} />
      </Pressable>
    </View>
  );
}

export default function RulesScreen() {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchRules(query), [query]);
  const searching = query.trim().length > 0;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScreenHeader scene="linksDusk" title="Rules of Golf" subtitle="Find a rule fast, in plain English" />
      <ScrollView contentContainerStyle={styles.body} {...FORM_SCROLL_KEYBOARD}>
        <View style={styles.box}>
          <Ionicons name="search" size={20} color={colors.ink500} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Lost ball, water, cart path, 18…"
            placeholderTextColor={colors.ink500}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search the Rules of Golf"
          />
        </View>

        <View style={styles.chips}>
          {SUGGESTED_SEARCHES.map((s) => {
            const on = query === s;
            return (
              <Pressable key={s} style={[styles.chip, on && styles.chipOn]} onPress={() => setQuery(on ? "" : s)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.count} accessibilityLiveRegion="polite">
          {searching ? (hits.length === 0 ? "NO MATCHES" : `${hits.length} ${hits.length === 1 ? "MATCH" : "MATCHES"}`) : "ALL 25 RULES"}
        </Text>

        {searching && hits.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{`Nothing matched “${query.trim()}”. Try a simpler word — water, drop, green — or a rule number like 18.`}</Text>
          </View>
        ) : (
          hits.map(({ entry }) => <RuleCard key={entry.id} entry={entry} />)
        )}

        <View style={styles.note}>
          <Text style={styles.noteTitle}>About these summaries</Text>
          <Text style={styles.noteText}>
            {`The Rules of Golf are written by The R&A and the USGA, and their wording is the only official version. These summaries are PinPals' own, to help you find the right Rule quickly — where they differ, the official text wins. Your club or competition may also have Local Rules. Edition: ${RULES_EDITION.name}, in force until ${RULES_EDITION.nextEdition}.`}
          </Text>
          <Pressable style={({ pressed }) => [styles.official, pressed && styles.pressed]} onPress={() => void Linking.openURL(RA_RULES_HUB)} accessibilityRole="link">
            <Text style={styles.officialText}>The R&amp;A Rules hub and official app</Text>
            <Ionicons name="open-outline" size={16} color={colors.green700} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },

  box: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, paddingVertical: 14, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.green700, backgroundColor: colors.green700 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },

  count: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.green700, marginTop: 4 },

  card: { padding: 16, gap: 8, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  ref: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.navy900 },
  refText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.gold400 },
  inRule: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },
  cardTitle: { fontFamily: fonts.display, fontSize: type.heading + 1, lineHeight: 25, color: colors.navy900 },
  summary: { fontFamily: fonts.body, fontSize: type.small + 1, lineHeight: 22, color: colors.ink500 },
  point: { flexDirection: "row", gap: 8, paddingRight: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: colors.gold500 },
  pointText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.ink900 },
  official: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 6, alignSelf: "flex-start" },
  officialText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  pressed: { opacity: 0.7 },

  empty: { padding: 16, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  emptyText: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.ink500 },

  note: { marginTop: spacing.sm, padding: 16, gap: 8, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceTint },
  noteTitle: { fontFamily: fonts.display, fontSize: type.heading, color: colors.navy900 },
  noteText: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.ink500 },
});
