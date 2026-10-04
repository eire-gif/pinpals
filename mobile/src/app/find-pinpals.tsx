import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { InviteBanner, SuggestionRow } from "@/components/pinpals";
import { suggestedPinPals, type Suggestion } from "@/lib/onboarding";
import { colors, fonts, radii, spacing } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";

const RADIUS_KM = 25;

const FILTERS = [
  { key: "all", label: "Suggested" },
  { key: "club", label: "My club" },
  { key: "near", label: "Nearby clubs" },
  { key: "courses", label: "Same courses" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

/**
 * Find PinPals — the screen behind Home's gold button.
 *
 * Everything here comes from one call to suggested_pinpals(), which already
 * leaves out anyone blocked or already connected and ranks the rest. The
 * chips and the search box only filter that list in memory: it is at most a
 * hundred people, and filtering locally means no request per keystroke and
 * nothing to fail on a bad signal.
 *
 * Search here is "among your suggestions". Looking up any member by name is
 * the directory's job, and the link at the bottom goes there.
 */
export default function FindPinPalsScreen() {
  const router = useRouter();
  const [people, setPeople] = useState<Suggestion[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void suggestedPinPals(100, RADIUS_KM).then(setPeople);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter((p) => {
      if (filter === "club" && !p.same_club) return false;
      if (filter === "near" && (p.same_club || p.distance_km === null || p.distance_km > RADIUS_KM)) return false;
      if (filter === "courses" && p.shared_courses === 0) return false;
      if (!q) return true;
      return `${p.first_name} ${p.last_name} ${p.home_club ?? ""}`.toLowerCase().includes(q);
    });
  }, [people, filter, query]);

  const club = shown.filter((p) => p.same_club);
  const others = shown.filter((p) => !p.same_club);

  return (
    <>
      <Stack.Screen options={{ title: "Find PinPals", headerBackTitle: "Back" }} />
      <ScrollView keyboardDismissMode={KEYBOARD_DISMISS_MODE} style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.ink500} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or club"
            placeholderTextColor={colors.ink500}
            style={styles.searchInput}
            autoCorrect={false}
            accessibilityLabel="Search by name or club"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.chip, filter === f.key && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f.key }}
            >
              <Text style={[styles.chipLabel, filter === f.key && styles.chipLabelOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {people === null ? <ActivityIndicator color={colors.green700} style={styles.spinner} /> : null}

        {club.length > 0 ? (
          <Section title="At your club" note={club[0]?.home_club ?? undefined} people={club} />
        ) : null}
        {others.length > 0 ? (
          <Section
            title={filter === "courses" ? "Courses in common" : "Clubs near you"}
            note={filter === "courses" ? undefined : `Within ${RADIUS_KM} km, and golfers who share your courses`}
            people={others}
          />
        ) : null}

        {people !== null && shown.length === 0 ? (
          <Text style={styles.empty}>
            {people.length === 0
              ? "Nobody near your club has joined yet. Set your home club and the courses you've played, and invite the golfers you know."
              : "No one matches that."}
          </Text>
        ) : null}

        <View style={styles.invite}>
          <InviteBanner title="Friend not on PinPals yet?" body="Send them a link — it's free to join." />
        </View>

        <Pressable onPress={() => router.push("/members")} style={styles.directory} accessibilityRole="button">
          <Text style={styles.directoryLabel}>Search every member</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.green700} />
        </Pressable>
      </ScrollView>
    </>
  );
}

function Section({ title, note, people }: { title: string; note?: string; people: Suggestion[] }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {note ? <Text style={styles.sectionNote} numberOfLines={1}>{note}</Text> : null}
      </View>
      <View style={styles.card}>
        {people.map((p, i) => (
          <SuggestionRow key={p.id} person={p} last={i === people.length - 1} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink900, paddingVertical: 11 },
  chips: { gap: 8, paddingVertical: 12 },
  chip: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },
  spinner: { marginTop: spacing.lg },
  section: { marginTop: 8 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#4c5667",
  },
  sectionNote: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  empty: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: "#3d4757", marginVertical: 12 },
  invite: { marginTop: 4 },
  directory: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, marginTop: 8 },
  directoryLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700 },
});
