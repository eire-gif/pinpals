import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { Chip, ChipGroup, Section } from "@/components/form-bits";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { placeLabel, type Club } from "@/lib/courses";
import { isOn } from "@/lib/features";
import { createLiveRound, loadCourseCards, type CourseCard } from "@/lib/live-rounds";
import {
  LIVE_FORMATS,
  blankCard,
  courseHandicap,
  formatInfo,
  parseIndex,
  playingHandicap,
  type LiveFormat,
} from "@/lib/live-scoring";
import { listConnections, type Member } from "@/lib/members";
import { loadMyProfile } from "@/lib/profile";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Set up a round: course and tees, format, players.
 *
 * Every player's handicap is an INDEX, typed or carried over from their
 * profile, and "plays off" beside it is worked out live from the course's
 * rating and slope (live-scoring.ts) as you type — so the number a member
 * checks is the one they'll actually get shots from.
 *
 * Members can add themselves, their PinPals and guests by name. Only
 * accepted PinPals are offered: putting a stranger on a leaderboard is
 * refused by live_round_create anyway, and offering it would be a trap.
 */

type DraftPlayer = {
  key: string;
  memberId: string | null;
  name: string;
  indexText: string;
  isMe: boolean;
};

const parseNumber = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

let keySeq = 0;
const nextKey = () => `p${++keySeq}`;

