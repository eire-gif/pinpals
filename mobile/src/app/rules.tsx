import { useMemo, useState } from "react";
import { LayoutAnimation, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import { ScreenHeader } from "@/components/screen-header";
import { RA_RULES_HUB, RULES, RULES_EDITION, SUGGESTED_SEARCHES, officialUrl, searchRules, type RuleEntry } from "@/lib/rules-of-golf";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Rules of Golf lookup (Menu → Courses, news & rules).
 *
 * The content is in lib/rules-of-golf.ts — our own summaries, byte-identical
 * with the website's /rules page — and every entry opens the R&A's official
 * page for that Rule. Works offline: the search runs on the phone, which is
 * the point on a course with one bar of signal. Only the official link needs
 * the network.
 *
 * Laid out like a rule book (Oct 2026): the common situations as a grid
 * up top, a penalties-at-a-glance card, then the 25 Rules in the R&A's own
 * parts, each a row that opens in place. A search shows its matches open.
 * The grouping lives here, not in the data file, so that file stays
 * byte-identical with the website's.
 */

/** The parts of the Rules, as the rule book arranges them. */
const PARTS: { numeral: string; title: string; from: number; to: number }[] = [
  { numeral: "I", title: "Fundamentals of the game", from: 1, to: 4 },
  { numeral: "II", title: "Playing the round and a hole", from: 5, to: 6 },
  { numeral: "III", title: "Playing the ball", from: 7, to: 11 },
  { numeral: "IV", title: "Bunkers and putting greens", from: 12, to: 13 },
  { numeral: "V", title: "Lifting and returning a ball to play", from: 14, to: 14 },
  { numeral: "VI", title: "Free relief", from: 15, to: 16 },
  { numeral: "VII", title: "Penalty relief", from: 17, to: 19 },
  { numeral: "VIII", title: "When issues arise", from: 20, to: 20 },
  { numeral: "IX", title: "Other forms of play", from: 21, to: 24 },
  { numeral: "X", title: "Players with disabilities", from: 25, to: 25 },
];

/** The quick searches, with a label and icon each. */
const SITUATIONS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  "lost ball": { label: "Lost ball", icon: "search-outline" },
  "out of bounds": { label: "Out of bounds", icon: "close-circle-outline" },
  water: { label: "Water / penalty area", icon: "water-outline" },
  unplayable: { label: "Unplayable", icon: "ban-outline" },
  bunker: { label: "Bunker", icon: "layers-outline" },
  "free drop": { label: "Free relief", icon: "hand-left-outline" },
  embedded: { label: "Embedded ball", icon: "arrow-down-circle-outline" },
  provisional: { label: "Provisional", icon: "repeat-outline" },
  flagstick: { label: "Flagstick", icon: "flag-outline" },
  "how to drop": { label: "How to drop", icon: "download-outline" },
};

/** Penalties at a glance — the five that come up most, in our words. */
const PENALTIES: { what: string; cost: string; tone: "free" | "one" | "two" }[] = [
  { what: "Free relief — cart path, GUR, animal hole, embedded", cost: "No penalty", tone: "free" },
  { what: "Lost or out of bounds — stroke and distance", cost: "1 stroke", tone: "one" },
  { what: "Penalty area or unplayable ball relief", cost: "1 stroke", tone: "one" },
  { what: "The general penalty — most breaches", cost: "2 strokes · loss of hole", tone: "two" },
];

function animate() {
  LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
}

function OfficialLink({ entry }: { entry: RuleEntry }) {
  const label = entry.rule === 0 ? "Official Definitions" : `Official wording of Rule ${entry.rule}`;
  return (
    <Pressable
      style={({ pressed }) => [styles.official, pressed && styles.pressed]}
      onPress={() => void Linking.openURL(officialUrl(entry))}
      accessibilityRole="link"
      accessibilityLabel={`${label}, on the R&A website`}
    >
      <Text style={styles.officialText}>{label}</Text>
      <Text style={styles.officialSource}>randa.org</Text>
      <Ionicons name="open-outline" size={15} color={colors.green700} />
    </Pressable>
  );
}

