import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseTile, OnboardingFrame } from "@/components/onboarding-frame";
import { RatingLine } from "@/components/stars";
import { useAuth } from "@/lib/auth";
import {
  coursesNear,
  distanceLabel,
  memberCounts,
  placeLabel,
  searchCourses,
  type Club,
} from "@/lib/courses";
import { useCurrentLocation } from "@/lib/location";
import { clubsById, markOnboarded, patchProfile } from "@/lib/onboarding";
import { loadMyProfile } from "@/lib/profile";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * Step 1 — Where do you play?
 *
 * The home club is what puts a member on the map: it decides who appears
 * under "PinPals near you", whose tee times are close, and which club page
 * lists them. So it comes first, and it is the one step whose Skip we would
 * rather people didn't use — but it is still a Skip.
 *
 * Location is asked for here, on "Near me", and not before. iOS shows the
 * dialog once per install; asked at the moment its reason is obvious, people
 * say yes.
 */
export default function HomeClubStep() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const location = useCurrentLocation();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Club[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<Club | null>(null);
  const [mode, setMode] = useState<"idle" | "near" | "search">("idle");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  // A member who already chose a club on the website starts with it ticked.
  useEffect(() => {
    if (!userId) return;
    void loadMyProfile(userId).then(async (p) => {
      if (!p?.homeClubId) return;
      const [club] = await clubsById([p.homeClubId]);
      if (club) {
        setSelected(club);
        setResults((r) => (r.length ? r : [club]));
      }
    });
  }, [userId]);

  const show = useCallback(async (clubs: Club[], t: number) => {
    if (t !== token.current) return;
    setResults(clubs);
    setLoading(false);
    setCounts(await memberCounts(clubs.map((c) => c.id)));
  }, []);

  // Search as they type, with a request token so a slow early answer cannot
  // land after a faster later one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = ++token.current;
    setMode("search");
    setLoading(true);
    const timer = setTimeout(() => {
      void searchCourses(q, 20)
        .then((clubs) => show(clubs, t))
        .catch(() => t === token.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, show]);

  const nearMe = async () => {
    const t = ++token.current;
    setQuery("");
    setMode("near");
    setLoading(true);
    const coords = await location.request();
    if (!coords) {
      if (t === token.current) setLoading(false);
      return;
    }
    try {
      const { clubs } = await coursesNear(coords.lat, coords.lng, 40, 12);
      await show(clubs, t);
    } catch {
      if (t === token.current) setLoading(false);
    }
  };

  const next = () => router.push("/onboarding/game");

  const skipAll = async () => {
    if (userId) await markOnboarded(userId);
    router.replace("/(tabs)");
  };

  const save = async () => {
    if (!userId || !selected) return next();
    setSaving(true);
    setError(null);
    try {
      const current = await loadMyProfile(userId);
      if (current?.homeClubId !== selected.id) {
        await patchProfile(userId, {
          homeClubId: selected.id,
          country: selected.country,
          // A county belongs to a country; moving country clears it rather
          // than saving "Scotland / Kerry".
          ...(current && current.country !== selected.country ? { county: "" } : {}),
        });
      }
      next();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your club. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const status =
    location.state.status === "denied"
      ? "Location is off for PinPals — search for your club instead."
      : location.state.status === "failed"
        ? "Couldn't find where you are — search for your club instead."
        : null;

  return (
    <OnboardingFrame
      step={1}
      title="Where do you play?"
      sub="Your home club puts you on the map. Golfers nearby will find you, and you'll find them."
      onSkip={skipAll}
      onContinue={save}
      pending={saving}
      error={error}
    >
      <View style={styles.search}>
        <Ionicons name="search" size={20} color={colors.ink500} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for your club"
          placeholderTextColor={colors.ink500}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search for your club"
        />
      </View>

      <View style={styles.chips}>
        <Pressable
          onPress={nearMe}
          style={[styles.chip, mode === "near" && styles.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === "near" }}
        >
          <Ionicons name="location-outline" size={16} color={mode === "near" ? colors.cream50 : colors.ink900} />
          <Text style={[styles.chipLabel, mode === "near" && styles.chipLabelOn]}>Near me</Text>
        </Pressable>
      </View>

      {status ? <Text style={styles.note}>{status}</Text> : null}
      {loading ? <ActivityIndicator color={colors.green700} style={styles.spinner} /> : null}

      <View style={styles.list}>
        {results.map((club) => {
          const on = selected?.id === club.id;
          const members = counts[club.id];
          const where = [placeLabel(club), distanceLabel(club.distance_km)].filter(Boolean).join(" · ");
          return (
            <Pressable
              key={club.id}
              onPress={() => setSelected(on ? null : club)}
              style={[styles.row, on && styles.rowOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <CourseTile name={club.name} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={2}>{club.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>{where}</Text>
                <View style={styles.metaRow}>
                  <RatingLine avg={club.rating_avg} count={club.rating_count} />
                  {members ? <Text style={styles.meta}>{members} {members === 1 ? "member" : "members"}</Text> : null}
                </View>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <Ionicons name="checkmark" size={15} color={colors.cream50} /> : null}
              </View>
            </Pressable>
          );
        })}
        {mode === "search" && !loading && results.length === 0 ? (
          <Text style={styles.note}>No clubs match “{query.trim()}”.</Text>
        ) : null}
      </View>

      <Pressable onPress={next} style={styles.noClub} accessibilityRole="button">
        <Text style={styles.link}>I don&apos;t have a home club yet</Text>
      </Pressable>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink900, paddingVertical: 12 },
  chips: { flexDirection: "row", gap: 8, marginTop: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },
  note: { fontFamily: fonts.body, fontSize: 14, color: "#4c5667", marginTop: 12 },
  spinner: { marginTop: 16 },
  list: { gap: 8, marginTop: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowOn: { borderColor: colors.green700, backgroundColor: colors.green100 },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13.5, color: "#5b6576" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: "#9aa3b0",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  noClub: { minHeight: 44, justifyContent: "center", marginTop: 8 },
  link: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.green700 },
});
