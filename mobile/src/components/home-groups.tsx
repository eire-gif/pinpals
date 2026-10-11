import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GroupIcon } from "@/components/group-bits";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadMyGroups, type MyGroups } from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Home's groups strip (0120). Shows only when there's something to show —
 * an invitation waiting, or groups you're in — like the rest of Home's
 * "only what is waiting" rows (claude/app-home-tab.md). A member in no
 * groups sees nothing here; the menu is where they start one.
 */
export function HomeGroups() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [data, setData] = useState<MyGroups | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId || !isOn("groups")) return;
      void loadMyGroups(userId)
        .then(setData)
        .catch(() => setData(null));
    }, [userId])
  );

  if (!data || (data.invitations.length === 0 && data.groups.length === 0)) return null;

  const invites = data.invitations.length;
  const shown = data.groups.slice(0, 4);

  return (
    <View style={styles.wrap}>
      {invites > 0 ? (
        <Pressable style={styles.invite} onPress={() => router.push("/groups")} accessibilityRole="button">
          <Ionicons name="mail-unread-outline" size={20} color={colors.navy900} />
          <Text style={styles.inviteText}>
            {invites === 1 ? `You're invited to ${data.invitations[0].name}` : `You're invited to ${invites} groups`}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.navy900} />
        </Pressable>
      ) : null}

      {shown.length > 0 ? (
        <Pressable style={styles.groups} onPress={() => router.push("/groups")} accessibilityRole="button" accessibilityLabel="Your groups">
          <View style={styles.icons}>
            {shown.map((g, i) => (
              <View key={g.id} style={[styles.iconSlot, { marginLeft: i === 0 ? 0 : -10 }]}>
                <GroupIcon kind={g.kind} size={34} />
              </View>
            ))}
          </View>
          <View style={styles.groupsBody}>
            <Text style={styles.groupsTitle}>Your groups</Text>
            <Text style={styles.groupsDetail} numberOfLines={1}>
              {data.groups.map((g) => g.name).join(" · ")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  invite: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: "#f6ead0",
    borderWidth: 1,
    borderColor: colors.gold400,
  },
  inviteText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.navy900 },
  groups: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  icons: { flexDirection: "row" },
  iconSlot: { borderRadius: 12, borderWidth: 2, borderColor: colors.surface },
  groupsBody: { flex: 1, gap: 2 },
  groupsTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  groupsDetail: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
});
