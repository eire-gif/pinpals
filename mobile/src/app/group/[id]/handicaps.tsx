import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { RoleBadge } from "@/components/group-bits";
import { CourseSection, useCourseSetup } from "@/components/live-course-section";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { indicatorLabel } from "@/lib/handicap-indicator";
import { courseHandicap, parseIndex, playingHandicap } from "@/lib/live-scoring";
import { loadGroupPage, loadSocietyHandicaps, setSocietyHandicap, type GroupMember, type GroupPage, type SocietyHandicap } from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** WHS individual stroke play — what society days use (0121). */
const ALLOWANCE = 0.95;

/**
 * A society's handicaps (0122), for its owner, captain and secretary.
 *
 * One row per member: the handicap they set themselves, their PinPals
 * indicator (best of their last 20 scorecards), and what the society plays
 * them off — which an officer sets here, often from one of the other two.
 * Pick a course and tees at the top and each row also shows the course
 * handicap and the 95% playing handicap for that day, so the secretary can
 * read the draw straight off this screen. Society rounds pre-fill the
 * society's figure.
 */
export default function SocietyHandicapsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const course = useCourseSetup();

  const [page, setPage] = useState<GroupPage | null | undefined>(undefined);
  const [rows, setRows] = useState<Map<string, SocietyHandicap> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCourse, setShowCourse] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(groupId)) return;
    try {
      const p = await loadGroupPage(groupId, userId);
      setPage(p);
      if (p) setRows(await loadSocietyHandicaps(groupId));
      setFailed(null);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn't load the handicaps.");
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const members = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...(page?.members ?? [])]
      .filter((m) => words.every((w) => m.name.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));
  }, [page, query]);

  const counts = useMemo(() => {
    const all = [...(rows?.values() ?? [])];
    return { set: all.filter((r) => r.societyIndex != null).length, total: all.length };
  }, [rows]);

  const hasCourse = course.club != null && course.slope != null && course.rating != null && course.par != null;

  async function save(memberId: string, index: number | null) {
    setSaving(true);
    try {
      await setSocietyHandicap(groupId, memberId, index);
      setEditing(null);
      await load();
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(m: GroupMember, h: SocietyHandicap | undefined) {
    setEditing(m.id);
    const start = h?.societyIndex ?? h?.ownIndex ?? null;
    setDraft(start != null ? indicatorLabel(start).replace(/\.0$/, "") : "");
  }

  if (failed && !rows) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Handicaps", headerBackTitle: "Back" }} />
        {/officers|captain|secretary|society keeps/i.test(failed) ? (
          <StateMessage icon="lock-closed-outline" title="For the captain and secretary" body={failed} size="screen" />
        ) : (
          <LoadError onRetry={() => void load()} what="the handicaps" size="screen" />
        )}
      </View>
    );
  }
  if (page === undefined || rows === null) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Handicaps", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Handicaps", headerBackTitle: "Back" }} />
        <StateMessage icon="people-outline" title="This society isn't available" size="screen" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: "Handicaps", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.introTitle}>{page.group.name}</Text>
          <Text style={styles.introBody}>
            Set the index the society plays each member off. Their own handicap and their PinPals indicator — the best of their last 20 scorecards — are beside it to help. Society rounds use what you set here.
          </Text>
          <Text style={styles.introCount}>{`${counts.set} of ${counts.total} set by the society`}</Text>
        </View>

        <Pressable style={styles.courseToggle} onPress={() => setShowCourse((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showCourse }}>
          <Ionicons name="flag-outline" size={18} color={colors.navy900} />
          <Text style={styles.courseToggleText}>
            {hasCourse ? `Course handicaps at ${course.club?.name}${course.teeName ? ` (${course.teeName})` : ""}` : "Show course handicaps for a course"}
          </Text>
          <Ionicons name={showCourse ? "chevron-up" : "chevron-down"} size={18} color={colors.navy900} />
        </Pressable>
        {showCourse ? (
          <View style={styles.courseBox}>
            <CourseSection setup={course} />
            {course.club && !hasCourse ? <Text style={styles.small}>Pick tees, or enter the rating, slope and par, to see course handicaps.</Text> : null}
          </View>
        ) : null}

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={17} color={colors.ink500} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search members"
            placeholderTextColor={colors.ink500}
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search members"
          />
        </View>

        {members.map((m) => {
          const h = rows.get(m.id);
          const playsOff = h?.societyIndex ?? h?.ownIndex ?? null;
          const ch = hasCourse && playsOff != null ? courseHandicap(playsOff, { slope: course.slope, courseRating: course.rating, par: course.par }) : null;
          const open = editing === m.id;
          const typed = parseIndex(draft);
          return (
            <View key={m.id} style={[styles.row, open && styles.rowOpen]}>
              <Pressable style={styles.rowMain} onPress={() => (open ? setEditing(null) : startEdit(m, h))} accessibilityRole="button" accessibilityLabel={`${m.name}, plays off ${playsOff != null ? indicatorLabel(playsOff) : "no handicap"}. Change`}>
                <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={38} />
                <View style={styles.rowBody}>
                  <View style={styles.nameLine}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.id === userId ? `${m.name} (you)` : m.name}
                    </Text>
                    <RoleBadge role={m.role} office={m.office} />
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[
                      `Own ${h?.ownIndex != null ? indicatorLabel(h.ownIndex) : "—"}`,
                      h?.indicator != null ? `Indicator ${indicatorLabel(h.indicator)} (${h.rounds} ${h.rounds === 1 ? "card" : "cards"})` : `Indicator — (${h?.rounds ?? 0} ${h?.rounds === 1 ? "card" : "cards"})`,
                    ].join(" · ")}
                  </Text>
                  {ch ? (
                    <Text style={styles.course} numberOfLines={1}>
                      {`Course ${ch.courseHandicap}${ch.estimated ? "*" : ""} · plays ${playingHandicap(ch.courseHandicap, ALLOWANCE)} (95%)`}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.society}>
                  <Text style={[styles.societyValue, h?.societyIndex == null && styles.societyUnset]}>{playsOff != null ? indicatorLabel(playsOff) : "—"}</Text>
                  <Text style={styles.societyLabel}>{h?.societyIndex != null ? "SOCIETY" : "OWN"}</Text>
                </View>
              </Pressable>

              {open ? (
                <View style={styles.edit}>
                  <View style={styles.editLine}>
                    <TextInput
                      style={[styles.input, draft.trim() !== "" && typed == null && styles.inputBad]}
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="e.g. 14.2 or +1.5"
                      placeholderTextColor={colors.ink500}
                      keyboardType="numbers-and-punctuation"
                      autoFocus
                      accessibilityLabel={`${m.name}'s society handicap index`}
                    />
                    <Pressable style={[styles.save, (typed == null || saving) && styles.saveOff]} onPress={() => typed != null && void save(m.id, typed)} disabled={typed == null || saving} accessibilityRole="button">
                      <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.quick}>
                    {h?.indicator != null ? (
                      <Pressable style={styles.quickPill} onPress={() => setDraft(indicatorLabel(h.indicator as number))} accessibilityRole="button">
                        <Text style={styles.quickText}>{`Use indicator ${indicatorLabel(h.indicator)}`}</Text>
                      </Pressable>
                    ) : null}
                    {h?.ownIndex != null ? (
                      <Pressable style={styles.quickPill} onPress={() => setDraft(indicatorLabel(h.ownIndex as number))} accessibilityRole="button">
                        <Text style={styles.quickText}>{`Use own ${indicatorLabel(h.ownIndex)}`}</Text>
                      </Pressable>
                    ) : null}
                    {h?.societyIndex != null ? (
                      <Pressable style={styles.quickPill} onPress={() => void save(m.id, null)} disabled={saving} accessibilityRole="button">
                        <Text style={[styles.quickText, { color: colors.red600 }]}>Clear — use their own</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}

        {hasCourse ? <Text style={styles.small}>* No rating or slope for these tees, so the course handicap is the index rounded.</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  intro: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  introTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  introBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.cream100, lineHeight: 20 },
  introCount: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.gold400, marginTop: 4 },
  courseToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
  },
  courseToggleText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  courseBox: { padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceTint, borderWidth: 1, borderColor: colors.line },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginTop: spacing.xs,
  },
  search: { flex: 1, height: 44, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  row: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  rowOpen: { borderColor: colors.green600 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 10 },
  rowBody: { flex: 1, gap: 2 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  course: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.green700 },
  society: { alignItems: "center", minWidth: 58 },
  societyValue: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  societyUnset: { color: colors.ink500 },
  societyLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.8, color: colors.ink500 },
  edit: { gap: spacing.sm, paddingHorizontal: 10, paddingBottom: 12 },
  editLine: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.cream50,
  },
  inputBad: { borderColor: colors.red600 },
  save: { paddingHorizontal: 18, height: 44, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  saveOff: { opacity: 0.5 },
  saveText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  quick: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quickPill: { paddingHorizontal: 12, height: 32, borderRadius: radii.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50 },
  quickText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },
});
