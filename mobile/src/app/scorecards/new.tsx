import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { KEYBOARD_DISMISS_MODE, KeyboardDoneButton } from "@/components/keyboard";
import { StateMessage } from "@/components/state-message";
import { placeLabel, type Club } from "@/lib/courses";
import { isOn } from "@/lib/features";
import { recentDays } from "@/lib/feed-rules";
import { courseHandicap, indexLabel, parseIndex, playingHandicap } from "@/lib/live-scoring";
import { blankScorecard, headline, scorecardTotals, shotsOnCard, vsParText, type ScorecardHole } from "@/lib/scorecard-math";
import {
  VISIBILITY_LABELS,
  loadScorecard,
  loadTeeCards,
  saveScorecard,
  type TeeCard,
  type Visibility,
} from "@/lib/scorecards";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Make a scorecard by hand, or edit one (?id=<scorecard>).
 *
 * Pick a course and its tees and the card fills itself — par, stroke index
 * and yards from the course's saved card (imported or member-entered). With
 * no card on file, choose 9 or 18 and set each hole's par. Then the date,
 * your handicap index if you want points, and the scores.
 *
 * The playing handicap is worked out here (WHS, 95% for individual stroke
 * play) and stored with the card, so the points never change if the index
 * does later.
 */

/** WHS allowance for individual stroke play and Stableford. */
const ALLOWANCE = 0.95;