export default function NewLiveRound() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [club, setClub] = useState<Club | null>(null);
  const [cards, setCards] = useState<CourseCard[] | null>(null);
  const [cardId, setCardId] = useState<number | null>(null);
  const [teeName, setTeeName] = useState("");
  const [holes, setHoles] = useState<9 | 18>(18);
  const [ratingText, setRatingText] = useState("");
  const [slopeText, setSlopeText] = useState("");
  const [parText, setParText] = useState("72");
  const [format, setFormat] = useState<LiveFormat>("stableford");
  const [players, setPlayers] = useState<DraftPlayer[]>([]);
  const [pals, setPals] = useState<Member[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  // Me first, with the handicap from my profile if I've given one.
  useEffect(() => {
    if (!userId) return;
    void loadMyProfile(userId).then((me) => {
      const name = me ? [me.firstName, me.lastName].filter(Boolean).join(" ") || "You" : "You";
      setPlayers((ps) =>
        ps.some((p) => p.isMe)
          ? ps
          : [{ key: nextKey(), memberId: userId, name, indexText: me?.handicap != null ? String(me.handicap) : "", isMe: true }, ...ps]
      );
    });
  }, [userId]);

  // The cards on file for this course, if anyone has entered one.
  useEffect(() => {
    setCards(null);
    setCardId(null);
    if (!club) return;
    void loadCourseCards(club.id)
      .then(setCards)
      .catch(() => setCards([]));
  }, [club]);

  const card = cards?.find((c) => c.id === cardId) ?? null;

  const pickCard = (c: CourseCard | null) => {
    setCardId(c?.id ?? null);
    if (c) {
      setTeeName(c.teeName);
      setHoles(c.holes);
      setRatingText(c.courseRating != null ? String(c.courseRating) : "");
      setSlopeText(c.slope != null ? String(c.slope) : "");
      setParText(String(c.parTotal ?? c.card.reduce((n, h) => n + h.par, 0)));
    }
  };

  const rating = parseNumber(ratingText);
  const slope = parseNumber(slopeText);
  const par = parseNumber(parText);
  const info = formatInfo(format);

  // Plays-off for every row, recomputed as anything above changes.
  const worked = useMemo(
    () =>
      players.map((p) => {
        const index = parseIndex(p.indexText);
        if (index == null) return null;
        const ch = courseHandicap(index, { slope, courseRating: rating, par });
        return { index, ...ch, playing: playingHandicap(ch.courseHandicap, info.allowance) };
      }),
    [players, slope, rating, par, info.allowance]
  );

  const problems: string[] = [];
  if (!club) problems.push("Pick the course");
  if (players.length === 0) problems.push("Add at least one player");
  if (worked.some((w) => w == null)) problems.push("Every player needs a handicap index");
  if (players.some((p) => p.name.trim() === "")) problems.push("Every guest needs a name");
  if (format === "matchplay" && players.length !== 2) problems.push("Singles matchplay is two players");
  if (ratingText.trim() !== "" && (rating == null || rating < 25 || rating > 85)) problems.push("Course rating looks wrong");
  if (slopeText.trim() !== "" && (slope == null || slope < 55 || slope > 155)) problems.push("Slope must be 55–155");

  const update = (key: string, change: Partial<DraftPlayer>) =>
    setPlayers((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const remove = (key: string) => setPlayers((ps) => ps.filter((p) => p.key !== key));

  const openPals = async () => {
    setPicking(true);
    if (pals == null && userId) {
      try {
        setPals((await listConnections(userId)).accepted);
      } catch {
        setPals([]);
      }
    }
  };

  const addPal = (m: Member) => {
    setPlayers((ps) => [...ps, { key: nextKey(), memberId: m.id, name: m.name, indexText: m.handicap != null ? String(m.handicap) : "", isMe: false }]);
    setPicking(false);
  };

  const addGuest = () =>
    setPlayers((ps) => [...ps, { key: nextKey(), memberId: null, name: "", indexText: "", isMe: false }]);

  const start = async () => {
    if (!club || problems.length > 0) return;
    setSaving(true);
    try {
      const holeCard = card && card.holes === holes ? card.card : blankCard(holes);
      const id = await createLiveRound(
        {
          courseName: club.name,
          clubId: club.id,
          teeName: teeName.trim() || null,
          format,
          holes,
          courseRating: rating,
          slope: slope != null ? Math.round(slope) : null,
          parTotal: par != null ? Math.round(par) : null,
          allowance: info.allowance,
        },
        players.map((p, i) => ({
          memberId: p.memberId,
          name: p.name.trim(),
          handicapIndex: worked[i]!.index,
          courseHandicap: worked[i]!.courseHandicap,
          playingHandicap: worked[i]!.playing,
          estimated: worked[i]!.estimated,
        })),
        holeCard
      );
      router.replace({ pathname: "/live/round/[id]", params: { id: String(id) } });
    } catch (e) {
      Alert.alert("Couldn't start the round", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOn("liveScoring")) {
    return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;
  }

  const added = new Set(players.map((p) => p.memberId).filter(Boolean));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Section title="Course">
          {club ? (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{club.name}</Text>
                <Text style={styles.cardMeta}>{placeLabel(club)}</Text>
              </View>
              <Pressable onPress={() => setClub(null)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <CourseSearch placeholder="Search for the course" onPick={setClub} />
          )}
        </Section>

        {club ? (
          <Section
            title="Tees"
            hint={
              cards && cards.length > 0
                ? "Cards already entered for this course. Pick yours, or enter other tees."
                : "No card on file for this course yet. Enter the rating and slope from the card if you have them; you can add the stroke indexes as you play."
            }
          >
            {cards == null ? (
              <ActivityIndicator color={colors.green700} />
            ) : cards.length > 0 ? (
              <ChipGroup>
                {cards.map((c) => (
                  <Chip key={c.id} label={`${c.teeName}${c.verified ? " ✓" : ""}`} selected={cardId === c.id} onPress={() => pickCard(c)} />
                ))}
                <Chip label="Other tees" selected={cardId == null} onPress={() => pickCard(null)} />
              </ChipGroup>
            ) : null}

            <View style={styles.fields}>
              <Field label="Tee name" value={teeName} onChange={setTeeName} placeholder="e.g. White" wide />
              <Field label="Rating" value={ratingText} onChange={setRatingText} placeholder="72.4" numeric />
              <Field label="Slope" value={slopeText} onChange={setSlopeText} placeholder="130" numeric />
              <Field label="Par" value={parText} onChange={setParText} placeholder="72" numeric />
            </View>
            <ChipGroup>
              <Chip label="18 holes" selected={holes === 18} onPress={() => { setHoles(18); if (parText === "36") setParText("72"); }} />
              <Chip label="9 holes" selected={holes === 9} onPress={() => { setHoles(9); if (parText === "72") setParText("36"); }} />
            </ChipGroup>
          </Section>
        ) : null}

        <Section title="Format">
          <View style={styles.formats}>
            {LIVE_FORMATS.map((f) => {
              const on = format === f.id;
              return (
                <Pressable
                  key={f.id}
                  disabled={!f.available}
                  onPress={() => setFormat(f.id)}
                  style={[styles.format, on && styles.formatOn, !f.available && styles.formatOff]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !f.available }}
                >
                  <Text style={[styles.formatLabel, !f.available && styles.muted]}>{f.label}</Text>
                  <Text style={[styles.formatBlurb, on && styles.formatBlurbOn]}>{f.available ? f.blurb : f.matchDay ? "Use a match day" : "Coming soon"}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>Handicap allowance: {Math.round(info.allowance * 100)}%</Text>
        </Section>

        <Section title="Players" hint="Enter each player's handicap index. Plays-off is worked out for this course.">
          <View style={styles.players}>
            {players.map((p, i) => {
              const w = worked[i];
              return (
                <View key={p.key} style={[styles.player, i > 0 && styles.playerDivider]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    {p.memberId ? (
                      <Text style={styles.playerName} numberOfLines={1}>
                        {p.isMe ? `${p.name} (you)` : p.name}
                      </Text>
                    ) : (
                      <TextInput
                        value={p.name}
                        onChangeText={(name) => update(p.key, { name })}
                        placeholder="Guest's name"
                        placeholderTextColor={colors.ink500}
                        style={styles.nameInput}
                        maxLength={60}
                        accessibilityLabel="Guest's name"
                      />
                    )}
                    <Text style={styles.playerMeta}>
                      {w == null
                        ? "Enter an index, e.g. 14.2 or +1.5"
                        : `Course handicap ${w.courseHandicap}${w.estimated ? " (no slope, estimated)" : ""}`}
                    </Text>
                  </View>
                  <TextInput
                    value={p.indexText}
                    onChangeText={(indexText) => update(p.key, { indexText })}
                    placeholder="Index"
                    placeholderTextColor={colors.ink500}
                    keyboardType="numbers-and-punctuation"
                    style={styles.indexInput}
                    maxLength={5}
                    accessibilityLabel={`${p.name || "Guest"}'s handicap index`}
                  />
                  <View style={styles.playsOff}>
                    <Text style={styles.playsOffNumber}>{w ? w.playing : "–"}</Text>
                    <Text style={styles.playsOffLabel}>plays off</Text>
                  </View>
                  {!p.isMe ? (
                    <Pressable onPress={() => remove(p.key)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${p.name || "guest"}`}>
                      <Ionicons name="close-circle" size={22} color={colors.ink500} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            {players.length < 8 ? (
              <View style={[styles.addRow, players.length > 0 && styles.playerDivider]}>
                <Pressable onPress={() => void openPals()} style={styles.addButton} accessibilityRole="button">
                  <Ionicons name="person-add-outline" size={18} color={colors.green700} />
                  <Text style={styles.link}>Add a PinPal</Text>
                </Pressable>
                <Pressable onPress={addGuest} style={styles.addButton} accessibilityRole="button">
                  <Ionicons name="add" size={20} color={colors.green700} />
                  <Text style={styles.link}>Add a guest</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {picking ? (
            <View style={styles.picker}>
              {pals == null ? (
                <ActivityIndicator color={colors.green700} />
              ) : pals.filter((m) => !added.has(m.id)).length === 0 ? (
                <Text style={styles.hint}>No more PinPals to add. Add them as a guest instead.</Text>
              ) : (
                pals
                  .filter((m) => !added.has(m.id))
                  .map((m) => (
                    <Pressable key={m.id} onPress={() => addPal(m)} style={styles.pickRow} accessibilityRole="button">
                      <Text style={styles.playerName}>{m.name}</Text>
                      <Text style={styles.playerMeta}>{m.handicap != null ? `Index ${m.handicap}` : "Handicap not shared"}</Text>
                    </Pressable>
                  ))
              )}
              <Pressable onPress={() => setPicking(false)} hitSlop={8}>
                <Text style={[styles.link, { textAlign: "center", marginTop: spacing.sm }]}>Close</Text>
              </Pressable>
            </View>
          ) : null}
        </Section>

        {problems.length > 0 && club ? <Text style={styles.problem}>{problems[0]}</Text> : null}

        <Pressable
          onPress={() => void start()}
          disabled={problems.length > 0 || saving}
          style={({ pressed }) => [styles.start, (problems.length > 0 || saving) && styles.startOff, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: problems.length > 0 || saving }}
        >
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>Tee off</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  numeric = false,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  numeric?: boolean;
  wide?: boolean;
}) {
  return (
    <View style={[styles.field, wide && styles.fieldWide]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.ink500}
        keyboardType={numeric ? "decimal-pad" : "default"}
        style={styles.input}
        maxLength={numeric ? 5 : 40}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  cardMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  field: { flexBasis: "22%", flexGrow: 1, gap: 4 },
  fieldWide: { flexBasis: "100%" },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  formats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  format: {
    flexBasis: "31%",
    flexGrow: 1,
    minHeight: 60,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: spacing.sm + 2,
    justifyContent: "center",
    gap: 2,
  },
  formatOn: { borderWidth: 2, borderColor: colors.green700, backgroundColor: colors.green100 },
  formatOff: { backgroundColor: colors.surfaceTint },
  formatLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  formatBlurb: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  formatBlurbOn: { color: colors.green800 },
  muted: { color: colors.ink500 },
  players: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  player: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  playerDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  playerName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  playerMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  nameInput: {
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.ink900,
  },
  indexInput: {
    width: 64,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    textAlign: "center",
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.cream50,
  },
  playsOff: { width: 52, alignItems: "center" },
  playsOffNumber: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  playsOffLabel: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase", color: colors.ink500 },
  addRow: { flexDirection: "row", justifyContent: "space-around" },
  addButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingHorizontal: spacing.sm },
  picker: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pickRow: { minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  start: {
    minHeight: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  startOff: { backgroundColor: colors.ink500 },
  startLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
