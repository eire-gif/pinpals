import { useEffect, useState } from "react";
import {
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
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { ErrorNote, PrimaryButton } from "@/components/join-ui";
import { StarPicker } from "@/components/stars";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  RATING_WORDS,
  REVIEW_TAGS,
  deleteReview,
  saveReview,
  type ReviewTag,
} from "@/lib/onboarding";
import { colors, fonts, radii, spacing } from "@/lib/theme";

const MAX = 1000;

/** The last eighteen months, newest first, as "YYYY-MM-01". */
function recentMonths(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 18; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    out.push({ value, label: d.toLocaleDateString("en-IE", { month: "short", year: "numeric" }) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/**
 * Rate and review a course — presented as a sheet over the course page.
 *
 * Only the stars are required. A comment, the "what stood out" tags and the
 * month played are all optional, because a rating with nothing else is still
 * worth having and a form that demands a paragraph gets none.
 */
export default function ReviewSheet() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const clubId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<ReviewTag[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const months = recentMonths();

  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("course_reviews")
      .select("rating, body, tags, played_month")
      .eq("member_id", userId)
      .eq("club_id", clubId)
      .maybeSingle<{ rating: number; body: string | null; tags: ReviewTag[]; played_month: string | null }>()
      .then(({ data }) => {
        if (!data) return;
        setExisting(true);
        setRating(data.rating);
        setBody(data.body ?? "");
        setTags(data.tags ?? []);
        setMonth(data.played_month);
      });
  }, [userId, clubId]);

  const save = async () => {
    if (!userId) return;
    if (rating === 0) {
      setError("Tap a star to rate the course.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveReview(userId, clubId, { rating, body, tags, playedMonth: month });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your review.");
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert("Delete your review?", "Your rating comes off the course's average too.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!userId) return;
          await deleteReview(userId, clubId);
          router.back();
        },
      },
    ]);

  const toggleTag = (t: ReviewTag) => setTags((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]));

  return (
    <>
      <Stack.Screen options={{ title: existing ? "Edit your review" : "Rate & review" }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {name ? <Text style={styles.course}>{name}</Text> : null}

          <View style={styles.starsBlock}>
            <StarPicker value={rating} onChange={setRating} size={42} />
            <Text style={styles.word}>{rating ? RATING_WORDS[rating] : "Tap a star to rate"}</Text>
          </View>

          <Text style={styles.label}>
            What stood out? <Text style={styles.soft}>Optional</Text>
          </Text>
          <View style={styles.chips}>
            {REVIEW_TAGS.map((t) => {
              const on = tags.includes(t.code);
              return (
                <Pressable
                  key={t.code}
                  onPress={() => toggleTag(t.code)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>
            Tell other golfers about it <Text style={styles.soft}>Optional</Text>
          </Text>
          <TextInput
            value={body}
            onChangeText={(t) => setBody(t.slice(0, MAX))}
            multiline
            placeholder="Greens, the welcome, the hole you'll remember…"
            placeholderTextColor={colors.ink500}
            style={styles.input}
            textAlignVertical="top"
            accessibilityLabel="Your review"
          />
          <Text style={styles.counter}>
            {body.length} / {MAX}
          </Text>

          <Text style={styles.label}>
            When did you play? <Text style={styles.soft}>Optional</Text>
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.months}>
            {months.map((m) => {
              const on = month === m.value;
              return (
                <Pressable
                  key={m.value}
                  onPress={() => setMonth(on ? null : m.value)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.note}>
            Shown with your name and home club. Keep it about the golf — reviews naming staff or members are removed.
          </Text>

          {existing ? (
            <Pressable onPress={remove} style={styles.deleteHit} accessibilityRole="button">
              <Text style={styles.delete}>Delete my review</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <ErrorNote message={error} />
          <PrimaryButton label={existing ? "Update review" : "Post review"} onPress={save} pending={saving} />
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: 20, paddingBottom: spacing.xl },
  course: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  starsBlock: { alignItems: "center", gap: 6, marginVertical: 20 },
  word: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green800 },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900, marginTop: 18, marginBottom: 8 },
  soft: { fontFamily: fonts.body, color: "#5b6576" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  months: { gap: 8 },
  chip: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },
  input: {
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.ink900,
  },
  counter: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "right", marginTop: 4 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: "#4c5667", marginTop: 18 },
  deleteHit: { minHeight: 44, justifyContent: "center", marginTop: 8 },
  delete: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.red600 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: 10,
  },
});
