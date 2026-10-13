import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import Ionicons from "@expo/vector-icons/Ionicons";

import { RoleBadge } from "@/components/group-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { loadGroupContacts, type GroupContact } from "@/lib/mobile-number";
import { formatPhone, smsUrl, telUrl, whatsappUrl } from "@/lib/phone";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A group's phone numbers (0134). Only numbers people chose to share with
 * this group, and only as group_contacts() allows: the people who run it see
 * members'; members see the people who run it. Call, text or WhatsApp.
 */
export default function GroupContactsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const [rows, setRows] = useState<GroupContact[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await loadGroupContacts(groupId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <>
      <Stack.Screen options={{ title: "Phone numbers", headerBackTitle: "Back" }} />
      {failed && !rows ? (
        <LoadError onRetry={() => void load()} what="the numbers" size="screen" />
      ) : !rows ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <ScrollView style={styles.fill} contentContainerStyle={styles.body}>
          <Text style={styles.intro}>
            Numbers members chose to share with this group. The people who run it see members&apos; numbers; members see theirs.
          </Text>
          {rows.length === 0 ? (
            <StateMessage icon="call-outline" title="No numbers shared yet" body="Each member chooses, in Privacy & security, whether to share their mobile with this group." />
          ) : (
            rows.map((c) => (
              <View key={c.memberId} style={styles.card}>
                <View style={styles.top}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name}>{c.name}</Text>
                    <Text style={styles.phone}>{formatPhone(c.phone)}</Text>
                  </View>
                  <RoleBadge role={c.role} office={c.office} />
                </View>
                <View style={styles.actions}>
                  <Action icon="call" label="Call" onPress={() => void Linking.openURL(telUrl(c.phone))} />
                  <Action icon="chatbubble-ellipses" label="Text" onPress={() => void Linking.openURL(smsUrl(c.phone))} />
                  <Action icon="logo-whatsapp" label="WhatsApp" onPress={() => void Linking.openURL(whatsappUrl(c.phone))} />
                </View>
              </View>
            ))
          )}
          <Pressable style={styles.share} onPress={() => router.push("/privacy")} accessibilityRole="button">
            <Ionicons name="lock-closed-outline" size={18} color={colors.green700} />
            <Text style={styles.shareText}>Share or stop sharing my number</Text>
          </Pressable>
        </ScrollView>
      )}
    </>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={colors.green700} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  intro: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  phone: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, minHeight: 42, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.green700 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  share: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: spacing.sm },
  shareText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
