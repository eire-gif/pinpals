import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { DateSheet, dateToIso, dayLabel } from "@/components/date-sheet";
import { Button, Card, Kicker } from "@/components/society-bits";
import { PROVINCES, type Province } from "@/lib/matchplay";
import { shareOpen } from "@/lib/matchplay-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Share an open (0148): the club, the day, what it is, the fee and the
 * club's own booking link. It shows as "Shared by a member" until PinPals
 * marks it as posted by the club.
 */
export default function ShareOpenScreen() {
  const router = useRouter();
  const [club, setClub] = useState<{ id: number; name: string } | null>(null);
  const [date, setDate] = useState(dateToIso(new Date(Date.now() + 7 * 86_400_000)));
  const [dateOpen, setDateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [fee, setFee] = useState("");
  const [url, setUrl] = useState("");
  const [province, setProvince] = useState<Province | null>(null);
  const [saving, setSaving] = useState(false);

  const link = url.trim();
  const problem = !club
    ? "Choose the club running it."
    : title.trim().length < 3
      ? "Say what it is, like Fourball open."
      : link && !/^https:\/\/\S+$/.test(link)
        ? "The booking link should start with https://"
        : null;

  async function save() {
    if (problem || !club) return;
    setSaving(true);
    try {
      await shareOpen({ clubId: club.id, playsOn: date, title: title.trim(), entryFee: fee.trim() || null, bookingUrl: link || null, province });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't share it", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: "Share an open", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Card>
          <Kicker>The club</Kicker>
          {club ? (
            <Pressable style={styles.picker} onPress={() => setClub(null)} accessibilityRole="button" accessibilityLabel={`${club.name}. Change the club`}>
              <Ionicons name="golf-outline" size={18} color={colors.navy900} />
              <Text style={[styles.pickerText, { flex: 1 }]}>{club.name}</Text>
              <Ionicons name="close" size={18} color={colors.ink500} />
            </Pressable>
          ) : (
            <CourseSearch placeholder="Search for the club" onPick={(c) => setClub({ id: c.id, name: c.name })} />
          )}
          <Text style={styles.label}>Province</Text>
          <View style={styles.chips}>
            {PROVINCES.map((p) => {
              const on = province === p.id;
              return (
                <Pressable key={p.id} onPress={() => setProvince(on ? null : p.id)} style={[styles.pick, on && styles.pickOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.pickText, on && styles.pickTextOn]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card>
          <Kicker>The open</Kicker>
          <Pressable style={styles.picker} onPress={() => setDateOpen(true)} accessibilityRole="button" accessibilityLabel={`Date, ${dayLabel(date)}`}>
            <Ionicons name="calendar-outline" size={18} color={colors.navy900} />
            <Text style={styles.pickerText}>{dayLabel(date)}</Text>
          </Pressable>
          <Text style={styles.label}>What is it?</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Fourball open, stableford" placeholderTextColor={colors.ink500} maxLength={80} accessibilityLabel="What the competition is" />
          <Text style={styles.label}>Entry fee (optional)</Text>
          <TextInput style={styles.input} value={fee} onChangeText={setFee} placeholder="€60 per pair" placeholderTextColor={colors.ink500} maxLength={40} accessibilityLabel="Entry fee" />
          <Text style={styles.label}>Booking link (optional)</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            placeholderTextColor={colors.ink500}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={500}
            accessibilityLabel="The club's booking link"
          />
          <Text style={styles.small}>The club's own page for entering, usually on its booking system. Members book and pay there.</Text>
        </Card>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Button label="Share it" busy={saving} disabled={!!problem} onPress={() => void save()} />
      </ScrollView>
      <DateSheet open={dateOpen} title="Date of the open" value={date} maxDaysAhead={365} onClose={() => setDateOpen(false)} onChange={setDate} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  label: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, lineHeight: 18 },
  input: { minHeight: 48, paddingHorizontal: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.line, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.cream50 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pick: { minHeight: 44, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  pickOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  pickText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  pickTextOn: { color: colors.cream50 },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickerText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  problem: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.red600 },
});
