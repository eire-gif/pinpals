import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Stack } from "expo-router";

import { useAuth } from "@/lib/auth";
import {
  CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  loadPreferences,
  savePreferences,
  type Category,
  type Preferences,
} from "@/lib/notification-settings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Notification settings, in the app — the same choices as the website's
 * /dashboard/notifications, two switches per kind of alert.
 *
 * Saved as soon as a switch moves; there is no Save button to forget. A
 * failed save puts the switch back and says so.
 *
 * "This phone" switches push alerts for every device the member is signed in
 * on — the preference is per member, not per device, exactly as on the site.
 * Whether iOS lets PinPals show alerts at all is the phone's own setting.
 */
export default function NotificationSettingsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      setPrefs(await loadPreferences(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your settings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function toggle(category: Category, channel: "email" | "push", value: boolean) {
    if (!prefs || !userId) return;
    const before = prefs;
    const next = { ...prefs, [category]: { ...prefs[category], [channel]: value } };
    setPrefs(next);
    setError(null);
    try {
      await savePreferences(userId, next);
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setPrefs(before);
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Notifications", headerBackTitle: "Back" }} />
      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.green700}
            />
          }
        >
          <Text style={styles.intro}>
            Choose what PinPals tells you about. Everything still appears in Messages &amp; alerts whatever
            you choose here.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {saved ? <Text style={styles.saved}>Saved</Text> : null}

          {prefs
            ? CATEGORIES.map((category) => (
                <View key={category} style={styles.card}>
                  <Text style={styles.label}>{CATEGORY_LABELS[category]}</Text>
                  <Text style={styles.description}>{CATEGORY_DESCRIPTIONS[category]}</Text>
                  <Row
                    label="Phone alerts"
                    value={prefs[category].push}
                    onChange={(v) => void toggle(category, "push", v)}
                  />
                  <Row
                    label="Email"
                    value={prefs[category].email}
                    onChange={(v) => void toggle(category, "email", v)}
                  />
                </View>
              ))
            : null}

          <View style={[styles.card, styles.fixed]}>
            <Text style={styles.label}>Payments, refunds and disputes</Text>
            <Text style={styles.description}>
              Always sent, by email and to your phone — they're about your money, so they can't be switched
              off.
            </Text>
          </View>

          <Text style={styles.footnote}>
            If phone alerts don&apos;t arrive at all, check Settings → Notifications → PinPals on your iPhone.
          </Text>
        </ScrollView>
      )}
    </>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.green600, false: colors.line }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink500 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  saved: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  card: {
    gap: 6,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  fixed: { backgroundColor: colors.surfaceTint },
  label: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  description: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  rowLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  footnote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "center" },
});
