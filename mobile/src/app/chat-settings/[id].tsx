import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { GroupPastResults } from "@/components/group-past-results";
import { StateMessage } from "@/components/state-message";
import { TintedHeader } from "@/components/tinted-header";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { groupEventCards, groupForConversation, myChatAlerts, nextUp, photoCount, setMyChatAlerts, type ChatGroup, type GroupEventCard } from "@/lib/group-chat";
import { CHAT_ALERT_OPTIONS, groupLine, type ChatAlertLevel } from "@/lib/group-chat-rules";
import { leaveGroup as leaveTheGroup, loadGroupPage, type GroupPage } from "@/lib/groups-data";
import { conversationHeader, leaveGroup as leaveChat, type ConversationHeader } from "@/lib/messages";
import { irishToday, outingDateLabel } from "@/lib/outing-rules";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Group info (31 Oct 2026, approved mock-up "Group info · tap the chat
 * name"): what opens when you tap a group chat's name or •••. It started as
 * Chat settings (0181) and keeps all of that — alerts, who's in it, what's
 * been shared, Leave — but leads with the golf: your role, Start round,
 * Events, Invite, the next outing, handicaps beside names, and results.
 *
 * For a Golf Buddies group or trip the chat IS the group: its members are
 * the group's members, so leaving here leaves the group (and its chat), and
 * people are added or removed on the group's page. A group chat someone
 * built by hand keeps a plain version: members, photos, alerts, Leave.
 */
const GOLD_TEXT = "#8a6614";
const GOLD_SOFT = "#f4ebd6";

type Hcp = Map<string, number>;

export default function GroupInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [header, setHeader] = useState<ConversationHeader | null | undefined>(undefined);
  const [group, setGroup] = useState<ChatGroup | null>(null);
  const [page, setPage] = useState<GroupPage | null>(null);
  const [next, setNext] = useState<GroupEventCard | null>(null);
  const [alerts, setAlerts] = useState<ChatAlertLevel>("all");
  const [saving, setSaving] = useState<ChatAlertLevel | null>(null);
  const [shared, setShared] = useState<{ photos: number; events: number } | null>(null);
  const [hcp, setHcp] = useState<Hcp>(new Map());

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
      let events: GroupEventCard[] = [];
      if (g) {
        const [cards, p] = await Promise.all([groupEventCards(g.id, userId).catch(() => []), loadGroupPage(g.id, userId).catch(() => null)]);
        events = cards;
        setPage(p);
        setNext(nextUp(cards, irishToday()));
      }
      setShared({ photos, events: events.length });
      // Handicaps beside names — only where the member shows theirs.
      const ids = (head?.members ?? []).map((m) => m.id);
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id, handicap, handicap_visible").in("id", ids);
        const map: Hcp = new Map();
        for (const r of (data ?? []) as { id: string; handicap: number | null; handicap_visible: boolean | null }[]) {
          if (r.handicap != null && (r.handicap_visible !== false || r.id === userId)) map.set(r.id, Number(r.handicap));
        }
        setHcp(map);
      }
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
        <TintedHeader color={colors.navy900} title="Group info" />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!header || header.kind !== "group") {
    return (
      <View style={styles.fill}>
        <TintedHeader color={colors.navy900} title="Group info" />
        <StateMessage icon="chatbubbles-outline" title="This chat isn't available" body="You may have left it." size="screen" />
      </View>
    );
  }

  const today = irishToday();
  const gid = group?.id ?? null;
  const go = (pathname: string, extra: Record<string, string> = {}) =>
    gid != null ? router.push({ pathname, params: { id: String(gid), ...extra } } as unknown as Href) : undefined;

  // Who's who: captain and secretary (societies), whoever runs it, then you.
  const roleOf = (memberId: string): { label: string; fg: string; bg: string } | null => {
    const m = page?.members.find((x) => x.id === memberId);
    if (m?.office === "captain") return { label: "Captain", fg: colors.navy900, bg: colors.gold500 };
    if (m?.office === "secretary") return { label: "Secretary", fg: colors.cream50, bg: colors.navy900 };
    if (m?.role === "owner") return { label: group?.kind === "trip" ? "Organiser" : "Started it", fg: colors.navy900, bg: colors.gold500 };
    if (m?.role === "admin") return { label: "Admin", fg: colors.green700, bg: colors.green100 };
    if (!page && header.members.find((x) => x.id === memberId)?.isOwner) return { label: "Owner", fg: colors.navy900, bg: colors.gold500 };
    return null;
  };
  const rank = (memberId: string) => {
    const r = roleOf(memberId)?.label;
    return r === "Captain" ? 0 : r === "Secretary" ? 1 : r ? 2 : 3;
  };
  const members = [...header.members].sort((a, b) => Number(b.id === userId) - Number(a.id === userId) || rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  const shown = members.slice(0, 6);
  const myRole = userId ? roleOf(userId) : null;
  const organiser = page?.myRole === "owner" || page?.myRole === "admin" || page?.myOffice != null;
  const option = CHAT_ALERT_OPTIONS.find((o) => o.level === alerts) ?? CHAT_ALERT_OPTIONS[0];
  const logo = page?.group.logoUrl ?? null;
  const club = page?.group.clubName ?? null;
  const kindLine = group ? groupLine(group, today) : `${members.length} members`;

  const invite = () => {
    if (gid == null) return;
    if (organiser || page?.group.membersCanInvite) {
      go("/group/[id]/invite");
      return;
    }
    void Share.share({ message: `Join ${group?.name ?? "us"} on PinPals: ${SITE_URL}/groups/${gid}` });
  };

  const quick: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }[] = group
    ? [
        { key: "round", label: "Start round", icon: "flag-outline", onPress: () => router.push({ pathname: "/live/day/group", params: { group: String(group.id) } } as unknown as Href) },
        { key: "events", label: group.kind === "trip" ? "Trip days" : "Events", icon: "calendar-outline", onPress: () => go("/group/[id]/events") },
        { key: "invite", label: "Invite", icon: "share-outline", onPress: invite },
        { key: "page", label: "Group page", icon: "people-outline", onPress: () => go("/group/[id]") },
      ]
    : [];

  return (
    <View style={styles.fill}>
      <TintedHeader color={colors.navy900} title="Group info" />
      <ScrollView contentContainerStyle={styles.body}>
        {/* The navy band runs on from the bar: badge, name, what it is, your role. */}
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            {logo ? (
              <Image source={{ uri: logo }} style={styles.heroLogo} accessibilityIgnoresInvertColors />
            ) : (
              <Ionicons name={group?.kind === "trip" ? "airplane" : group?.kind === "society" ? "trophy-outline" : "flag-outline"} size={40} color={colors.cream50} />
            )}
          </View>
          <Text style={styles.heroName} accessibilityRole="header">{group?.name ?? header.otherName}</Text>
          <Text style={styles.heroLine}>{[kindLine, club].filter(Boolean).join(" · ")}</Text>
          {myRole ? (
            <View style={styles.heroChips}>
              <View style={[styles.heroChip, { backgroundColor: colors.gold500 }]}>
                <Text style={[styles.heroChipText, { color: colors.navy900 }]}>{`You're ${myRole.label === "Started it" ? "the organiser" : myRole.label}`}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {quick.length ? (
          <View style={styles.quick}>
            {quick.map((q) => (
              <Pressable key={q.key} style={({ pressed }) => [styles.quickTile, pressed && { opacity: 0.8 }]} onPress={q.onPress} accessibilityRole="button">
                <Ionicons name={q.icon} size={24} color={colors.green600} />
                <Text style={styles.quickText} numberOfLines={1} adjustsFontSizeToFit>{q.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {group && next ? (
          <View style={styles.card}>
            <View style={styles.nextTop}>
              <Text style={styles.nextKicker}>{group.kind === "trip" && next.outingKind !== "day" ? "NEXT ON THE TRIP" : "NEXT OUTING"}</Text>
              {next.mine ? <Text style={styles.nextIn}>You&apos;re in</Text> : null}
            </View>
            <View style={styles.nextBody}>
              <View style={styles.nextDate}>
                <Text style={styles.nextMonth}>{outingDateLabel(next.playsOn).split(" ")[2]?.toUpperCase()}</Text>
                <Text style={styles.nextDay}>{outingDateLabel(next.playsOn).split(" ")[1]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.nextTitle} numberOfLines={1}>{next.title}</Text>
                <Text style={styles.nextSub} numberOfLines={1}>{[next.courseName ?? next.location, next.firstTee ? `1st tee ${next.firstTee.slice(0, 5)}` : null].filter(Boolean).join(" · ")}</Text>
                <Text style={styles.nextSub}>{`${next.entrants.length} in${next.maxEntries ? ` of ${next.maxEntries}` : ""}`}</Text>
              </View>
            </View>
            <View style={styles.nextButtons}>
              <Pressable
                style={[styles.nextBtn, styles.nextBtnMain]}
                onPress={() =>
                  next.outingKind === "day"
                    ? go("/group/[id]/outing/[outingId]", { outingId: String(next.id) })
                    : go("/group/[id]/itinerary/[outingId]", { outingId: String(next.id) })
                }
                accessibilityRole="button"
              >
                <Text style={[styles.nextBtnText, { color: colors.cream50 }]}>{next.outingKind === "day" ? "View outing" : "Itinerary"}</Text>
              </Pressable>
              <Pressable style={styles.nextBtn} onPress={() => go("/group/[id]/events")} accessibilityRole="button">
                <Text style={styles.nextBtnText}>All events</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionHead} accessibilityRole="header">{`${members.length} members`}</Text>
        <View style={styles.card}>
          {group && organiser ? (
            <Pressable style={styles.row} onPress={() => go("/group/[id]/invite")} accessibilityRole="button">
              <View style={styles.rowIcon}><Ionicons name="add" size={22} color={colors.green700} /></View>
              <Text style={[styles.rowLabel, styles.rowBold]}>Add members</Text>
            </Pressable>
          ) : null}
          {shown.map((m) => {
            const role = roleOf(m.id);
            const h = hcp.get(m.id);
            return (
              <Pressable
                key={m.id}
                style={styles.row}
                onPress={() => (m.id === userId ? undefined : router.push({ pathname: "/member/[id]", params: { id: m.id } }))}
                accessibilityRole={m.id === userId ? undefined : "button"}
              >
                <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.personName} numberOfLines={1}>{m.id === userId ? "You" : m.name}</Text>
                  {h != null ? <Text style={styles.personSub}>{`HCP ${h.toFixed(1)}`}</Text> : null}
                </View>
                {role ? (
                  <View style={[styles.role, { backgroundColor: role.bg }]}>
                    <Text style={[styles.roleText, { color: role.fg }]}>{role.label}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {members.length > shown.length && group ? (
            <Pressable style={[styles.row, styles.rowLast]} onPress={() => go("/group/[id]")} accessibilityRole="button">
              <Text style={[styles.rowLabel, styles.rowBold]}>{`See all ${members.length}`}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionHead} accessibilityRole="header">Media</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="image-outline" size={22} color={colors.navy900} />
            <Text style={styles.rowLabel}>Photos</Text>
            <Text style={styles.rowCount}>{shared ? shared.photos : "…"}</Text>
          </View>
          {group ? (
            <Pressable style={[styles.row, styles.rowLast]} onPress={() => go("/group/[id]/events")} accessibilityRole="button">
              <Ionicons name="calendar-outline" size={22} color={colors.navy900} />
              <Text style={styles.rowLabel}>{group.kind === "trip" ? "Trip events" : "Rounds & events"}</Text>
              <Text style={styles.rowCount}>{shared ? shared.events : "…"}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
            </Pressable>
          ) : null}
        </View>

        {/* Results: the group's published competitions (0138). Draws nothing when there are none. */}
        {gid != null ? <GroupPastResults groupId={gid} /> : null}

        <Text style={styles.sectionHead} accessibilityRole="header">Settings</Text>
        <View style={[styles.card, styles.cardPad]}>
          <Text style={styles.kicker}>ALERTS FROM THIS CHAT</Text>
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
        {group ? (
          <View style={styles.card}>
            {organiser ? (
              <Pressable style={styles.row} onPress={() => go("/group/[id]/settings")} accessibilityRole="button">
                <Ionicons name="shield-outline" size={22} color={colors.navy900} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabelPlain}>Group settings</Text>
                  <Text style={styles.personSub}>Who can invite, privacy, features</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              </Pressable>
            ) : null}
            <Pressable style={[styles.row, styles.rowLast]} onPress={() => go("/group/[id]")} accessibilityRole="button">
              <Ionicons name="people-outline" size={22} color={colors.navy900} />
              <Text style={styles.rowLabel}>{group.kind === "society" ? "Open society page" : "Open group page"}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
            </Pressable>
          </View>
        ) : null}

        <Pressable style={styles.leave} onPress={() => void leave()} accessibilityRole="button">
          <Text style={styles.leaveText}>{group ? (group.kind === "society" ? "Leave society" : "Leave group and chat") : "Leave chat"}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { paddingBottom: spacing.xl * 2, gap: 12 },

  hero: { backgroundColor: colors.navy900, alignItems: "center", paddingTop: 6, paddingBottom: 24, paddingHorizontal: spacing.md, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroBadge: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.green600, borderWidth: 3, borderColor: colors.gold500, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  heroLogo: { width: "100%", height: "100%" },
  heroName: { marginTop: 12, fontFamily: fonts.display, fontSize: 27, lineHeight: 32, color: colors.cream50, textAlign: "center" },
  heroLine: { marginTop: 4, fontFamily: fonts.body, fontSize: 15, color: "#c9d2de", textAlign: "center" },
  heroChips: { marginTop: 10, flexDirection: "row", gap: 8 },
  heroChip: { borderRadius: 12, paddingHorizontal: 11, paddingVertical: 5 },
  heroChipText: { fontFamily: fonts.bodyBold, fontSize: 13 },

  quick: { flexDirection: "row", gap: 8, paddingHorizontal: spacing.md, paddingTop: 4 },
  quickTile: { flex: 1, minHeight: 82, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 4 },
  quickText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },

  card: { marginHorizontal: spacing.md, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: spacing.md, overflow: "hidden" },
  cardPad: { paddingVertical: spacing.md, gap: 10 },
  sectionHead: { marginTop: 8, paddingHorizontal: spacing.md + 4, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink500 },

  nextTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginHorizontal: -spacing.md, paddingHorizontal: spacing.md, paddingVertical: 12, backgroundColor: GOLD_SOFT, borderBottomWidth: 1, borderBottomColor: colors.line },
  nextKicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: GOLD_TEXT },
  nextIn: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },
  nextBody: { flexDirection: "row", gap: 14, alignItems: "center", paddingVertical: 14 },
  nextDate: { width: 56, height: 60, borderRadius: 12, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  nextMonth: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.gold500 },
  nextDay: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 26, color: colors.cream50 },
  nextTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  nextSub: { marginTop: 2, fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
  nextButtons: { flexDirection: "row", gap: 8, paddingBottom: 14 },
  nextBtn: { flex: 1, minHeight: 46, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  nextBtnMain: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  nextBtnText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },

  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  rowLabelPlain: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  rowBold: { fontFamily: fonts.bodySemi },
  rowCount: { fontFamily: fonts.body, fontSize: 15, color: colors.ink500 },
  personName: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink900 },
  personSub: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500 },
  role: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  roleText: { fontFamily: fonts.bodyBold, fontSize: 12 },

  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.3, color: colors.ink500 },
  segments: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radii.md, backgroundColor: colors.cream100 },
  segment: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  segmentOn: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink500, textAlign: "center" },
  segmentTextOn: { fontFamily: fonts.bodyBold, color: colors.navy900 },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink500 },

  leave: { marginHorizontal: spacing.md, height: 50, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.red600, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  leaveText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.red600 },
});
