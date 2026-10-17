import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { BirthDateField, birthdayLabel } from "@/components/birth-date-field";
import { setMyDateOfBirth } from "@/lib/age";
import { gateFor } from "@/lib/age-rules";
import { useAuth } from "@/lib/auth";
import { colors, fonts, radii, spacing, type, AUTH_COLUMN } from "@/lib/theme";

/**
 * "Add your date of birth" (junior members, 0159).
 *
 * Members who joined before PinPals opened to 13 and over have no date of
 * birth, and what they can use now depends on it. The root layout
 * (app/_layout.tsx) brings them here, once, full screen, when
 * my_age_access() says needsDateOfBirth. The date is saved with
 * set_my_date_of_birth(), which locks it: only staff can change it after.
 *
 * Under 13 is refused by the database (the guard trigger's own wording is
 * shown). A 13–15 year old lands on the waiting screen next, to add a
 * parent.
 */
export default function DateOfBirthScreen() {
  const { signOut } = useAuth();
  const [dob, setDob] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!dob || saving) return;
    // The date can't be changed afterwards, so it's read back first.
    Alert.alert("Is this right?", `${birthdayLabel(dob)}. You won't be able to change it afterwards.`, [
      { text: "Change it", style: "cancel" },
      {
        text: "Save",
        onPress: () => {
          setSaving(true);
          setError(null);
          setMyDateOfBirth(dob)
            .then((access) => {
              router.replace(gateFor(access) === "waiting" ? "/age/waiting" : "/(tabs)");
            })
            .catch((e: unknown) => {
              setError(e instanceof Error ? e.message : "Couldn't save that. Please try again.");
              setSaving(false);
            });
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.eyebrowRow}>
          <View style={styles.rule} />
          <Text style={styles.eyebrow}>One quick thing</Text>
        </View>
        <Text style={styles.title}>Add your date of birth</Text>
        <Text style={styles.tagline}>
          PinPals is now open to golfers from 13, and some parts of it depend on age. We need your date of birth to
          keep everyone in the right place.
        </Text>

        <View style={styles.card}>
          <BirthDateField value={dob} onChange={setDob} />
          <View style={styles.noteRow}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.ink500} />
            <Text style={styles.note}>
              Kept private — only an age range is ever shown, and only if you allow it. You can&apos;t change it
              afterwards, so please check it.
            </Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.primary, (!dob || saving) && styles.primaryDisabled]}
            onPress={save}
            disabled={!dob || saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: !dob || saving }}
          >
            {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryLabel}>Save and carry on</Text>}
          </Pressable>

          <Pressable style={styles.linkRow} onPress={() => void signOut()} accessibilityRole="button">
            <Text style={styles.link}>Log out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, ...AUTH_COLUMN },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 20, height: 2, backgroundColor: colors.gold400 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50, marginTop: spacing.sm },
  tagline: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.cream100, marginTop: spacing.sm, marginBottom: spacing.lg },
  card: { backgroundColor: colors.cream50, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  noteRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  note: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500 },
  errorBox: { backgroundColor: colors.red100, borderRadius: radii.sm, paddingHorizontal: 14, paddingVertical: 10 },
  errorText: { fontFamily: fonts.body, color: colors.red600, fontSize: type.small },
  primary: { backgroundColor: colors.green700, borderRadius: radii.pill, paddingVertical: 15, alignItems: "center", minHeight: 50, justifyContent: "center" },
  primaryDisabled: { opacity: 0.6 },
  primaryLabel: { fontFamily: fonts.bodyBold, color: colors.cream50, fontSize: type.body },
  linkRow: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { fontFamily: fonts.bodyBold, color: colors.green700, fontSize: type.small },
});
