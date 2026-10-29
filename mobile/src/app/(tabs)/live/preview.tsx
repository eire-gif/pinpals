import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { NearbyCourses } from "@/components/live-course-section";
import { TONES } from "@/components/live-scoring-card";
import { useAuth } from "@/lib/auth";
import { placeLabel, type Club } from "@/lib/courses";
import { myHomeClub } from "@/lib/onboarding";
import { loadClub } from "@/lib/outings";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Course Preview (Oct 2026): pick a course to look round before playing it.
 *
 * Picking one opens the hole map straight on the 1st hole's satellite photo
 * in preview mode (hole-map.tsx, `preview=1`): the course summary and every
 * hole a tap away, and "Start your round here" into round set-up with the
 * course and tees already filled in.
 */
function openCoursePreview(club: Pick<Club, "id">) {
  router.push({ pathname: "/hole-map", params: { clubId: String(club.id), hole: "1", preview: "1" } });
}

export default function CoursePreviewPicker() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [home, setHome] = useState<Club | null>(null);
  const focused = useIsFocused();

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let live = true;
      void myHomeClub(userId)
        .then((h) => (h.clubId != null ? loadClub(h.clubId) : null))
        .then((c) => live && setHome(c))
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, [userId])
  );

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {focused ? <StatusBar style="light" /> : null}
      <Text style={styles.lead}>
        Pick a course and it opens on the 1st hole&apos;s satellite map. Swipe through every hole, check the course summary, then start your round
        there.
      </Text>

      {home ? (
        <>
          <SectionHead title="Your home club" />
          <Pressable
            onPress={() => openCoursePreview(home)}
            style={({ pressed }) => [styles.homeCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Preview ${home.name}, your home club. Opens on hole 1.`}
          >
            <View style={styles.homeDisc}>
              <Ionicons name="map" size={24} color={colors.gold400} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.homeKicker}>Opens on hole 1</Text>
              <Text style={styles.homeName} numberOfLines={2}>
                {home.name}
              </Text>
              <Text style={styles.homePlace} numberOfLines={1}>
                {placeLabel(home)}
              </Text>
            </View>
            <View style={styles.homeGo}>
              <Ionicons name="chevron-forward" size={20} color={colors.navy900} />
            </View>
          </Pressable>
        </>
      ) : null}

      <SectionHead title="Find a course" />
      <CourseSearch placeholder="Search for a course" onPick={openCoursePreview} />

      <SectionHead title="Near you" />
      <NearbyCourses onPick={openCoursePreview} />
    </ScrollView>
  );
}

function SectionHead({ title }: { title: string }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionRule} />
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink900, marginBottom: spacing.xs },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: spacing.md, marginBottom: 2 },
  sectionRule: { width: 24, height: 3, borderRadius: 2, backgroundColor: colors.gold500 },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", color: colors.ink900 },
  homeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg + 4,
    backgroundColor: TONES.teal.card,
    borderWidth: 2,
    borderColor: colors.gold500,
    shadowColor: "#9c7a2c",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  homeDisc: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2.5,
    borderColor: colors.gold400,
    backgroundColor: TONES.teal.disc,
    alignItems: "center",
    justifyContent: "center",
  },
  homeKicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: colors.gold400 },
  homeName: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: colors.cream50, marginTop: 2 },
  homePlace: { fontFamily: fonts.body, fontSize: 14, color: "rgba(247,243,234,0.8)", marginTop: 2 },
  homeGo: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.85 },
});
