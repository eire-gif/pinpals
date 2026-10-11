import { useEffect, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { CourseSearch } from "@/components/course-search";
import { Chip, ChipGroup, Section } from "@/components/form-bits";
import { TeeChip } from "@/components/tee-chip";
import { coursesNear, distanceLabel, placeLabel, type Club } from "@/lib/courses";
import { locationAlreadyAllowed, useCurrentLocation } from "@/lib/location";
import { loadCourseCards, type CourseCard } from "@/lib/live-rounds";
import { blankCard, type CardHole } from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Course and tees, for both set-up screens (a round, and a match day).
 *
 * Pick the course from the directory; if anyone has saved a card for it
 * (course_cards, 0103) its tees are offered and fill in rating, slope, par
 * and every hole's stroke index. Otherwise the organiser types the rating and
 * slope from the card, and stroke indexes are entered as the group plays.
 *
 * Oct 2026: "Nearby" under the search box — most games are set up in the
 * car park, so the course is usually the nearest one. If the member has
 * already allowed location the list fills itself; otherwise one tap asks.
 */

const parseNumber = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export type CourseSetup = ReturnType<typeof useCourseSetup>;

export function useCourseSetup() {
  const [club, setClub] = useState<Club | null>(null);
  const [cards, setCards] = useState<CourseCard[] | null>(null);
  const [cardId, setCardId] = useState<number | null>(null);
  const [teeName, setTeeName] = useState("");
  const [holes, setHolesState] = useState<9 | 18>(18);
  const [ratingText, setRatingText] = useState("");
  const [slopeText, setSlopeText] = useState("");
  const [parText, setParText] = useState("72");

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
      setHolesState(c.holes);
      setRatingText(c.courseRating != null ? String(c.courseRating) : "");
      setSlopeText(c.slope != null ? String(c.slope) : "");
      setParText(String(c.parTotal ?? c.card.reduce((n, h) => n + h.par, 0)));
    }
  };

  const setHoles = (n: 9 | 18) => {
    setHolesState(n);
    if (n === 9 && parText === "72") setParText("36");
    if (n === 18 && parText === "36") setParText("72");
  };

  const rating = parseNumber(ratingText);
  const slope = parseNumber(slopeText);
  const par = parseNumber(parText);

  const problems: string[] = [];
  if (!club) problems.push("Pick the course");
  if (ratingText.trim() !== "" && (rating == null || rating < 25 || rating > 85)) problems.push("Course rating looks wrong");
  if (slopeText.trim() !== "" && (slope == null || slope < 55 || slope > 155)) problems.push("Slope must be 55–155");

  /** The card a new round starts from: the saved one, or a blank one. */
  const holeCard = (): CardHole[] => (card && card.holes === holes ? card.card : blankCard(holes));

  return {
    club, setClub, cards, cardId, pickCard, card,
    teeName, setTeeName, holes, setHoles,
    ratingText, setRatingText, slopeText, setSlopeText, parText, setParText,
    rating, slope: slope != null ? Math.round(slope) : null, par: par != null ? Math.round(par) : null,
    problems, holeCard,
  };
}

