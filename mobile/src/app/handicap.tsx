import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { HandicapBreakdownSheet } from "@/components/handicap-breakdown";
import { FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import { TintedHeader } from "@/components/tinted-header";
import { useAuth } from "@/lib/auth";
import { placeLabel, type Club } from "@/lib/courses";
import { calcRow, manualTee, teesFor, type CalcRow, type CalcTee } from "@/lib/handicap-calculator";
import { loadCourseCards, type CourseCard } from "@/lib/live-rounds";
import { SINGLES_ALLOWANCE_CHOICES, indexLabel, parseIndex, teamHandicapLabel } from "@/lib/live-scoring";
import { loadClub } from "@/lib/outings";
import { loadMyProfile } from "@/lib/profile";
import { loadMyRatingsCategory } from "@/lib/ratings-category";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Handicap calculator (Menu → Play → Handicap calculator, and "Your handicap
 * here" on a course page; Oct 2026). Course lookup lists every saved tee for
 * men or women, 18 holes or 9; Enter manually takes any rating, slope and
 * par off a card. Each tee shows the course handicap and what you'd play
 * off at the allowance chosen; tap one for how it's worked out.
 *
 * The figures come from lib/handicap-calculator.ts → live-scoring.ts, the
 * functions a round plays off, tied out against Golf Ireland's calculator.
 */

type Mode = "lookup" | "manual";

export default function HandicapCalculator() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const params = useLocalSearchParams<{ clubId?: string }>();

  const [mode, setMode] = useState<Mode>("lookup");
  const [indexText, setIndexText] = useState("");
  const [who, setWho] = useState<"men" | "women">("men");
  const [holes, setHoles] = useState<9 | 18>(18);
  const [allowance, setAllowance] = useState(1);
  const [club, setClub] = useState<Club | null>(null);
  const [cards, setCards] = useState<CourseCard[] | null>(null);
  const [manual, setManual] = useState({ slope: "", rating: "", par: "72" });
  const [explain, setExplain] = useState<CalcTee | null>(null);

  // Your own index, and the course you came from (else your home club).
  useEffect(() => {
    let live = true;
    const fromParam = params.clubId ? Number(params.clubId) : null;
    void (async () => {
      const [me, category] = userId
        ? await Promise.all([loadMyProfile(userId).catch(() => null), loadMyRatingsCategory(userId)])
        : [null, null];
      if (!live) return;
      if (category === "women") setWho("women");
      if (me?.handicap != null) setIndexText((t) => t || indexLabel(me.handicap!));
      const clubId = fromParam ?? me?.homeClubId ?? null;
      if (clubId) {
        const c = await loadClub(clubId).catch(() => null);
        if (live && c) setClub((cur) => cur ?? c);
      }
    })();
    return () => {
      live = false;
    };
  }, [userId, params.clubId]);

  useEffect(() => {
    if (!club) return;
    let live = true;
    setCards(null);
    loadCourseCards(club.id)
      .then((cs) => live && setCards(cs))
      .catch(() => live && setCards([]));
    return () => {
      live = false;
    };
  }, [club]);

  const index = parseIndex(indexText);
  const badIndex = indexText.trim() !== "" && index == null;
  const typed = manualTee(holes, manual);

  const rows: CalcRow[] = useMemo(() => {
    if (index == null) return [];
    if (mode === "manual") return typed.tee ? [calcRow(index, typed.tee, allowance)] : [];
    return cards ? teesFor(cards, who, holes).map((t) => calcRow(index, t, allowance)) : [];
  }, [index, mode, typed.tee, cards, who, holes, allowance]);

  const setHoleCount = (n: 9 | 18) => {
    setHoles(n);
    setManual((m) => ({ ...m, par: n === 9 && m.par === "72" ? "36" : n === 18 && m.par === "36" ? "72" : m.par }));
  };

  const pct = Math.round(allowance * 100);
  const lookupEmpty = mode === "lookup" && club != null && cards != null && index != null && rows.length === 0;

  return (
    <>
      <ScrollView style={styles.fill} contentContainerStyle={styles.page} {...FORM_SCROLL_KEYBOARD}>
        <TintedHeader color={colors.navy900} title="Handicap calculator" subtitle="Course and playing handicaps · WHS" />

        <View style={styles.body}>
          <View style={styles.segment} accessibilityRole="tablist">
            {(["lookup", "manual"] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.segmentItem, mode === m && styles.segmentOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>{m === "lookup" ? "Course lookup" : "Enter manually"}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.indexCard}>
            <Text style={styles.indexLabel}>Handicap index</Text>
            <TextInput
              value={indexText}
              onChangeText={setIndexText}
              placeholder="e.g. 15.6"
              placeholderTextColor={colors.ink500}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={[styles.indexInput, badIndex && styles.inputBad]}
              accessibilityLabel="Handicap index"
            />
          </View>
          {badIndex ? <Text style={styles.problem}>An index from +10.0 to 54.0, e.g. 15.6 or +1.5</Text> : null}

          {mode === "lookup" ? (
            club ? (
              <View style={styles.clubCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clubName}>{club.name}</Text>
                  <Text style={styles.clubMeta}>{placeLabel(club)}</Text>
                </View>
                <Pressable onPress={() => setClub(null)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <CourseSearch placeholder="Search for a course" onPick={setClub} />
            )
          ) : null}

          <View style={styles.toggles}>
            {mode === "lookup" ? (
              <Pills
                value={who}
                options={[
                  { id: "men", label: "Men" },
                  { id: "women", label: "Women" },
                ]}
                onChange={setWho}
              />
            ) : null}
            <Pills
              value={holes}
              options={[
                { id: 18, label: "18 holes" },
                { id: 9, label: "9 holes" },
              ]}
              onChange={setHoleCount}
            />
          </View>

          {mode === "manual" ? (
            <View style={styles.manual}>
              <ManualField label="Slope" value={manual.slope} placeholder={holes === 9 ? "125" : "130"} onChange={(slope) => setManual((m) => ({ ...m, slope }))} />
              <ManualField label="Course rating" value={manual.rating} placeholder={holes === 9 ? "35.6" : "71.1"} onChange={(rating) => setManual((m) => ({ ...m, rating }))} />
              <ManualField label="Par" value={manual.par} placeholder={holes === 9 ? "36" : "72"} onChange={(par) => setManual((m) => ({ ...m, par }))} last />
            </View>
          ) : null}
          {mode === "manual" && typed.problem ? <Text style={styles.problem}>{typed.problem}</Text> : null}

          <View style={{ gap: 6 }}>
            <Text style={styles.sectionLabel}>Playing handicap allowance</Text>
            <View style={styles.allowRow}>
              {SINGLES_ALLOWANCE_CHOICES.map((a) => {
                const on = Math.abs(a - allowance) < 1e-9;
                return (
                  <Pressable
                    key={a}
                    onPress={() => setAllowance(a)}
                    style={[styles.allow, on && styles.allowOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                  >
                    <Text style={[styles.allowText, on && styles.allowTextOn]}>{Math.round(a * 100)}%</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {holes === 9 && index != null ? (
            <View style={styles.nineNote}>
              <Ionicons name="information-circle-outline" size={18} color={colors.green800} />
              <Text style={styles.nineText}>9 holes: half your index, to one decimal — {indexLabel(Math.floor((Math.round(index * 10) + 1) / 2) / 10)}</Text>
            </View>
          ) : null}

          {mode === "lookup" && club && cards == null ? <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.md }} /> : null}
          {lookupEmpty ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {holes === 9
                  ? `No 9-hole ratings on file for ${club!.name} yet. Use Enter manually with the front- or back-nine rating, slope and par off the card.`
                  : `No ${who === "women" ? "women's " : ""}ratings on file for ${club!.name} yet. Use Enter manually with the figures off the card.`}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: spacing.sm }}>
            {rows.map((r) => (
              <Pressable
                key={`${r.name}-${r.holes}`}
                onPress={() => setExplain(r)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}: course handicap ${teamHandicapLabel(r.course.courseHandicap)}, plays off ${teamHandicapLabel(r.plays)} at ${pct}%. How it's worked out`}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.teeName} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={styles.teeMeta}>
                    {r.course.estimated ? "No rating or slope on file — estimated" : `CR ${r.courseRating!.toFixed(1)} · Slope ${r.slope} · Par ${r.par}`}
                  </Text>
                </View>
                <View style={styles.figure}>
                  <Text style={styles.figureLabel}>Course</Text>
                  <Text style={styles.figureNumber}>{teamHandicapLabel(r.course.courseHandicap)}</Text>
                </View>
                {pct !== 100 ? (
                  <View style={[styles.figure, styles.figurePlays]}>
                    <Text style={[styles.figureLabel, { color: colors.green800 }]}>Plays</Text>
                    <Text style={[styles.figureNumber, { color: colors.green800 }]}>{teamHandicapLabel(r.plays)}</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={16} color={colors.gold500} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.small}>
            Course handicap = index × slope ÷ 113 + (course rating − par). The allowance goes on the exact figure and is rounded once — the R&amp;A and Golf Ireland method.
            Golf Ireland lets a club or society play singles off 100, 95, 90 or 85%.
          </Text>
        </View>
      </ScrollView>

      <HandicapBreakdownSheet
        open={explain != null}
        onClose={() => setExplain(null)}
        who="Your handicap"
        index={index}
        tee={explain}
        allowance={allowance}
      />
    </>
  );
}

function Pills<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.pills}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={String(o.id)} onPress={() => onChange(o.id)} style={[styles.pill, on && styles.pillOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <Text style={[styles.pillText, on && styles.pillTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ManualField({ label, value, placeholder, onChange, last = false }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; last?: boolean }) {
  return (
    <View style={[styles.manualRow, !last && styles.manualLine]}>
      <Text style={styles.manualLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.ink500}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        style={styles.manualInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  page: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  segment: { flexDirection: "row", backgroundColor: colors.cream100, borderRadius: radii.pill, padding: 3 },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.navy900 },
  segmentText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink500 },
  segmentTextOn: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  indexCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 6 },
  indexLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  indexInput: { width: 110, minHeight: 48, textAlign: "right", fontFamily: fonts.display, fontSize: 28, color: colors.navy900 },
  inputBad: { color: colors.red600 },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  clubCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md },
  clubName: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  clubMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  toggles: { flexDirection: "row", gap: spacing.sm },
  pills: { flex: 1, flexDirection: "row", backgroundColor: colors.cream100, borderRadius: radii.pill, padding: 3 },
  pill: { flex: 1, minHeight: 42, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
  pillOn: { backgroundColor: colors.surface },
  pillText: { fontFamily: fonts.body, fontSize: 15, color: colors.ink500 },
  pillTextOn: { fontFamily: fonts.bodyBold, color: colors.ink900 },
  manual: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  manualRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, minHeight: 52 },
  manualLine: { borderBottomWidth: 1, borderBottomColor: colors.cream100 },
  manualLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  manualInput: { width: 110, minHeight: 44, textAlign: "right", fontFamily: fonts.bodySemi, fontSize: 20, color: colors.navy900 },
  sectionLabel: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", color: colors.navy900 },
  allowRow: { flexDirection: "row", gap: 6 },
  allow: { flex: 1, minHeight: 44, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  allowOn: { borderWidth: 2, borderColor: colors.navy900, backgroundColor: colors.navy900 },
  allowText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  allowTextOn: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  nineNote: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.green100, borderRadius: radii.md, padding: spacing.sm },
  nineText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.green800 },
  empty: { backgroundColor: colors.surface, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md },
  emptyText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink500 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 12 },
  teeName: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  teeMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  figure: { alignItems: "center", minWidth: 50 },
  figurePlays: { backgroundColor: colors.green100, borderRadius: radii.md, paddingHorizontal: 8, paddingVertical: 2 },
  figureLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase", color: colors.ink500 },
  figureNumber: { fontFamily: fonts.display, fontSize: 26, color: colors.navy900 },
  small: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500 },
});
