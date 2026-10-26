import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import { calcRow, teesFor, type CalcRow } from "@/lib/handicap-calculator";
import { loadCourseCards } from "@/lib/live-rounds";
import { indexLabel, teamHandicapLabel } from "@/lib/live-scoring";
import { loadMyProfile } from "@/lib/profile";
import { loadMyRatingsCategory } from "@/lib/ratings-category";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * "Your handicap here" on a course page (Oct 2026): the member's course
 * handicap off each tee at a glance — men's or women's as they've said,
 * 18 holes — and a way into the full handicap calculator for that course.
 * Shown whenever the member is signed in; without saved tees or an index it
 * still opens the calculator, where the figures can be typed in.
 */
export function CourseHandicapCard({ clubId }: { clubId: number }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [index, setIndex] = useState<number | null>(null);
  const [rows, setRows] = useState<CalcRow[] | null>(null);
  const [women, setWomen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void (async () => {
      const [me, category, cards] = await Promise.all([
        loadMyProfile(userId).catch(() => null),
        loadMyRatingsCategory(userId),
        loadCourseCards(clubId).catch(() => []),
      ]);
      if (!live) return;
      const who = category === "women" ? "women" : "men";
      setWomen(who === "women");
      setIndex(me?.handicap ?? null);
      setRows(me?.handicap != null ? teesFor(cards, who, 18).slice(0, 4).map((t) => calcRow(me.handicap!, t, 1)) : []);
    })();
    return () => {
      live = false;
    };
  }, [userId, clubId]);

  if (!userId || rows == null) return null;

  const sub =
    index == null
      ? "Add your index to your profile, or work it out here"
      : rows.length > 0
        ? `Index ${indexLabel(index)} · every tee, 9 and 18 holes`
        : `Index ${indexLabel(index)} · enter the tees off the card`;

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/handicap", params: { clubId: String(clubId) } })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Your handicap here. ${rows.map((r) => `${r.name} ${teamHandicapLabel(r.course.courseHandicap)}`).join(", ")}. Open the handicap calculator`}
    >
      <View style={styles.top}>
        <View style={styles.icon}>
          <Ionicons name="calculator-outline" size={20} color={colors.gold400} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Your handicap here</Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      </View>
      {rows.length > 0 ? (
        <>
          <View style={styles.grid}>
            {rows.map((r) => (
              <View key={r.name} style={styles.tile}>
                <Text style={styles.tee} numberOfLines={1}>
                  {r.name.replace(/\s*\(women\)\s*$/i, "").toUpperCase()}
                </Text>
                <Text style={styles.number}>{teamHandicapLabel(r.course.courseHandicap)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.foot}>Course handicaps off the {women ? "women's" : "men's"} tees · tap for 9 holes and plays-off</Text>
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 14, padding: 14, borderRadius: radii.lg, borderWidth: 2, borderColor: colors.gold500, backgroundColor: colors.surface, gap: 12 },
  pressed: { backgroundColor: colors.surfaceTint },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.navy800, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  grid: { flexDirection: "row", gap: 6 },
  tile: { flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceTint },
  tee: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  number: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  foot: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
});
