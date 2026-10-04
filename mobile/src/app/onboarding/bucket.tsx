import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { useAuth } from "@/lib/auth";
import { type Club } from "@/lib/courses";
import { FEATURED_CLUB_IDS, clubsById, loadMyCourses, setCourse } from "@/lib/onboarding";
import { OnboardingFrame } from "@/components/onboarding-frame";
import { colors, fonts } from "@/lib/theme";

/** Card colours, cycled — the directory has no photographs of its own yet. */
const TONES = [colors.navy800, colors.green800, colors.navy900, colors.green600, colors.navy800, colors.green700];

/**
 * Step 4 — Your bucket list.
 *
 * Courses they'd love to play. It earns its place twice: it is a reason to
 * open the app ("a member is offering a tee time at Old Head"), and it is a
 * way to be introduced to the people who play there. Courses already marked
 * as played are left out of the suggestions — "played it, would go back" is
 * still allowed through search.
 */
export default function BucketStep() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [clubs, setClubs] = useState<Club[]>([]);
  const [bucket, setBucket] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const [mine, featured] = await Promise.all([loadMyCourses(userId), clubsById(FEATURED_CLUB_IDS)]);
      const chosen = await clubsById([...mine.bucket].filter((id) => !FEATURED_CLUB_IDS.includes(id as never)));
      setClubs([...chosen, ...featured.filter((c) => !mine.played.has(c.id) || mine.bucket.has(c.id))]);
      setBucket(mine.bucket);
      setLoading(false);
    })();
  }, [userId]);

  const toggle = async (club: Club) => {
    if (!userId) return;
    const on = !bucket.has(club.id);
    setBucket((s) => {
      const n = new Set(s);
      if (on) n.add(club.id);
      else n.delete(club.id);
      return n;
    });
    setError(null);
    try {
      await setCourse(userId, club.id, "bucket", on);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };

  const add = (club: Club) => {
    setClubs((list) => [club, ...list.filter((c) => c.id !== club.id)]);
    if (!bucket.has(club.id)) void toggle(club);
  };

  return (
    <OnboardingFrame
      step={4}
      title="Your bucket list"
      sub="Courses you'd love to play. We'll tell you when a member offers a tee time at one."
      onBack={() => router.back()}
      onSkip={() => router.push("/onboarding/pinpals")}
      onContinue={() => router.push("/onboarding/pinpals")}
      error={error}
    >
      <CourseSearch placeholder="Search for a course" onPick={add} />
      {loading ? <ActivityIndicator color={colors.green700} style={styles.spinner} /> : null}

      <View style={styles.grid}>
        {clubs.map((club, i) => {
          const on = bucket.has(club.id);
          return (
            <Pressable
              key={club.id}
              onPress={() => void toggle(club)}
              style={[styles.card, { backgroundColor: TONES[i % TONES.length] }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${club.name} on my bucket list`}
            >
              <View style={styles.heart}>
                <Ionicons name={on ? "heart" : "heart-outline"} size={20} color={colors.red600} />
              </View>
              <Text style={styles.name} numberOfLines={3}>{club.name}</Text>
              {club.rating_count ? (
                <Text style={styles.meta}>
                  <Text style={{ color: colors.gold400 }}>★</Text> {Number(club.rating_avg).toFixed(1)} · {club.rating_count}{" "}
                  {club.rating_count === 1 ? "rating" : "ratings"}
                </Text>
              ) : (
                <Text style={styles.meta}>Not rated yet</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  spinner: { marginTop: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  card: {
    width: "48%",
    flexGrow: 1,
    minHeight: 140,
    borderRadius: 14,
    padding: 12,
    justifyContent: "flex-end",
  },
  heart: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(247,243,234,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50, marginRight: 34 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100, marginTop: 4 },
});