export default function ScorecardEditor() {
  const params = useLocalSearchParams<{ id?: string; club?: string }>();
  const editId = params.id ? Number(params.id) : null;

  const [loading, setLoading] = useState(editId != null);
  const [club, setClub] = useState<Club | null>(null);
  const [courseName, setCourseName] = useState("");
  const [typedCourse, setTypedCourse] = useState(false);
  const [tees, setTees] = useState<TeeCard[] | null>(null);
  const [tee, setTee] = useState<TeeCard | null>(null);
  const [teeName, setTeeName] = useState("");
  const [holes, setHoles] = useState<ScorecardHole[]>([]);
  const [playedOn, setPlayedOn] = useState(recentDays(1)[0].iso);
  const [indexText, setIndexText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("pinpals");
  const [putts, setPutts] = useState(false);
  const [saving, setSaving] = useState(false);

  const days = useMemo(() => recentDays(30), []);

  // Editing: fill everything from the card, once.
  useEffect(() => {
    if (editId == null) return;
    void loadScorecard(editId)
      .then((s) => {
        if (!s) return;
        setCourseName(s.courseName);
        setTypedCourse(s.clubId == null);
        if (s.clubId != null) setClub({ id: s.clubId, name: s.courseName } as Club);
        setTeeName(s.teeName ?? "");
        setTee(
          s.teeName
            ? { teeName: s.teeName, holes: s.holes, parTotal: s.parTotal, courseRating: s.courseRating, slope: s.slope, verified: false, holeList: [] }
            : null
        );
        setHoles(s.holeList);
        setPlayedOn(s.playedOn);
        setIndexText(s.handicapIndex != null ? indexLabel(s.handicapIndex) : "");
        setVisibility(s.visibility);
        setPutts(s.holeList.some((h) => h.putts != null));
      })
      .finally(() => setLoading(false));
  }, [editId]);

  const pickClub = useCallback((c: Club) => {
    setClub(c);
    setCourseName(c.name);
    setTee(null);
    setHoles([]);
    setTees(null);
    void loadTeeCards(c.id)
      .then(setTees)
      .catch(() => setTees([]));
  }, []);

  const chooseTee = (t: TeeCard) => {
    setTee(t);
    setTeeName(t.teeName);
    // Keep any scores already typed when switching tees on the same holes.
    setHoles((prev) => t.holeList.map((h) => ({ ...h, strokes: prev.find((p) => p.hole === h.hole)?.strokes ?? null, putts: prev.find((p) => p.hole === h.hole)?.putts ?? null })));
  };

  const index = indexText.trim() ? parseIndex(indexText) : null;
  const parTotal = holes.reduce((n, h) => n + h.par, 0);
  const ch = index != null ? courseHandicap(index, { slope: tee?.slope ?? null, courseRating: tee?.courseRating ?? null, par: parTotal || null }) : null;
  const playing = ch ? playingHandicap(ch.courseHandicap, ALLOWANCE) : null;
  const totals = scorecardTotals(holes, playing);
  const shots = shotsOnCard(holes, playing);

  const setHole = (hole: number, patch: Partial<ScorecardHole>) =>
    setHoles((hs) => hs.map((h) => (h.hole === hole ? { ...h, ...patch } : h)));

  const canSave = courseName.trim().length > 0 && holes.length > 0 && (indexText.trim() === "" || index != null);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const id = await saveScorecard(
        editId,
        {
          clubId: typedCourse ? null : club?.id ?? null,
          courseName: courseName.trim(),
          teeName: teeName.trim() || null,
          holes: holes.length === 9 ? 9 : 18,
          playedOn,
          parTotal: parTotal || null,
          courseRating: tee?.courseRating ?? null,
          slope: tee?.slope ?? null,
          handicapIndex: index,
          playingHandicap: playing,
          visibility,
        },
        putts ? holes : holes.map((h) => ({ ...h, putts: null }))
      );
      if (editId != null) router.back();
      else router.replace({ pathname: "/scorecards/[id]", params: { id: String(id) } });
    } catch (e) {
      const msg = (e as { message?: unknown } | null)?.message;
      Alert.alert("That card didn't save", typeof msg === "string" && msg ? msg : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOn("scorecards")) return <StateMessage size="screen" icon="document-text-outline" title="Scorecards are on their way" />;
  if (loading) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;

  const step2 = club != null || typedCourse;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream50 }}>
      <Stack.Screen options={{ title: editId != null ? "Edit scorecard" : "New scorecard" }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode={KEYBOARD_DISMISS_MODE}>
        {/* 1. Course */}
        <Section title="Course">
          {club || typedCourse ? (
            <View style={styles.picked}>
              <View style={{ flex: 1 }}>
                {typedCourse ? (
                  <TextInput
                    value={courseName}
                    onChangeText={setCourseName}
                    placeholder="Course name"
                    placeholderTextColor={colors.ink500}
                    style={styles.input}
                    maxLength={120}
                  />
                ) : (
                  <>
                    <Text style={styles.pickedName}>{courseName}</Text>
                    {club && placeLabel(club) ? <Text style={styles.muted}>{placeLabel(club)}</Text> : null}
                  </>
                )}
              </View>
              {editId == null ? (
                <Pressable
                  onPress={() => {
                    setClub(null);
                    setTypedCourse(false);
                    setCourseName("");
                    setTees(null);
                    setTee(null);
                    setHoles([]);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.link}>Change</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              <CourseSearch placeholder="Search for the course" onPick={pickClub} />
              <Pressable onPress={() => setTypedCourse(true)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>It's not listed — type it in</Text>
              </Pressable>
            </>
          )}
        </Section>

        {/* 2. Tees, or a card typed in */}
        {step2 && holes.length === 0 ? (
          <Section title="Tees">
            {club && tees === null && !typedCourse ? <ActivityIndicator color={colors.green700} /> : null}
            {tees && tees.length > 0 ? (
              <View style={styles.chips}>
                {tees.map((t) => (
                  <Chip key={`${t.teeName}-${t.holes}`} label={`${t.teeName}${t.holes === 9 ? " (9)" : ""}`} on={tee?.teeName === t.teeName} onPress={() => chooseTee(t)} />
                ))}
              </View>
            ) : null}
            <Text style={styles.muted}>
              {tees && tees.length > 0 ? "No card for your tees? Enter the pars yourself:" : "No card on file for this course yet. Enter the pars yourself:"}
            </Text>
            <View style={styles.chips}>
              <Chip label="18 holes" on={false} onPress={() => setHoles(blankScorecard(18))} />
              <Chip label="9 holes" on={false} onPress={() => setHoles(blankScorecard(9))} />
            </View>
          </Section>
        ) : null}

        {holes.length > 0 ? (
          <>
            {/* 3. Date, tees name, handicap */}
            <Section title="When and off what">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {days.map((d) => (
                  <Chip key={d.iso} label={d.label} on={playedOn === d.iso} onPress={() => setPlayedOn(d.iso)} />
                ))}
                {!days.some((d) => d.iso === playedOn) ? <Chip label={playedOn} on onPress={() => {}} /> : null}
              </ScrollView>
              {!tee || !tees?.some((t) => t.teeName === tee.teeName) ? (
                <TextInput
                  value={teeName}
                  onChangeText={setTeeName}
                  placeholder="Tees (e.g. White) — optional"
                  placeholderTextColor={colors.ink500}
                  style={styles.input}
                  maxLength={40}
                />
              ) : null}
              <View style={styles.indexRow}>
                <TextInput
                  value={indexText}
                  onChangeText={setIndexText}
                  placeholder="Handicap index (optional)"
                  placeholderTextColor={colors.ink500}
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, { flex: 1 }]}
                  maxLength={5}
                />
                {playing != null ? (
                  <Text style={styles.playsOff}>
                    Plays off {playing}
                    {ch?.estimated ? "*" : ""}
                  </Text>
                ) : null}
              </View>
              {indexText.trim() && index == null ? <Text style={styles.error}>That isn't a handicap index (e.g. 14.2, or +1.5).</Text> : null}
              {ch?.estimated ? <Text style={styles.muted}>* No course rating on file, so your index is used as is.</Text> : null}
            </Section>

            {/* 4. Scores */}
            <Section title="Scores">
              <View style={styles.summary}>
                <Text style={styles.summaryText}>{headline(totals)}</Text>
                <View style={styles.puttsToggle}>
                  <Text style={styles.muted}>Putts</Text>
                  <Switch value={putts} onValueChange={setPutts} trackColor={{ true: colors.green600 }} />
                </View>
              </View>
              {holes.map((h) => (
                <HoleRow
                  key={h.hole}
                  hole={h}
                  shots={shots.get(h.hole) ?? 0}
                  editPar={!tee || tee.holeList.length === 0}
                  showPutts={putts}
                  onChange={(patch) => setHole(h.hole, patch)}
                />
              ))}
              <View style={styles.totalsRow}>
                <Text style={styles.totalsText}>
                  Out {totals.out.strokes ?? "–"}
                  {totals.in ? ` · In ${totals.in.strokes ?? "–"}` : ""} · Par {totals.total.par} · {vsParText(totals.vsPar)}
                </Text>
              </View>
            </Section>

            {/* 5. Who sees it */}
            <Section title="Who can see this card">
              <View style={styles.chips}>
                {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                  <Chip key={v} label={VISIBILITY_LABELS[v]} on={visibility === v} onPress={() => setVisibility(v)} />
                ))}
              </View>
            </Section>

            <Pressable
              onPress={() => void save()}
              disabled={!canSave || saving}
              style={({ pressed }) => [styles.saveButton, (!canSave || saving) && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.saveLabel}>{editId != null ? "Save changes" : "Save scorecard"}</Text>}
            </Pressable>
          </>
        ) : null}
      </ScrollView>
      <KeyboardDoneButton />
    </View>
  );
}

