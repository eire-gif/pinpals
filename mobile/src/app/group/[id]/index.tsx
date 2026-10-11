import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { GroupIcon, RoleBadge, SectionTitle, membersLabel } from "@/components/group-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { GROUP_KIND_INFO, groupCan, joinState, type GroupRole, type GroupSettings } from "@/lib/groups";
import {
  canDrawFrom,
  leaveGroup,
  loadGroupPage,
  removeMember,
  requestToJoin,
  respondToInvitation,
  reviewRequest,
  setGroupMuted,
  setMemberRole,
  withdrawRequest,
  type GroupMember,
  type GroupPage,
} from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** What's on its way to a group's page, in the order it arrives (steps C–E). */
const COMING = [
  { icon: "images-outline", label: "Posts" },
  { icon: "golf-outline", label: "Tee times" },
  { icon: "calendar-outline", label: "Events" },
] as const;

/**
 * A group's page (0120).
 *
 * For a member: who's in it, the invite and chat buttons, and — for whoever
 * runs it — the join requests and each member's role. For anyone else: the
 * front page only (name, kind, size, about) and the one button that fits,
 * which joinState() in lib/groups.ts decides.
 *
 * Posts, tee times and events show as "soon": they're the next steps of the
 * groups plan (claude/groups-architecture.md), and showing where they'll be
 * tells a secretary the page is going somewhere.
 */
