import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { StateMessage } from "@/components/state-message";
import { TintedHeader } from "@/components/tinted-header";
import { useAuth } from "@/lib/auth";
import { groupEventCards, groupForConversation, myChatAlerts, photoCount, setMyChatAlerts, type ChatGroup } from "@/lib/group-chat";
import { CHAT_ALERT_OPTIONS, type ChatAlertLevel } from "@/lib/group-chat-rules";
import { leaveGroup as leaveTheGroup, loadGroupPage } from "@/lib/groups-data";
import { conversationHeader, leaveGroup as leaveChat, type ConversationHeader } from "@/lib/messages";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A group chat's settings (0181): how loudly it alerts you, who's in it, what
 * has been shared, and leaving.
 *
 * For a Golf Buddies group or trip, the chat IS the group: its members are
 * the group's members, so leaving here leaves the group (and its chat), and
 * people are added or removed on the group's page. A group chat someone built
 * by hand keeps its own Leave.
 */
export default function ChatSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [header, setHeader] = useState<ConversationHeader | null | undefined>(undefined);
  const [group, setGroup] = useState<ChatGroup | null>(null);
  const [alerts, setAlerts] = useState<ChatAlertLevel>("all");
  const [saving, setSaving] = useState<ChatAlertLevel | null>(null);
  const [shared, setShared] = useState<{ photos: number; events: number } | null>(null);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(conversationId)) {
      setHeader(null);
      return;
    }
    try {
      const [head, g, level, photos] = await Promise.all([
        conversationHeader(conversationId, userId),
        groupForConversation(conversationId).catch(() => null),
        myChatAlerts(conversationId, userId),
        photoCount(conversationId).catch(() => 0),
      ]);
      setHeader(head);
      setGroup(g);
      setAlerts(level);
      const events = g ? (await groupEventCards(g.id, userId)).length : 0;
      setShared({ photos, events });
    } catch {
      setHeader(null);
    }
  }, [conversationId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function choose(level: ChatAlertLevel) {
    if (!userId || level === alerts) return;
    const before = alerts;
    setAlerts(level);
    setSaving(level);
    try {
      await setMyChatAlerts(conversationId, userId, level);
    } catch (err) {
      setAlerts(before);
      Alert.alert("Couldn't change that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(null);
    }
  }

  async function leave() {
    if (!userId || !header) return;
    if (group) {
      // The chat follows the group, so leaving is leaving the group.
      const page = await loadGroupPage(group.id, userId).catch(() => null);
      if (page?.myRole === "owner" && group.memberCount > 1) {
        Alert.alert("Hand it over first", "Someone has to run the group. On the group's page, tap a member and make them the owner — then you can leave.", [
          { text: "Not now", style: "cancel" },
          { text: "Open the group", onPress: () => router.push({ pathname: "/group/[id]", params: { id: String(group.id) } }) },
        ]);
        return;
      }
      Alert.alert(`Leave ${group.name}?`, "You'll leave the group and its chat. Someone in the group can invite you back.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () =>
            void leaveTheGroup(group.id)
              .then(() => router.replace("/inbox"))
              .catch((e: unknown) => Alert.alert("Couldn't leave", e instanceof Error ? e.message : "Please try again.")),
        },
      ]);
      return;
    }
    Alert.alert(`Leave ${header.otherName}?`, "You'll stop receiving messages and won't be able to read the conversation again. Whoever started it can add you back.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () =>
          void leaveChat(conversationId, userId).then((ok) => (ok ? router.replace("/inbox") : Alert.alert("Couldn't leave", "Please try again."))),
      },
    ]);
  }

  if (header === undefined) {
    return (
      <View style={styles.fill}>
        <TintedHeader color={colors.navy900} title="Chat settings" />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!header || header.kind !== "group") {
    return (
      <View style={styles.fill}>
        <TintedHeader color={colors.navy900} title="Chat settings" />
        <StateMessage icon="chatbubbles-outline" title="This chat isn't available" body="You may have left it." size="screen" />
      </View>
    );
  }

  const option = CHAT_ALERT_OPTIONS.find((o) => o.level === alerts) ?? CHAT_ALERT_OPTIONS[0];
  const members = [...header.members].sort((a, b) => Number(b.id === userId) - Number(a.id === userId) || Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));
  const shown = members.slice(0, 6);

  return (
    <View style={styles.fill}>
      <TintedHeader color={colors.navy900} title="Chat settings" subtitle={group?.name ?? header.otherName} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.section}>
          <Text style={styles.kicker} accessibilityRole="header">
            ALERTS FROM THIS CHAT
          </Text>
          <View style={styles.segments} accessibilityRole="radiogroup">
            {CHAT_ALERT_OPTIONS.map((o) => {
              const on = o.level === alerts;
              return (
                <Pressable
                  key={o.level}
                  style={[styles.segment, on && styles.segmentOn]}
                  onPress={() => void choose(o.level)}
                  disabled={saving !== null}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${o.label}. ${o.hint}`}
                >
                  {saving === o.level ? <ActivityIndicator size="small" color={colors.navy900} /> : <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{option.hint}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionTop}>
            <Text style={styles.kicker} accessibilityRole="header">{`IN THIS CHAT · ${members.length}`}</Text>
            {group ? (
              <Pressable onPress={() => router.push({ pathname: "/group/[id]", params: { id: String(group.id) } })} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>{members.length > shown.length ? "See all" : "Group page"}</Text>
              </Pressable>
            ) : null}
          </View>
          {shown.map((m) => (
            <Pressable
              key={m.id}
              style={styles.person}
              onPress={() => (m.id === userId ? undefined : router.push({ pathname: "/member/[id]", params: { id: m.id } }))}
              accessibilityRole={m.id === userId ? undefined : "button"}
            >
              <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={36} />
              <Text style={styles.personName} numberOfLines={1}>
                {m.id === userId ? `${m.name} (you)` : m.name}
              </Text>
              {m.isOwner ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{group ? "STARTED IT" : "OWNER"}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={18} color={colors.green700} />
            <Text style={styles.noteText}>
              {group
                ? `The chat is everyone in ${group.name}. Add or remove golfers on the group's page and the chat follows — new members see everything said so far.`
                : "Whoever started this chat can add people to it."}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.kicker} accessibilityRole="header">
            SHARED IN THE CHAT
          </Text>
          <View style={styles.row}>
            <Ionicons name="image-outline" size={20} color={colors.green700} />
            <Text style={styles.rowLabel}>Photos</Text>
            <Text style={styles.rowCount}>{shared ? shared.photos : "…"}</Text>
          </View>
          {group ? (
            <Pressable style={[styles.row, styles.rowLast]} onPress={() => router.push({ pathname: "/group/[id]/events", params: { id: String(group.id) } })} accessibilityRole="button">
              <Ionicons name="calendar-outline" size={20} color={colors.green700} />
              <Text style={styles.rowLabel}>{group.kind === "trip" ? "Trip events" : "Rounds & events"}</Text>
              <Text style={styles.rowCount}>{shared ? shared.events : "…"}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.ink500} />
            </Pressable>
          ) : null}
        </View>

        <Pressable style={styles.leave} onPress={() => void leave()} accessibilityRole="button">
          <Text style={styles.leaveText}>{group ? "Leave group and chat" : "Leave chat"}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: 12 },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: 10 },
  sectionTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.3, color: colors.ink500 },
  segments: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radii.md, backgroundColor: colors.cream100 },
  segment: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  segmentOn: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink500, textAlign: "center" },
  segmentTextOn: { fontFamily: fonts.bodyBold, color: colors.navy900 },
  hint: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink500 },
  link: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  person: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  personName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: "#f5e6c2" },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.8, color: "#7a5a12" },
  note: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.cream50 },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink500 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  rowCount: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  leave: { height: 50, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.red600, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  leaveText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.red600 },
});
