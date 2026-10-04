import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ADMIN_GROUPS, isSuperAdmin } from "@/lib/admin";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Admin — every section of the website's admin, for super admins.
 *
 * Checks the role again on open rather than trusting that the Profile row was
 * only shown to the right people: a deep link or a stale screen could land
 * anyone here. Even so, this is a convenience — each page it opens is guarded
 * on the server by requireStaff().
 */
export default function AdminScreen() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    void isSuperAdmin().then(setAllowed);
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "Admin", headerBackTitle: "Back" }} />
      {allowed === null ? (
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      ) : !allowed ? (
        <Text style={styles.denied}>The admin section is for super admins.</Text>
      ) : (
        <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            The same admin as the website, opened inside the app. Changes you make here are made on the live site and
            recorded in the audit log.
          </Text>
          {ADMIN_GROUPS.map((group) => (
            <View key={group.title} style={styles.groupWrap}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              <View style={styles.group}>
                {group.sections.map((s, i) => (
                  <Pressable
                    key={s.path}
                    style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, pressed && styles.pressed]}
                    onPress={() => router.push({ pathname: "/web", params: { path: s.path, title: s.label } })}
                    accessibilityRole="button"
                  >
                    <Ionicons name={s.icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.green700} />
                    <View style={styles.rowText}>
                      <Text style={styles.label}>{s.label}</Text>
                      {s.hint ? <Text style={styles.hint}>{s.hint}</Text> : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  spinner: { marginTop: spacing.xl },
  denied: { fontFamily: fonts.body, fontSize: 16, color: colors.ink500, padding: spacing.lg },
  intro: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: "#4c5667" },
  groupWrap: { gap: 6 },
  groupTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#4c5667",
    marginLeft: 4,
  },
  group: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 54, paddingHorizontal: 16, paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  pressed: { backgroundColor: colors.surfaceTint },
  rowText: { flex: 1 },
  label: { fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 1 },
});
