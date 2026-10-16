import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { shareVia, type ShareChannel } from "@/lib/find-pinpals";
import { listConnections, listMembers, memberPlace, type Member } from "@/lib/members";
import { confirmedPlayersFor, getInvite, parseDate, whenLabel, type Invite } from "@/lib/tee-times";
import { inviteToTeeTime, teeTimeShareMessage, teeTimeShareUrl } from "@/lib/tee-time-sharing";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";

/**
 * Filling an open place in a round (0132), for the host or anyone with a
 * confirmed place. Opened by tapping an Open place on the round.
 *
 *   THE LINK, at the top: for WhatsApp or text, to anyone — on PinPals or
 *   not. It opens the round in the app, or a page on the website with a way
 *   to join PinPals.
 *
 *   YOUR PINPALS and FIND PINPALS, below: tick members and they get a
 *   notification. Either way, they ask for the place and the host confirms.
 */
function RoundInviteScreenInner() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const inviteId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [invite, setInvite] = useState<Invite | null>(null);
  const [inRound, setInRound] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<Member[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"connections" | "find">("connections");
  const [found, setFound] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !Number.isFinite(inviteId)) return;
    try {
      const [row, players, { accepted }] = await Promise.all([
        getInvite(inviteId),
        confirmedPlayersFor([inviteId]).catch(() => new Map()),
        listConnections(userId),
      ]);
      setInvite(row);
      const taken = new Set<string>([...(players.get(inviteId) ?? []).map((p: { id: string }) => p.id), ...(row ? [row.member_id] : []), userId]);
      setInRound(taken);
      setPeople(accepted.filter((m) => !taken.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "en-IE")));
    } finally {
      setLoading(false);
    }
    teeTimeShareUrl(inviteId)
      .then((u) => {
        setUrl(u);
        setLinkError(null);
      })
      .catch((err: unknown) => setLinkError(err instanceof Error ? err.message : "Couldn't make a link."));
  }, [inviteId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const finding = mode === "find";
  useEffect(() => {
    if (!finding || !userId) return;
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      void listMembers(userId, "everyone", query)
        .then((d) => {
          if (live) setFound(d.members.filter((m) => !inRound.has(m.id)));
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
  }, [finding, userId, query, inRound]);

  const visible = useMemo(() => {
    if (finding) return found;
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return people;
    return people.filter((m) => {
      const haystack = [m.name, m.homeClub, m.county].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [people, query, finding, found]);

  const club = invite?.club?.name ?? invite?.club_name ?? "a round";
  const dateLabel = invite ? parseDate(invite.play_date).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" }) : "";
  const spaces = invite?.spaces_available ?? 0;

  async function share(channel: ShareChannel) {
    if (!url || !invite) return;
    await shareVia(channel, teeTimeShareMessage({ clubName: club, dateLabel, timeLabel: whenLabel(invite), url }));
  }

  async function send() {
    if (chosen.size === 0) return;
    setSending(true);
    try {
      const sent = await inviteToTeeTime(inviteId, [...chosen]);
      Alert.alert(
        sent === 1 ? "Invitation sent" : `${sent} invitations sent`,
        sent === 0 ? "They're already in this round, have already asked, or can't be invited." : "They'll get a notification. When they ask for the place, the host confirms it.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert("Couldn't invite", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Fill a place", headerBackTitle: "Back" }} />
      {loading ? (
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      ) : !invite ? (
        <Text style={styles.empty}>This round isn&apos;t available any more.</Text>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View style={styles.head}>
              <View style={styles.round}>
                <Ionicons name="golf" size={20} color={colors.green700} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.roundTitle} numberOfLines={1}>
                    {club}
                  </Text>
                  <Text style={styles.roundMeta}>{`${dateLabel} · ${whenLabel(invite)} · ${spaces} ${spaces === 1 ? "place" : "places"} left`}</Text>
                </View>
              </View>

              <View style={styles.linkCard}>
                <Text style={styles.linkTitle}>Send a link</Text>
                <Text style={styles.linkBody}>To anyone — on PinPals or not. They tap it, ask for the place, and the host confirms.</Text>
                {url ? (
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
                ) : linkError ? (
                  <Text style={styles.linkError}>{linkError}</Text>
                ) : (
                  <ActivityIndicator color={colors.cream50} />
                )}
              </View>

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
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={17} color={colors.ink500} />
                <TextInput
                  style={styles.search}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={finding ? "Search all members by name or club" : "Search your PinPals"}
                  placeholderTextColor={colors.ink500}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                  accessibilityLabel={finding ? "Search all members" : "Search your PinPals"}
                />
              </View>
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {finding
                ? searching
                  ? "Searching…"
                  : query.trim()
                    ? "Nobody by that name — or they're already in this round."
                    : ""
                : query.trim()
                  ? "Nobody by that name."
                  : "No PinPals to invite yet — try Find PinPals, or send the link."}
            </Text>
          }
          renderItem={({ item }) => {
            const on = chosen.has(item.id);
            return (
              <Pressable
                style={[styles.row, on && styles.rowOn]}
                onPress={() =>
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else if (next.size < 20) next.add(item.id);
                    return next;
                  })
                }
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
  round: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  roundTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  roundMeta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  linkCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  linkTitle: { fontFamily: fonts.bodyBold, fontSize: type.heading, color: colors.cream50 },
  linkBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.cream100, lineHeight: 20 },
  linkError: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.gold400 },
  shareRow: { flexDirection: "row", gap: spacing.sm },
  share: { flex: 1, height: 42, borderRadius: radii.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: colors.cream50 },
  whatsapp: { backgroundColor: "#1f8f4e" },
  shareText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  shareMainText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: "#ffffff" },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  tab: { flex: 1, height: 40, borderRadius: radii.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.navy900, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.navy900 },
  tabText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  tabTextOn: { color: colors.cream50 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 13, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  search: { flex: 1, height: 44, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  empty: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  rowOn: { borderColor: colors.green600, backgroundColor: colors.green100 },
  rowBody: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  place: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.cream50 },
  cta: { height: 50, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});

/** Junior members (0159): tee times aren't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function RoundInviteScreen() {
  const gate = useAgeGate("teeTimes");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="teeTimes" title="Tee times" />;
  return <RoundInviteScreenInner />;
}
