import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Chip, ChipGroup, Section } from "@/components/form-bits";
import { DayChoice } from "@/components/day-choice";
import { ExactTimeChoice } from "@/components/exact-time-choice";
import { TimeChoice } from "@/components/time-choice";
import {
  COUNTRY_NAMES,
  nextDays,
  postTeeTime,
  regionsFor,
  searchClubs,
  type ClubHit,
} from "@/lib/tee-time-post";
import { colors, radii, spacing, type } from "@/lib/theme";

/** Which picker is open, if any. One at a time, by construction: two open
 *  pickers is the wall of chips this replaced. */
type OpenPicker = "day" | "exact" | "from" | "to" | null;

/**
 * Posting a tee time, natively.
 *
 * Until this screen existed the app could find a round and ask to join one,
 * but not offer one — a host had to go to the website. That made the app half
 * a product: the interesting side of PinPals is the person with a fourball and
 * two spaces, and they were the one being sent away.
 *
 * The order of the form follows the order a golfer actually knows things:
 * where, then when, then how many, then the fiddly optional bits. Nothing
 * below the Post button is required.
 */
export default function PostTeeTimeScreen() {
  const days = useMemo(() => nextDays(), []);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClubHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [club, setClub] = useState<ClubHit | null>(null);

  const [counties, setCounties] = useState<string[]>([]);
  const [county, setCounty] = useState<string | null>(null);

  const [playDate, setPlayDate] = useState<string | null>(null);
  const [hasTeeTime, setHasTeeTime] = useState(false);
  const [exactTeeTime, setExactTeeTime] = useState<string | null>(null);
  const [timeFrom, setTimeFrom] = useState<string | null>(null);
  const [timeTo, setTimeTo] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);

  const [spaces, setSpaces] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<"everyone" | "connections">(
    "everyone"
  );
  const [ladiesOnly, setLadiesOnly] = useState(false);
  const [handicapLimit, setHandicapLimit] = useState("");
  const [notes, setNotes] = useState("");

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced so a member typing "Royal County Down" makes one or two queries
  // rather than seventeen.
  useEffect(() => {
    if (club || query.trim().length < 2) {
      setHits([]);
      return;
    }

    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchClubs(query)
        .then((found) => {
          if (live) setHits(found);
        })
        .catch(() => {
          if (live) setHits([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 300);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, club]);

  const chooseClub = useCallback((hit: ClubHit) => {
    setClub(hit);
    setHits([]);
    setQuery("");
    setCounty(null);
    setCounties([]);
    Keyboard.dismiss();

    // The club's own row almost never carries a county — `clubs.region` is
    // null for every Irish club — so the member still has to say. Asking only
    // the counties of the club's country keeps that to one tap in most cases.
    regionsFor(hit.country)
      .then(setCounties)
      .catch(() => setCounties([]));
  }, []);

  const toggle = useCallback((which: Exclude<OpenPicker, null>) => {
    setOpenPicker((current) => (current === which ? null : which));
  }, []);

  /** Moving the start past the end has to take the end with it, or the form
   *  holds a range that reads backwards. Clearing the start clears the end
   *  too: "until 5pm" with no start is not a range, and the Until row would
   *  sit greyed out holding a value the member can no longer see or change. */
  const chooseFrom = useCallback((slot: string | null) => {
    setTimeFrom(slot);
    setTimeTo((to) => {
      if (to === null) return null;
      return slot === null || to <= slot ? null : to;
    });
  }, []);

  const ready =
    club !== null && county !== null && playDate !== null && spaces !== null;

  const submit = useCallback(async () => {
    if (!ready || !club || !county || !playDate || spaces === null) return;

    setPosting(true);
    setError(null);

    try {
      const inviteId = await postTeeTime({
        clubId: club.id,
        country: club.country,
        county,
        playDate,
        timeFrom: hasTeeTime ? null : timeFrom,
        timeTo: hasTeeTime ? null : timeTo,
        exactTeeTime: hasTeeTime ? exactTeeTime : null,
        spaces,
        hasTeeTime,
        handicapLimit: handicapLimit.trim() ? Number(handicapLimit) : null,
        notes: notes.trim() || null,
        visibility,
        ladiesOnly,
      });

      // Replaced rather than pushed: going "back" to a form that has already
      // been submitted is how you get two identical tee times.
      router.replace(`/invite/${inviteId}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't post that. Please try again."
      );
    } finally {
      setPosting(false);
    }
  }, [
    ready,
    club,
    county,
    playDate,
    spaces,
    hasTeeTime,
    timeFrom,
    timeTo,
    exactTeeTime,
    handicapLimit,
    notes,
    visibility,
    ladiesOnly,
  ]);

  return (
    <>
      <Stack.Screen options={{ title: "Post a tee time" }} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Section title="Which course?">
            {club ? (
              <Pressable style={styles.chosen} onPress={() => setClub(null)}>
                <View style={styles.chosenText}>
                  <Text style={styles.chosenName}>{club.name}</Text>
                  <Text style={styles.chosenMeta}>
                    {[club.town, COUNTRY_NAMES[club.country] ?? club.country]
                      .filter(Boolean)
                      .join(", ")}
                  </Text>
                </View>
                <Text style={styles.change}>Change</Text>
              </Pressable>
            ) : (
              <>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search golf clubs"
                  placeholderTextColor={colors.ink500}
                  autoCorrect={false}
                  style={styles.input}
                />
                {searching && (
                  <ActivityIndicator color={colors.green700} />
                )}
                {hits.map((hit) => (
                  <Pressable
                    key={hit.id}
                    style={styles.hit}
                    onPress={() => chooseClub(hit)}
                  >
                    <Text style={styles.hitName}>{hit.name}</Text>
                    <Text style={styles.hitMeta}>
                      {[hit.town, COUNTRY_NAMES[hit.country] ?? hit.country]
                        .filter(Boolean)
                        .join(", ")}
                    </Text>
                  </Pressable>
                ))}
                {!searching && query.trim().length >= 2 && hits.length === 0 && (
                  <Text style={styles.empty}>
                    No clubs match that. Try the club&apos;s full name.
                  </Text>
                )}
              </>
            )}
          </Section>

          {club && (
            <Section
              title="Which county?"
              hint="So members browsing their own area can find it."
            >
              {counties.length === 0 ? (
                <ActivityIndicator color={colors.green700} />
              ) : (
                <ChipGroup>
                  {counties.map((name) => (
                    <Chip
                      key={name}
                      label={name}
                      selected={county === name}
                      onPress={() => setCounty(name)}
                    />
                  ))}
                </ChipGroup>
              )}
            </Section>
          )}

          <Section title="What day?">
            <DayChoice
              days={days}
              value={playDate}
              onChange={setPlayDate}
              open={openPicker === "day"}
              onToggle={() => toggle("day")}
            />
          </Section>

          <Section title="Time">
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchLabel}>
                  I&apos;ve already booked a tee time
                </Text>
                <Text style={styles.switchHint}>
                  Members can see exactly when you&apos;re off.
                </Text>
              </View>
              <Switch
                value={hasTeeTime}
                onValueChange={(next) => {
                  setHasTeeTime(next);
                  // Whatever was open belongs to the other mode.
                  setOpenPicker(null);
                }}
                trackColor={{ true: colors.green600, false: colors.line }}
              />
            </View>

            {hasTeeTime ? (
              <ExactTimeChoice
                value={exactTeeTime}
                onChange={setExactTeeTime}
                open={openPicker === "exact"}
                onToggle={() => toggle("exact")}
              />
            ) : (
              <>
                <TimeChoice
                  label="From"
                  value={timeFrom}
                  onChange={chooseFrom}
                  placeholder="Any time"
                  open={openPicker === "from"}
                  onToggle={() => toggle("from")}
                  clearable
                />
                <TimeChoice
                  label="Until"
                  value={timeTo}
                  onChange={setTimeTo}
                  placeholder="Optional"
                  disabled={timeFrom === null}
                  disabledHint="Pick a start first"
                  after={timeFrom}
                  open={openPicker === "to"}
                  onToggle={() => toggle("to")}
                  clearable
                />
              </>
            )}
          </Section>

          <Section title="How many spaces?">
            <ChipGroup>
              {[1, 2, 3].map((n) => (
                <Chip
                  key={n}
                  label={n === 1 ? "1 space" : `${n} spaces`}
                  selected={spaces === n}
                  onPress={() => setSpaces(n)}
                />
              ))}
            </ChipGroup>
          </Section>

          <Section title="Who can see it?">
            <ChipGroup>
              <Chip
                label="All members"
                selected={visibility === "everyone"}
                onPress={() => setVisibility("everyone")}
              />
              <Chip
                label="My connections only"
                selected={visibility === "connections"}
                onPress={() => setVisibility("connections")}
              />
            </ChipGroup>
          </Section>

          <Section title="Anything else?" hint="All optional.">
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchLabel}>Ladies only</Text>
                <Text style={styles.switchHint}>
                  Shown on the invite and in the email members get.
                </Text>
              </View>
              <Switch
                value={ladiesOnly}
                onValueChange={setLadiesOnly}
                trackColor={{ true: colors.green600, false: colors.line }}
              />
            </View>

            <Text style={styles.subLabel}>Handicap limit</Text>
            <TextInput
              value={handicapLimit}
              onChangeText={setHandicapLimit}
              placeholder="No limit"
              placeholderTextColor={colors.ink500}
              keyboardType="numeric"
              style={styles.input}
            />

            <Text style={styles.subLabel}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Buggies booked, casual round, happy to play for a few euro…"
              placeholderTextColor={colors.ink500}
              multiline
              style={[styles.input, styles.notes]}
            />
          </Section>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.post, (!ready || posting) && styles.disabled]}
            disabled={!ready || posting}
            onPress={() => void submit()}
          >
            {posting ? (
              <ActivityIndicator color={colors.cream50} />
            ) : (
              <Text style={styles.postLabel}>Post tee time</Text>
            )}
          </Pressable>

          {!ready && (
            <View style={styles.missing}>
              <Ionicons
                name="information-circle-outline"
                size={17}
                color={colors.ink500}
              />
              <Text style={styles.missingText}>
                Still need{" "}
                {[
                  !club && "a course",
                  club && !county && "a county",
                  !playDate && "a day",
                  spaces === null && "the number of spaces",
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    // 16 is a floor, not a preference: iOS zooms the page when a control
    // below 16px takes focus.
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  notes: { minHeight: 96, textAlignVertical: "top" },
  hit: {
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  hitName: { fontSize: type.body, fontWeight: "600", color: colors.ink900 },
  hitMeta: { fontSize: type.small, color: colors.ink500 },
  empty: { fontSize: type.small, color: colors.ink500 },
  chosen: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.green700,
    backgroundColor: colors.surface,
  },
  chosenText: { flex: 1 },
  chosenName: { fontSize: type.body, fontWeight: "700", color: colors.ink900 },
  chosenMeta: { fontSize: type.small, color: colors.ink500 },
  change: { fontSize: type.small, fontWeight: "700", color: colors.green700 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { fontSize: type.body, color: colors.ink900, fontWeight: "600" },
  switchHint: { fontSize: type.small, color: colors.ink500 },
  subLabel: {
    fontSize: type.label,
    fontWeight: "700",
    color: colors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  post: {
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  disabled: { opacity: 0.5 },
  postLabel: {
    color: colors.cream50,
    fontWeight: "700",
    fontSize: type.body,
  },
  missing: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    marginTop: -spacing.sm,
  },
  missingText: { flex: 1, fontSize: type.small, color: colors.ink500 },
  error: {
    fontSize: type.small,
    color: colors.red600,
    backgroundColor: colors.red100,
    borderRadius: radii.md,
    padding: spacing.md,
  },
});