/** What a Rule says: the summary, its key points, the official link. */
function RuleBody({ entry }: { entry: RuleEntry }) {
  return (
    <View style={styles.ruleBody}>
      <Text style={styles.summary}>{entry.summary}</Text>
      {entry.points && entry.points.length > 0 ? (
        <View style={styles.points}>
          <Text style={styles.pointsLabel}>KEY POINTS</Text>
          {entry.points.map((p) => (
            <View key={p} style={styles.point}>
              <View style={styles.dot} />
              <Text style={styles.pointText}>{p}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <OfficialLink entry={entry} />
    </View>
  );
}

/** The navy plate with the Rule's number (or "18.3", or "Def."). */
function Plate({ entry, small }: { entry: RuleEntry; small?: boolean }) {
  const label = entry.rule === 0 ? "Def." : entry.kind === "rule" ? String(entry.rule) : entry.ref.replace(/^Rule\s+/, "");
  const long = label.length > 3;
  return (
    <View style={[styles.plate, small && styles.plateSmall]}>
      <Text style={[styles.plateText, long && styles.plateTextLong]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </View>
  );
}

/** One Rule in the book: a row that opens in place. */
function RuleRow({ entry, open, onToggle, last }: { entry: RuleEntry; open: boolean; onToggle: () => void; last: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.rowHead, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${entry.ref}, ${entry.title}`}
      >
        <Plate entry={entry} />
        <Text style={[styles.rowTitle, open && styles.rowTitleOpen]}>{entry.title}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={open ? colors.navy900 : colors.ink500} />
      </Pressable>
      {open ? <RuleBody entry={entry} /> : null}
    </View>
  );
}

/** A search match: shown open, with where it sits in the Rules. */
function MatchCard({ entry }: { entry: RuleEntry }) {
  return (
    <View style={styles.match}>
      <View style={styles.matchHead}>
        <Plate entry={entry} small />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.matchRef}>
            {entry.kind === "topic" && entry.rule > 0 ? `${entry.ref.toUpperCase()} · IN RULE ${entry.rule}` : entry.ref.toUpperCase()}
          </Text>
          <Text style={styles.matchTitle}>{entry.title}</Text>
        </View>
      </View>
      <RuleBody entry={entry} />
    </View>
  );
}

export default function RulesScreen() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const hits = useMemo(() => searchRules(query), [query]);
  const searching = query.trim().length > 0;

  const book = useMemo(() => {
    const rules = RULES.filter((e) => e.kind === "rule" && e.rule > 0);
    return PARTS.map((part) => ({ part, rules: rules.filter((r) => r.rule >= part.from && r.rule <= part.to).sort((a, b) => a.rule - b.rule) }));
  }, []);
  const definitions = RULES.find((e) => e.id === "definitions") ?? null;

  const toggle = (id: string) => {
    animate();
    setOpen((cur) => (cur === id ? null : id));
  };
  const pick = (s: string) => {
    animate();
    setQuery((q) => (q === s ? "" : s));
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScreenHeader scene="linksDusk" title="Rules of Golf" subtitle="Find a rule fast, in plain English" />
      <ScrollView contentContainerStyle={styles.body} {...FORM_SCROLL_KEYBOARD}>
        <View style={[styles.box, searching && styles.boxOn]}>
          <Ionicons name="search" size={20} color={searching ? colors.navy900 : colors.ink500} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a situation or a Rule number"
            placeholderTextColor={colors.ink500}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search the Rules of Golf"
          />
        </View>

        {searching ? (
          <>
            <View style={styles.resultsBar}>
              <Text style={styles.eyebrow} accessibilityLiveRegion="polite">
                {hits.length === 0 ? "NO MATCHES" : `${hits.length} ${hits.length === 1 ? "MATCH" : "MATCHES"} FOR “${query.trim().toUpperCase()}”`}
              </Text>
              <Pressable onPress={() => pick(query)} hitSlop={10} accessibilityRole="button">
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            </View>
            {hits.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="book-outline" size={22} color={colors.ink500} />
                <Text style={styles.emptyText}>{`Nothing matched “${query.trim()}”. Try a simpler word — water, drop, green — or a Rule number like 18.`}</Text>
              </View>
            ) : (
              hits.map(({ entry }) => <MatchCard key={entry.id} entry={entry} />)
            )}
          </>
        ) : (
          <>
            <Text style={styles.eyebrow}>COMMON SITUATIONS</Text>
            <View style={styles.grid}>
              {SUGGESTED_SEARCHES.map((s) => {
                const info = SITUATIONS[s] ?? { label: s, icon: "help-circle-outline" as const };
                return (
                  <Pressable key={s} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]} onPress={() => pick(s)} accessibilityRole="button" accessibilityLabel={`Look up ${info.label}`}>
                    <View style={styles.tileIcon}>
                      <Ionicons name={info.icon} size={17} color={colors.gold400} />
                    </View>
                    <Text style={styles.tileText} numberOfLines={2}>
                      {info.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.penalties}>
              <Text style={styles.penaltiesTitle}>Penalties at a glance</Text>
              {PENALTIES.map((p, i) => (
                <View key={p.what} style={[styles.penaltyRow, i > 0 && styles.penaltyLine]}>
                  <Text style={styles.penaltyWhat}>{p.what}</Text>
                  <Text style={[styles.penaltyCost, p.tone === "free" ? styles.costFree : p.tone === "two" ? styles.costTwo : styles.costOne]}>{p.cost}</Text>
                </View>
              ))}
              <Text style={styles.penaltiesFoot}>Stroke play · match play. A few breaches are disqualification — search the situation for the detail.</Text>
            </View>

            <Text style={styles.eyebrow}>THE RULES OF GOLF · ALL 25</Text>
            {book.map(({ part, rules }) => (
              <View key={part.numeral} style={styles.part}>
                <View style={styles.partHead}>
                  <Text style={styles.partNumeral}>{part.numeral}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partTitle}>{part.title}</Text>
                    <Text style={styles.partRange}>{part.from === part.to ? `Rule ${part.from}` : `Rules ${part.from}–${part.to}`}</Text>
                  </View>
                </View>
                {rules.map((r, i) => (
                  <RuleRow key={r.id} entry={r} open={open === r.id} onToggle={() => toggle(r.id)} last={i === rules.length - 1} />
                ))}
              </View>
            ))}
            {definitions ? (
              <View style={styles.part}>
                <RuleRow entry={definitions} open={open === definitions.id} onToggle={() => toggle(definitions.id)} last />
              </View>
            ) : null}
          </>
        )}

        <View style={styles.note}>
          <View style={styles.noteHead}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.gold400} />
            <Text style={styles.noteTitle}>About these summaries</Text>
          </View>
          <Text style={styles.noteText}>
            The Rules of Golf are written by The R&amp;A and the USGA, and their wording is the only official version. These summaries are PinPals' own, to help you find the right Rule quickly — where they differ, the official text wins. Your club or competition may also have Local Rules.
          </Text>
          <Text style={styles.noteEdition}>{`${RULES_EDITION.name} · in force until ${RULES_EDITION.nextEdition}`}</Text>
          <Pressable style={({ pressed }) => [styles.noteLink, pressed && styles.pressed]} onPress={() => void Linking.openURL(RA_RULES_HUB)} accessibilityRole="link">
            <Text style={styles.noteLinkText}>The R&amp;A Rules hub and official app</Text>
            <Ionicons name="open-outline" size={15} color={colors.gold400} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  pressed: { opacity: 0.7 },

  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    shadowColor: colors.navy900,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  boxOn: { borderColor: colors.navy900 },
  input: { flex: 1, paddingVertical: 14, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },

  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.green700, marginTop: 4 },
  resultsBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  clear: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },

  // Common situations
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  tilePressed: { backgroundColor: colors.surfaceTint, borderColor: colors.navy900 },
  tileIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  tileText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13.5, lineHeight: 17, color: colors.ink900 },

  // Penalties at a glance
  penalties: { padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900, gap: 2 },
  penaltiesTitle: { fontFamily: fonts.display, fontSize: type.heading, color: colors.cream50, marginBottom: 6 },
  penaltyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 9 },
  penaltyLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(247,243,234,0.18)" },
  penaltyWhat: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.cream100 },
  penaltyCost: { fontFamily: fonts.bodyBold, fontSize: 12, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radii.pill, overflow: "hidden", textAlign: "center", maxWidth: 130 },
  costFree: { color: colors.green800, backgroundColor: colors.green100 },
  costOne: { color: colors.navy900, backgroundColor: colors.gold400 },
  costTwo: { color: colors.cream50, backgroundColor: colors.red600 },
  penaltiesFoot: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: "rgba(247,243,234,0.7)", marginTop: 6 },

  // The rule book
  part: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  partHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.surfaceTint, borderBottomWidth: 1, borderBottomColor: colors.line },
  partNumeral: { width: 34, fontFamily: fonts.display, fontSize: 18, color: colors.gold500, textAlign: "center" },
  partTitle: { fontFamily: fonts.display, fontSize: 16.5, lineHeight: 21, color: colors.navy900 },
  partRange: { fontFamily: fonts.bodySemi, fontSize: 11.5, letterSpacing: 0.4, color: colors.ink500, marginTop: 1 },

  row: {},
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  rowTitle: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 20, color: colors.ink900 },
  rowTitleOpen: { fontFamily: fonts.bodyBold, color: colors.navy900 },

  plate: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  plateSmall: { width: 42, height: 42 },
  plateText: { fontFamily: fonts.display, fontSize: 16, color: colors.gold400 },
  plateTextLong: { fontFamily: fonts.bodyBold, fontSize: 11 },

  ruleBody: { gap: 10, paddingHorizontal: 14, paddingBottom: 14, paddingLeft: 14 + 34 + 12 },
  summary: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 22, color: colors.ink900 },
  points: { gap: 6, padding: 12, borderRadius: radii.md, backgroundColor: colors.surfaceTint, borderLeftWidth: 3, borderLeftColor: colors.gold500 },
  pointsLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.1, color: colors.ink500 },
  point: { flexDirection: "row", gap: 8, paddingRight: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: colors.gold500 },
  pointText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink900 },
  official: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 },
  officialText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  officialSource: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },

  // Search matches
  match: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  matchHead: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, paddingBottom: 10 },
  matchRef: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1, color: colors.ink500 },
  matchTitle: { fontFamily: fonts.display, fontSize: type.heading, lineHeight: 23, color: colors.navy900 },

  empty: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 16, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  emptyText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.ink500 },

  // About
  note: { marginTop: spacing.sm, padding: 16, gap: 8, borderRadius: radii.lg, backgroundColor: colors.navy800 },
  noteHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  noteTitle: { fontFamily: fonts.display, fontSize: type.heading - 1, color: colors.cream50 },
  noteText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: colors.cream100 },
  noteEdition: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 0.3, color: colors.gold400 },
  noteLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingTop: 4 },
  noteLinkText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.gold400 },
});
