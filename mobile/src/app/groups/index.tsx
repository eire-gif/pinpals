import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GroupRow, SectionTitle, membersLabel } from "@/components/group-bits";
import { GuideLink } from "@/components/guide-bits";
import { ScreenHeader } from "@/components/screen-header";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { GROUP_KIND_INFO } from "@/lib/groups";
import { loadMyGroups, respondToInvitation, type MyGroups } from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Your groups (0120): invitations waiting on you, the groups you're in, and
 * the societies you've asked to join. Reached from the menu (Members →
 * Groups) and Home's strip. Creating a group and finding a society start here.
 */
export default function GroupsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [data, setData] = useState<MyGroups | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [answering, setAnswering] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!userId || !isOn("groups")) return;
    try {
      setData(await loadMyGroups(userId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function answer(groupId: number, accept: boolean) {
    setAnswering(groupId);
    try {
      await respondToInvitation(groupId, accept);
      if (accept) router.push({ pathname: "/group/[id]", params: { id: String(groupId) } });
      await load();
    } catch (err) {
      Alert.alert("Couldn't answer", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setAnswering(null);
    }
  }

  const header = (
    <>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <ScreenHeader scene="coastAerial" title="Your groups" subtitle="Crews, trips and societies" />
    </>
  );

  if (!isOn("groups")) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="people-outline" title="Groups are on their way" body="Crews, trips and societies are coming to PinPals soon." size="screen" />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {header}
      {data === null && !failed ? (
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      ) : failed && data === null ? (
        <LoadError onRetry={() => void load()} what="your groups" size="screen" />
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          <View style={styles.actions}>
            <Pressable style={[styles.action, styles.actionMain]} onPress={() => router.push("/groups/new")} accessibilityRole="button">
              <Ionicons name="add" size={20} color={colors.cream50} />
              <Text style={styles.actionMainText}>Start a group</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => router.push("/groups/find")} accessibilityRole="button">
              <Ionicons name="search" size={18} color={colors.navy900} />
              <Text style={styles.actionText}>Find a society</Text>
            </Pressable>
          </View>

          <GuideLink id="society" />

          {data && data.invitations.length > 0 ? (
            <>
              <SectionTitle>Invitations</SectionTitle>
              {data.invitations.map((g) => (
                <View key={g.id} style={styles.invite}>
                  <GroupRow
                    kind={g.kind}
                    logoUrl={g.logoUrl}
                    name={g.name}
                    detail={`${g.invitedBy ? `${g.invitedBy} invited you · ` : ""}${GROUP_KIND_INFO[g.kind].label} · ${membersLabel(g.memberCount)}`}
                    onPress={() => router.push({ pathname: "/group/[id]", params: { id: String(g.id) } })}
                  />
                  <View style={styles.inviteButtons}>
                    <Pressable style={[styles.small, styles.smallMain]} onPress={() => void answer(g.id, true)} disabled={answering === g.id} accessibilityRole="button" accessibilityLabel={`Join ${g.name}`}>
                      {answering === g.id ? <ActivityIndicator size="small" color={colors.cream50} /> : <Text style={styles.smallMainText}>Join</Text>}
                    </Pressable>
                    <Pressable style={styles.small} onPress={() => void answer(g.id, false)} disabled={answering === g.id} accessibilityRole="button" accessibilityLabel={`Decline ${g.name}`}>
                      <Text style={styles.smallText}>Decline</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          <SectionTitle>Your groups</SectionTitle>
          {data && data.groups.length > 0 ? (
            <View style={styles.list}>
              {data.groups.map((g) => (
                <GroupRow
                  key={g.id}
                  kind={g.kind}
                  logoUrl={g.logoUrl}
                  name={g.name}
                  detail={`${GROUP_KIND_INFO[g.kind].label} · ${membersLabel(g.memberCount)}${g.role === "owner" ? " · you run it" : g.role === "admin" ? " · admin" : ""}`}
                  onPress={() => router.push({ pathname: "/group/[id]", params: { id: String(g.id) } })}
                />
              ))}
            </View>
          ) : (
            <StateMessage
              icon="people-outline"
              title="Start your first group"
              body="Bring your fourball, your golf trip or your society together in one place."
            />
          )}

          {data && data.requested.length > 0 ? (
            <>
              <SectionTitle>Waiting to hear back</SectionTitle>
              <View style={styles.list}>
                {data.requested.map((g) => (
                  <GroupRow
                    key={g.id}
                    kind={g.kind}
                    logoUrl={g.logoUrl}
                    name={g.name}
                    detail="You asked to join"
                    onPress={() => router.push({ pathname: "/group/[id]", params: { id: String(g.id) } })}
                  />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  body: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: {
    flex: 1,
    height: 46,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
  },
  actionMain: { backgroundColor: colors.green700, borderColor: colors.green700 },
  actionText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.navy900 },
  actionMainText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  list: { gap: spacing.sm },
  invite: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: "#f6ead0",
    borderWidth: 1,
    borderColor: colors.gold400,
  },
  inviteButtons: { flexDirection: "row", gap: spacing.sm },
  small: {
    flex: 1,
    height: 44,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
  },
  smallMain: { backgroundColor: colors.navy900 },
  smallText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.navy900 },
  smallMainText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