function HoleRow({
  hole,
  shots,
  editPar,
  showPutts,
  onChange,
}: {
  hole: ScorecardHole;
  shots: number;
  editPar: boolean;
  showPutts: boolean;
  onChange: (patch: Partial<ScorecardHole>) => void;
}) {
  const s = hole.strokes;
  const diff = s == null ? null : s - hole.par;
  return (
    <View style={styles.holeRow}>
      <View style={styles.holeNo}>
        <Text style={styles.holeNoText}>{hole.hole}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {editPar ? (
          <View style={styles.parPick}>
            {[3, 4, 5].map((p) => (
              <Pressable key={p} onPress={() => onChange({ par: p })} style={[styles.parChip, hole.par === p && styles.parChipOn]} accessibilityRole="button" accessibilityLabel={`Par ${p}`}>
                <Text style={[styles.parChipText, hole.par === p && styles.parChipTextOn]}>{p}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.holeMeta}>
            Par {hole.par}
            {hole.strokeIndex != null ? ` · SI ${hole.strokeIndex}` : ""}
            {hole.yards != null ? ` · ${hole.yards} yds` : ""}
          </Text>
        )}
        {shots > 0 ? <Text style={styles.shots}>{"●".repeat(Math.min(shots, 3))} {shots === 1 ? "1 shot" : `${shots} shots`}</Text> : null}
      </View>
      {showPutts ? (
        <Stepper
          value={hole.putts}
          label="putts"
          onMinus={() => onChange({ putts: hole.putts == null ? 2 : Math.max(0, hole.putts - 1) })}
          onPlus={() => onChange({ putts: hole.putts == null ? 2 : Math.min(10, hole.putts + 1) })}
          small
        />
      ) : null}
      <Stepper
        value={s}
        label="strokes"
        tone={diff == null ? null : diff < 0 ? "under" : diff > 0 ? "over" : "par"}
        onMinus={() => onChange({ strokes: s == null ? hole.par : s <= 1 ? null : s - 1 })}
        onPlus={() => onChange({ strokes: s == null ? hole.par : Math.min(20, s + 1) })}
        onTap={() => (s == null ? onChange({ strokes: hole.par }) : undefined)}
      />
    </View>
  );
}

function Stepper({
  value,
  label,
  onMinus,
  onPlus,
  onTap,
  tone = null,
  small = false,
}: {
  value: number | null;
  label: string;
  onMinus: () => void;
  onPlus: () => void;
  onTap?: () => void;
  tone?: "under" | "par" | "over" | null;
  small?: boolean;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onMinus} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Fewer ${label}`}>
        <Ionicons name="remove" size={16} color={colors.ink900} />
      </Pressable>
      <Pressable onPress={onTap} style={[styles.stepValue, small && styles.stepValueSmall, tone === "under" && styles.under, tone === "over" && styles.over]} accessibilityLabel={`${value ?? "No"} ${label}`}>
        <Text style={[styles.stepText, small && styles.stepTextSmall, tone === "under" && styles.underText]}>{value ?? "–"}</Text>
      </Pressable>
      <Pressable onPress={onPlus} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`More ${label}`}>
        <Ionicons name="add" size={16} color={colors.ink900} />
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  section: { gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green700 },
  picked: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pickedName: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
  muted: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink500 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700, paddingVertical: 4 },
  input: { minHeight: 44, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.surfaceTint },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: 14, minHeight: 36, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, justifyContent: "center", backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },
  indexRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  playsOff: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  error: { fontFamily: fonts.body, fontSize: 13, color: colors.red600 },
  summary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summaryText: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  puttsToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  holeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  holeNo: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  holeNoText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  holeMeta: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink900 },
  shots: { fontFamily: fonts.body, fontSize: 11.5, color: colors.green700, marginTop: 1 },
  parPick: { flexDirection: "row", gap: 4 },
  parChip: { width: 32, height: 28, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  parChipOn: { backgroundColor: colors.green100, borderColor: colors.green700 },
  parChipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  parChipTextOn: { color: colors.green800 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  stepValue: { width: 40, height: 36, borderRadius: radii.sm, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  stepValueSmall: { width: 32 },
  stepText: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
  stepTextSmall: { fontSize: 16 },
  under: { backgroundColor: colors.green700 },
  underText: { color: colors.cream50 },
  over: { backgroundColor: colors.red100 },
  totalsRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  totalsText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900, textAlign: "right" },
  saveButton: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  saveLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

