import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { OnboardingFrame } from "@/components/onboarding-frame";
import { useAuth } from "@/lib/auth";
import {
  FREQUENCIES,
  INTERESTS,
  loadGameDetails,
  saveGameDetails,
  patchProfile,
  type Frequency,
  type Interest,
} from "@/lib/onboarding";
import { loadMyProfile } from "@/lib/profile";
import { colors, fonts, radii } from "@/lib/theme";

/** Index in tenths, so the stepper never accumulates 0.1 + 0.2 float error. */
const START = 180;
const MIN = -100;
const MAX = 540;

/**
 * Step 2 — Your game.
 *
 * A stepper rather than a text field for the handicap: one decimal place
 * typed on a phone keypad is fiddly, and a wrong-but-plausible "142" is worse
 * than the half-second of tapping. "I don't have a handicap yet" is a real
 * answer, not a skip — plenty of the golfers PinPals is for are new to it.
 */
export default function GameStep() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [tenths, setTenths] = useState<number | null>(START);
  const [visible, setVisible] = useState(true);
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void loadMyProfile(userId).then((p) => {
      if (p?.handicap !== null && p?.handicap !== undefined) setTenths(Math.round(p.handicap * 10));
      if (p) setVisible(p.handicapVisible || p.handicap === null);
    });
    void loadGameDetails(userId).then((g) => {
      setFrequency(g.frequency);
      setInterests(g.interests);
    });
  }, [userId]);

  const step = (d: number) =>
    setTenths((t) => Math.min(MAX, Math.max(MIN, (t ?? START) + d)));

  const toggle = (code: Interest) =>
    setInterests((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      await patchProfile(userId, {
        handicap: tenths === null ? "" : (tenths / 10).toFixed(1),
        handicapVisible: tenths !== null && visible,
      });
      await saveGameDetails(userId, frequency, interests);
      router.push("/onboarding/played");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const shown = tenths === null ? "—" : (tenths / 10).toFixed(1).replace("-", "+");

  return (
    <OnboardingFrame
      step={2}
      title="Your game"
      sub="So we can pair you with golfers who'll enjoy the same round."
      onBack={() => router.back()}
      onSkip={() => router.push("/onboarding/played")}
      onContinue={save}
      pending={saving}
      error={error}
    >
      <View style={styles.card}>
        <Text style={styles.label}>Handicap index</Text>
        <View style={styles.stepper}>
          <Pressable style={styles.stepBtn} onPress={() => step(-1)} onLongPress={() => step(-10)} accessibilityRole="button" accessibilityLabel="Lower">
            <Text style={styles.stepGlyph}>−</Text>
          </Pressable>
          <Text style={styles.value} accessibilityLiveRegion="polite">{shown}</Text>
          <Pressable style={styles.stepBtn} onPress={() => step(1)} onLongPress={() => step(10)} accessibilityRole="button" accessibilityLabel="Higher">
            <Text style={styles.stepGlyph}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Hold − or + to move a whole shot.</Text>

        {tenths !== null ? (
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show my handicap on my profile</Text>
            <Switch value={visible} onValueChange={setVisible} trackColor={{ true: colors.green700, false: colors.line }} />
          </View>
        ) : null}

        <Pressable
          onPress={() => setTenths((t) => (t === null ? START : null))}
          style={styles.linkHit}
          accessibilityRole="button"
        >
          <Text style={styles.link}>{tenths === null ? "I do have a handicap" : "I don't have a handicap yet"}</Text>
        </Pressable>
      </View>

      <Text style={[styles.label, styles.gap]}>How often do you play?</Text>
      <View style={styles.chips}>
        {FREQUENCIES.map((f) => (
          <Chip key={f.code} label={f.label} on={frequency === f.code} onPress={() => setFrequency(frequency === f.code ? null : f.code)} />
        ))}
      </View>

      <Text style={[styles.label, styles.gap]}>
        What are you up for? <Text style={styles.soft}>Pick any</Text>
      </Text>
      <View style={styles.chips}>
        {INTERESTS.map((i) => (
          <Chip key={i.code} label={i.label} on={interests.includes(i.code)} onPress={() => toggle(i.code)} />
        ))}
      </View>
    </OnboardingFrame>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 18,
  },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  soft: { fontFamily: fonts.body, color: "#5b6576" },
  gap: { marginTop: 22, marginBottom: 10 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  stepGlyph: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.ink900 },
  value: { fontFamily: fonts.display, fontSize: 44, color: colors.ink900 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "center", marginTop: 6 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.cream100,
  },
  toggleLabel: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: colors.ink900 },
  linkHit: { minHeight: 44, justifyContent: "center", marginTop: 4 },
  link: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.green700 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 15,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },
});
