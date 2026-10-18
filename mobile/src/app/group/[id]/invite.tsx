import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { shareVia, type ShareChannel } from "@/lib/find-pinpals";
import { GROUP_KIND_INFO } from "@/lib/groups";
import { getGroupInviteCode, groupInviteUrl, inviteToGroup, loadGroupPage, resetGroupInviteCode, type GroupPage } from "@/lib/groups-data";
import { listConnections, listMembers, memberPlace, type Member } from "@/lib/members";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Inviting people to a group (0120), two ways:
 *
 *   THE LINK, at the top, because for a society it's the main way: the
 *   secretary drops it in the society's WhatsApp group and everyone who taps
 *   it joins straight in — no connections needed, no queue.
 *
 *   YOUR CONNECTIONS, below: tick them and they get an invitation to accept.
 *   Anyone already in the group isn't listed. invite_to_group() skips anyone
 *   it can't invite (blocked, gone) rather than failing the whole list.
 *
 *   FIND PINPALS (0122), for whoever runs the group: search every member,
 *   not just connections, and invite them. They still have to accept. The
 *   group page's "Find PinPals" button opens this screen on that tab.
 */
export default function InviteToGroupScreen() {
  const { id: rawId, find } = useLocalSearchParams<{ id: string; find?: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [page, setPage] = useState<GroupPage | null>(null);
  const [people, setPeople] = useState<Member[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"connections" | "find">(find === "1" ? "find" : "connections");
  const [found, setFound] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [groupPage, { accepted }] = await Promise.all([loadGroupPage(groupId, userId), listConnections(userId)]);
      setPage(groupPage);
      const inGroup = new Set((groupPage?.members ?? []).map((m) => m.id));
      setPeople(accepted.filter((m) => !inGroup.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "en-IE")));
      setCode(await getGroupInviteCode(groupId).catch(() => null));
    } finally {
      setLoading(false);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const inGroup = useMemo(() => new Set((page?.members ?? []).map((m) => m.id)), [page]);
  const canManage = page?.myRole === "owner" || page?.myRole === "admin";
  const finding = mode === "find" && canManage;

  // Find PinPals: the whole membership, searched as you type (newest first
  // when the box is empty, like the directory).
  useEffect(() => {
    if (!finding || !userId) return;
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      void listMembers(userId, "everyone", query)
        .then((d) => {
          if (live) setFound(d.members.filter((m) => !inGroup.has(m.id)));
        })
        .catch(() => {
          if (live) setFound([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [finding, userId, query, inGroup]);

  const visible = useMemo(() => {
    if (finding) return found;
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return people;
    return people.filter((m) => {
      const haystack = [m.name, m.homeClub, m.county].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [people, query, finding, found]);

  const groupName = page?.group.name ?? "our group";
  const kindWord = page && page.group.kind !== "crew" ? GROUP_KIND_INFO[page.group.kind].label.toLowerCase() : "group";
  const message = code
    ? `Join ${groupName} on PinPals — our ${kindWord}, with live scoring for our rounds. Tap to join: ${groupInviteUrl(code)}`
    : "";

  async function share(channel: ShareChannel) {
    if (!code) return;
    await shareVia(channel, message);
  }

  function reset() {
    Alert.alert("Reset the invite link?", "The old link stops working. Anyone who already joined stays in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: () =>
          void resetGroupInviteCode(groupId)
            .then(setCode)
            .catch((err: unknown) => Alert.alert("Couldn't reset", err instanceof Error ? err.message : "Please try again.")),
      },
    ]);
  }

  async function send() {
    if (chosen.size === 0) return;
    setSending(true);
    try {
      const sent = await inviteToGroup(groupId, [...chosen]);
      Alert.alert(sent === 1 ? "Invitation sent" : `${sent} invitations sent`, sent === 0 ? "They've already been invited, or can't be added." : "They'll get a notification to join.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      Alert.alert("Couldn't invite", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSending(false);
    }
  }


  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Invite", headerBackTitle: "Back" }} />
      {loading ? (
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View style={styles.head}>
              {code ? (
                <View style={styles.linkCard}>
                  <Text style={styles.linkTitle}>Share the group&apos;s link</Text>
                  <Text style={styles.linkBody}>Anyone who taps it joins {groupName} straight away — they don&apos;t need to be connected with you.</Text>
                  <Text style={styles.linkUrl} selectable numberOfLines={1}>
                    {groupInviteUrl(code)}
                  </Text>
                  <View style={styles.shareRow}>
                    <Pressable style={[styles.share, styles.whatsapp]} onPress={() => void share("whatsapp")} accessibilityRole="button" accessibilityLabel="Share on WhatsApp">
                      <Ionicons name="logo-whatsapp" size={18} color="#ffffff" />
                      <Text style={styles.shareMainText}>WhatsApp</Text>
                    </Pressable>
                    <Pressable style={styles.share} onPress={() => void share("sms")} accessibilityRole="button" accessibilityLabel="Share by text">
                      <Ionicons name="chatbubble-outline" size={17} color={colors.navy900} />
                      <Text style={styles.shareText}>Text</Text>
                    </Pressable>
                    <Pressable style={styles.share} onPress={() => void share("more")} accessibilityRole="button" accessibilityLabel="More ways to share">
                      <Ionicons name="share-outline" size={17} color={colors.navy900} />
                      <Text style={styles.shareText}>More</Text>
                    </Pressable>
                  </View>
                  {canManage ? (
                    <Pressable onPress={reset} accessibilityRole="button" hitSlop={8}>
                      <Text style={styles.reset}>Reset link</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {canManage ? (
                <View style={styles.tabs} accessibilityRole="tablist">
                  {(["connections", "find"] as const).map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.tab, mode === m && styles.tabOn]}
                      onPress={() => {
                        setMode(m);
                        setQuery("");
                      }}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: mode === m }}
                    >
                      <Ionicons name={m === "find" ? "search" : "people-outline"} size={16} color={mode === m ? colors.cream50 : colors.navy900} />
                      <Text style={[styles.tabText, mode === m && styles.tabTextOn]}>{m === "find" ? "Find PinPals" : "Your PinPals"}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.section}>Or invite your connections</Text>
              )}
              {finding ? <Text style={styles.findHint}>Search every PinPals member by name or club. They get an invitation to accept.</Text> : null}
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={17} color={colors.ink500} />
                <TextInput
                  style={styles.search}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={finding ? "Search all members" : "Search your connections"}
                  placeholderTextColor={colors.ink500}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                  accessibilityLabel={finding ? "Search all members" : "Search your connections"}
                />
              </View>
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {finding ? (searching ? "Searching…" : query.trim() ? "Nobody by that name — or they're already in." : "") : query.trim() ? "Nobody by that name." : people.length === 0 ? "Everyone you're connected with is already in, or you have no connections yet — the link above works for anyone." : ""}
            </Text>
          }
          renderItem={({ item }) => {
            const on = chosen.has(item.id);
            return (
              <Pressable
                style={[styles.row, on && styles.rowOn]}
                onPress={() => {
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else if (next.size < 50) next.add(item.id);
                    return next;
                  });
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={item.name}
              >
                <Avatar url={item.avatarUrl} color={item.avatarColor} name={item.name} size={40} />
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.place} numberOfLines={1}>
                    {memberPlace(item) || "PinPals member"}
                  </Text>
                </View>
                <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={23} color={on ? colors.green700 : colors.line} />
              </Pressable>
            );
          }}
        />
      )}

      {chosen.size > 0 ? (
        <View style={styles.footer}>
          <Pressable style={styles.cta} onPress={() => void send()} disabled={sending} accessibilityRole="button">
            {sending ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.ctaLabel}>{chosen.size === 1 ? "Send 1 invitation" : `Send ${chosen.size} invitations`}</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.md, gap: 6, paddingBottom: spacing.xl },
  head: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs },
  linkCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  linkTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.cream50 },
  linkBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.cream100, lineHeight: 20 },
  linkUrl: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.gold400 },
  shareRow: { flexDirection: "row", gap: spacing.sm },
  share: {
    flex: 1,
    height: 42,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: colors.cream50,
  },
  whatsapp: { backgroundColor: "#1f8f4e" },
  shareText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  shareMainText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: "#ffffff" },
  reset: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.cream100, textDecorationLine: "underline", textAlign: "center" },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  tab: {
    flex: 1,
    height: 40,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
  },
  tabOn: { backgroundColor: colors.navy900 },
  tabText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  tabTextOn: { color: colors.cream50 },
  findHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  section: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.ink500, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.sm },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  search: { flex: 1, height: 44, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  empty: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", padding: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowOn: { borderColor: colors.green600, backgroundColor: colors.green100 },
  rowBody: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  place: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.cream50 },
  cta: { height: 50, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