export default function GroupScreen() {
  const { id: rawId, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [page, setPage] = useState<GroupPage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(groupId) || groupId <= 0 || !isOn("groups")) {
      setPage(null);
      return;
    }
    try {
      setPage(await loadGroupPage(groupId, userId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /** Runs a change, then reloads; shows the database's message on failure. */
  async function act(key: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    try {
      await fn();
      after?.();
      await load();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (page === undefined && !failed) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Group", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      </View>
    );
  }
  if (failed && !page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Group", headerBackTitle: "Back" }} />
        <LoadError onRetry={() => void load()} what="this group" size="screen" />
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Group", headerBackTitle: "Back" }} />
        <StateMessage icon="people-outline" title="This group isn't available" body="It may have been deleted, or it's invite only." size="screen" />
      </View>
    );
  }

  const { group, myRole, myPending, members, requests } = page;
  const info = GROUP_KIND_INFO[group.kind];
  const settings: GroupSettings = { privacy: group.privacy, features: group.features as GroupSettings["features"], membersCanPost: true, membersCanInvite: group.membersCanInvite };
  const can = (action: Parameters<typeof groupCan>[1]) => groupCan(myRole, action, settings);
  const door = joinState({
    privacy: group.privacy,
    isMember: myRole !== null,
    invited: myPending === "invite",
    requested: myPending === "request",
    blockedByAdmin: false,
    full: group.memberCount >= info.maxMembers,
  });
  const detail = [info.label, membersLabel(group.memberCount), group.clubName].filter(Boolean).join(" · ");

  function memberMenu(m: GroupMember) {
    if (m.id === userId) return;
    const profile = { text: "View profile", onPress: () => router.push({ pathname: "/member/[id]", params: { id: m.id } }) };
    const options: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] = [profile];
    const set = (role: GroupRole, label: string) =>
      options.push({ text: label, onPress: () => void act(`role-${m.id}`, () => setMemberRole(groupId, m.id, role)) });

    if (myRole === "owner") {
      if (m.role === "member") set("admin", "Make admin");
      if (m.role === "admin") set("member", "Remove as admin");
      options.push({
        text: "Hand the group to them",
        onPress: () =>
          Alert.alert(`Hand ${group.name} to ${m.name}?`, "They'll become the owner and you'll become an admin.", [
            { text: "Cancel", style: "cancel" },
            { text: "Hand over", onPress: () => void act(`role-${m.id}`, () => setMemberRole(groupId, m.id, "owner")) },
          ]),
      });
    }
    if (myRole === "owner" || (myRole === "admin" && m.role === "member")) {
      options.push({
        text: "Remove from group",
        style: "destructive",
        onPress: () =>
          Alert.alert(`Remove ${m.name}?`, `They'll be taken out of ${group.name}.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => void act(`remove-${m.id}`, () => removeMember(groupId, m.id)) },
          ]),
      });
    }
    if (options.length === 1) {
      profile.onPress();
      return;
    }
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(m.name, undefined, options);
  }

  function leave() {
    if (myRole === "owner" && group.memberCount > 1) {
      Alert.alert("Hand it over first", "Someone has to run the group. Make another member the owner (tap their name), then you can leave — or delete the group in Settings.");
      return;
    }
    const last = myRole === "owner";
    Alert.alert(last ? `Leave and delete ${group.name}?` : `Leave ${group.name}?`, last ? "You're the only one in it, so it will be deleted." : undefined, [
      { text: "Cancel", style: "cancel" },
      { text: last ? "Delete" : "Leave", style: "destructive", onPress: () => void act("leave", () => leaveGroup(groupId), () => router.back()) },
    ]);
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: group.name, headerBackTitle: "Back" }} />
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
        <View style={styles.hero}>
          <GroupIcon kind={group.kind} size={64} />
          <Text style={styles.name} accessibilityRole="header">
            {group.name}
          </Text>
          <Text style={styles.detail}>{detail}</Text>
          {group.about ? <Text style={styles.about}>{group.about}</Text> : null}
        </View>

        {/* The one button for someone outside the group. */}
        {door === "invited" ? (
          <View style={styles.row}>
            <Pressable style={[styles.button, styles.buttonMain]} onPress={() => void act("join", () => respondToInvitation(groupId, true))} disabled={busy !== null} accessibilityRole="button">
              <Text style={styles.buttonMainText}>{busy === "join" ? "Joining…" : "Join group"}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void act("decline", () => respondToInvitation(groupId, false), () => router.back())} disabled={busy !== null} accessibilityRole="button">
              <Text style={styles.buttonText}>Decline</Text>
            </Pressable>
          </View>
        ) : door === "request" || door === "join" ? (
          <Pressable
            style={[styles.button, styles.buttonMain]}
            onPress={() =>
              void act("ask", async () => {
                const result = await requestToJoin(groupId);
                if (result === "requested") Alert.alert("Request sent", `Whoever runs ${group.name} will be told. You'll hear when you're in.`);
              })
            }
            disabled={busy !== null}
            accessibilityRole="button"
          >
            <Text style={styles.buttonMainText}>{busy === "ask" ? "Sending…" : door === "join" ? "Join group" : "Ask to join"}</Text>
          </Pressable>
        ) : door === "requested" ? (
          <View style={styles.note}>
            <Ionicons name="time-outline" size={20} color={colors.navy900} />
            <Text style={styles.noteText}>You&apos;ve asked to join. Whoever runs the group will let you in.</Text>
            <Pressable onPress={() => void act("withdraw", () => withdrawRequest(groupId))} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>Withdraw</Text>
            </Pressable>
          </View>
        ) : door === "closed" ? (
          <View style={styles.note}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.navy900} />
            <Text style={styles.noteText}>This group isn&apos;t taking new members.</Text>
          </View>
        ) : null}

        {myRole ? (
          <>
            {fresh === "1" && group.memberCount === 1 ? (
              <View style={styles.tip}>
                <Text style={styles.tipTitle}>Now bring your golfers in</Text>
                <Text style={styles.tipBody}>
                  Invite PinPals you&apos;re connected with, or share the group&apos;s link{group.kind === "society" ? " in your society's WhatsApp group" : ""} — anyone with it joins straight in.
                </Text>
              </View>
            ) : null}

            <View style={styles.row}>
              {can("invite") ? (
                <Pressable style={[styles.button, styles.buttonMain]} onPress={() => router.push({ pathname: "/group/[id]/invite", params: { id: String(groupId) } })} accessibilityRole="button">
                  <Ionicons name="person-add-outline" size={18} color={colors.cream50} />
                  <Text style={styles.buttonMainText}>Invite</Text>
                </Pressable>
              ) : null}
              {group.conversationId ? (
                <Pressable style={styles.button} onPress={() => router.push(`/conversation/${group.conversationId}`)} accessibilityRole="button">
                  <Ionicons name="chatbubbles-outline" size={18} color={colors.navy900} />
                  <Text style={styles.buttonText}>Chat</Text>
                </Pressable>
              ) : null}
              {can("edit_group") ? (
                <Pressable style={styles.button} onPress={() => router.push({ pathname: "/group/[id]/settings", params: { id: String(groupId) } })} accessibilityRole="button">
                  <Ionicons name="settings-outline" size={18} color={colors.navy900} />
                  <Text style={styles.buttonText}>Settings</Text>
                </Pressable>
              ) : null}
            </View>
            {myRole && canDrawFrom({ kind: group.kind, role: myRole }) && isOn("liveScoring") ? (
              <Pressable
                style={styles.play}
                onPress={() => router.push({ pathname: "/live/day/group", params: { group: String(groupId) } })}
                accessibilityRole="button"
                accessibilityLabel="Start a round. Draw the group into tee groups or teams and score it live."
              >
                <Ionicons name="shuffle" size={20} color={colors.navy900} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.playTitle}>Start a round</Text>
                  <Text style={styles.playHint}>Draw into groups or teams, scored live</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.navy900} />
              </Pressable>
            ) : null}
            {group.features.includes("chat") && !group.conversationId ? (
              <Text style={styles.hint}>The group chat starts once three of you are in.</Text>
            ) : null}

            <View style={styles.soon}>
              {COMING.map((c) => (
                <View key={c.label} style={styles.soonItem} accessibilityLabel={`${c.label}, coming soon`}>
                  <Ionicons name={c.icon} size={18} color={colors.ink500} />
                  <Text style={styles.soonLabel}>{c.label}</Text>
                  <Text style={styles.soonTag}>Soon</Text>
                </View>
              ))}
            </View>

            {requests.length > 0 ? (
              <>
                <SectionTitle>{`Asking to join (${requests.length})`}</SectionTitle>
                {requests.map((r) => (
                  <View key={r.id} style={styles.person}>
                    <Pressable style={styles.personMain} onPress={() => router.push({ pathname: "/member/[id]", params: { id: r.id } })} accessibilityRole="button">
                      <Avatar url={r.avatarUrl} color={r.avatarColor} name={r.name} size={40} />
                      <View style={styles.personBody}>
                        <Text style={styles.personName} numberOfLines={1}>
                          {r.name}
                        </Text>
                        {r.homeClub ? (
                          <Text style={styles.personPlace} numberOfLines={1}>
                            {r.homeClub}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    <Pressable style={[styles.pill, styles.pillMain]} onPress={() => void act(`ok-${r.id}`, () => reviewRequest(groupId, r.id, true))} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`Approve ${r.name}`}>
                      <Text style={styles.pillMainText}>Approve</Text>
                    </Pressable>
                    <Pressable style={styles.pill} onPress={() => void act(`no-${r.id}`, () => reviewRequest(groupId, r.id, false))} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`Decline ${r.name}`}>
                      <Text style={styles.pillText}>Decline</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}

            <SectionTitle>{`Members (${members.length})`}</SectionTitle>
            {members.map((m) => (
              <Pressable key={m.id} style={styles.person} onPress={() => memberMenu(m)} accessibilityRole="button" accessibilityLabel={`${m.name}${m.role !== "member" ? `, ${m.role}` : ""}`}>
                <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={40} />
                <View style={styles.personBody}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {m.id === userId ? `${m.name} (you)` : m.name}
                  </Text>
                  {m.homeClub ? (
                    <Text style={styles.personPlace} numberOfLines={1}>
                      {m.homeClub}
                    </Text>
                  ) : null}
                </View>
                <RoleBadge role={m.role} />
              </Pressable>
            ))}

            <View style={styles.setting}>
              <View style={styles.settingBody}>
                <Text style={styles.settingTitle}>Mute this group</Text>
                <Text style={styles.settingHint}>No alerts about join requests or activity here.</Text>
              </View>
              <Switch value={page.muted} onValueChange={(v) => void act("mute", () => setGroupMuted(groupId, v))} accessibilityLabel="Mute this group" />
            </View>

            <Pressable style={styles.leave} onPress={leave} accessibilityRole="button">
              <Text style={styles.leaveText}>Leave group</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  hero: { alignItems: "center", gap: 6, paddingVertical: spacing.md },
  name: { fontFamily: fonts.display, fontSize: 26, color: colors.ink900, textAlign: "center", marginTop: spacing.xs },
  detail: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, textAlign: "center" },
  about: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, textAlign: "center", marginTop: spacing.xs, lineHeight: 22 },
  row: { flexDirection: "row", gap: spacing.sm },
  button: {
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
  buttonMain: { backgroundColor: colors.green700, borderColor: colors.green700 },
  buttonText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.navy900 },
  buttonMainText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  play: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.gold400,
  },
  playTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  playHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.navy900 },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.cream100,
  },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  tip: { padding: spacing.md, borderRadius: radii.lg, backgroundColor: "#f6ead0", borderWidth: 1, borderColor: colors.gold400, gap: 4 },
  tipTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  tipBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 20 },
  soon: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  soonItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
  },
  soonLabel: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink500 },
  soonTag: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  personMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  personBody: { flex: 1, gap: 1 },
  personName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  personPlace: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  pill: { paddingHorizontal: 12, height: 36, borderRadius: radii.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.navy900 },
  pillMain: { backgroundColor: colors.navy900 },
  pillText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  pillMainText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  setting: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  settingBody: { flex: 1, gap: 2 },
  settingTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  settingHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  leave: { alignItems: "center", paddingVertical: spacing.md },
  leaveText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.red600 },
});