export function CourseSection({ setup }: { setup: CourseSetup }) {
  const s = setup;
  return (
    <>
      <Section title="Course">
        {s.club ? (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{s.club.name}</Text>
              <Text style={styles.cardMeta}>{placeLabel(s.club)}</Text>
            </View>
            <Pressable onPress={() => s.setClub(null)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CourseSearch placeholder="Search for the course" onPick={s.setClub} />
            <NearbyCourses onPick={s.setClub} />
          </>
        )}
      </Section>

      {s.club ? (
        <Section
          title="Tees"
          hint={
            s.cards && s.cards.length > 0
              ? "Cards already entered for this course. Pick yours, or enter other tees."
              : "No card on file for this course yet. Enter the rating and slope from the card if you have them; you can add the stroke indexes as you play."
          }
        >
          {s.cards == null ? (
            <ActivityIndicator color={colors.green700} />
          ) : s.cards.length > 0 ? (
            <ChipGroup>
              {s.cards.map((c) => (
                <TeeChip key={c.id} name={c.teeName} label={`${c.teeName}${c.verified ? " ✓" : ""}`} selected={s.cardId === c.id} onPress={() => s.pickCard(c)} />
              ))}
              <Chip label="Other tees" selected={s.cardId == null} onPress={() => s.pickCard(null)} />
            </ChipGroup>
          ) : null}

          <View style={styles.fields}>
            <Field label="Tee name" value={s.teeName} onChange={s.setTeeName} placeholder="e.g. White" wide />
            <Field label="Rating" value={s.ratingText} onChange={s.setRatingText} placeholder="72.4" numeric />
            <Field label="Slope" value={s.slopeText} onChange={s.setSlopeText} placeholder="130" numeric />
            <Field label="Par" value={s.parText} onChange={s.setParText} placeholder="72" numeric />
          </View>
          <ChipGroup>
            <Chip label="18 holes" selected={s.holes === 18} onPress={() => s.setHoles(18)} />
            <Chip label="9 holes" selected={s.holes === 9} onPress={() => s.setHoles(9)} />
          </ChipGroup>
        </Section>
      ) : null}
    </>
  );
}

const NEAR_RADIUS_KM = 40;
const NEAR_FIRST = 5;
const NEAR_MAX = 12;

/** The courses around the member, nearest first, one tap to pick. */
export function NearbyCourses({ onPick }: { onPick: (club: Club) => void }) {
  const location = useCurrentLocation();
  const [near, setNear] = useState<Club[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const find = async (silent: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const coords = location.state.status === "ready" ? location.state.coords : await location.request();
      if (!alive.current) return;
      if (!coords) {
        if (!silent) setNote("PinPals couldn't get your location. You can turn it on in Settings › PinPals › Location, or search above.");
        return;
      }
      const { clubs } = await coursesNear(coords.lat, coords.lng, NEAR_RADIUS_KM, NEAR_MAX);
      if (!alive.current) return;
      setNear(clubs);
      if (clubs.length === 0) setNote(`No courses on file within ${NEAR_RADIUS_KM} km. Search above to find yours.`);
    } catch {
      if (alive.current && !silent) setNote("Couldn't load nearby courses. Please try again.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // Already allowed: fetch straight away, without a prompt.
  useEffect(() => {
    void locationAlreadyAllowed().then((ok) => {
      if (ok && alive.current) void find(true);
    });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (near && near.length > 0) {
    const list = showAll ? near : near.slice(0, NEAR_FIRST);
    return (
      <View style={styles.near}>
        <View style={styles.nearHead}>
          <Ionicons name="navigate" size={14} color={colors.green700} />
          <Text style={styles.nearTitle}>Nearby courses</Text>
        </View>
        <View style={styles.nearList}>
          {list.map((club, i) => (
            <Pressable
              key={club.id}
              onPress={() => onPick(club)}
              style={({ pressed }) => [styles.nearRow, i > 0 && styles.nearRowLine, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`${club.name}, ${distanceLabel(club.distance_km) ?? ""}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{club.name}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{placeLabel(club)}</Text>
              </View>
              <Text style={styles.nearDistance}>{distanceLabel(club.distance_km)}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
            </Pressable>
          ))}
        </View>
        {near.length > NEAR_FIRST ? (
          <Pressable onPress={() => setShowAll((v) => !v)} hitSlop={8} accessibilityRole="button" style={styles.nearMore}>
            <Text style={styles.link}>{showAll ? "Show fewer" : `Show ${near.length - NEAR_FIRST} more nearby`}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.near}>
      <Pressable
        onPress={() => void find(false)}
        disabled={busy}
        style={({ pressed }) => [styles.nearButton, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel="Show courses near me"
      >
        {busy ? <ActivityIndicator color={colors.navy900} /> : <Ionicons name="navigate" size={18} color={colors.navy900} />}
        <Text style={styles.nearButtonLabel}>{busy ? "Finding courses near you…" : "Nearby courses"}</Text>
      </Pressable>
      {note ? <Text style={styles.nearNote}>{note}</Text> : null}
    </View>
  );
}

export function Field({
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
  near: { gap: spacing.sm, marginTop: spacing.sm },
  nearHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  nearTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700, textTransform: "uppercase", letterSpacing: 0.6 },
  nearList: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, overflow: "hidden" },
  nearRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  nearRowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  nearDistance: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500 },
  nearMore: { alignSelf: "center", paddingVertical: 4 },
  nearButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
    borderWidth: 1,
    borderColor: colors.gold500,
  },
  nearButtonLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  nearNote: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
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
});
