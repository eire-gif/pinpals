import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { WithInvite } from "@/components/pinpals";
import { INVITE_EVERY, inviteAfter } from "@/lib/invite-slots";
import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import {
  conversationWith,
  listConnections,
  memberPlace,
  respondToConnection,
  type Connections,
  type Member,
} from "@/lib/members";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";

/**
 * Your connections, and the requests waiting on you.
 *
 * Requests come first and nothing else does, because they are the only thing
 * on this screen that needs doing. Below them the people you are connected
 * to, each one tap from a conversation — which is the point of connecting.
 *
 * Requests you have sent are listed too, greyed out. The website shows them
 * nowhere, so members send the same request twice wondering why nothing
 * happened.
 */

type Row =
  | { kind: "incoming"; connectionId: number; member: Member }
  | { kind: "accepted"; member: Member }
  | { kind: "outgoing"; member: Member };

export default function ConnectionsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [data, setData] = useState<Connections>({ incoming: [], accepted: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setData(await listConnections(userId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function answer(connectionId: number, member: Member, accept: boolean) {
    if (!userId) return;
    setBusyId(member.id);
    try {
      await respondToConnection(connectionId, userId, accept);
      await load();
    } catch (err) {
      Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function message(member: Member) {
    setBusyId(member.id);
    try {
      router.push(`/conversation/${await conversationWith(member.id)}`);
    } catch (err) {
      Alert.alert(
        "Can't start that conversation",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Filtered here rather than re-queried.
   *
   * The whole list is already in memory — connections are people you know,
   * not a directory — so a round trip per keystroke would be slower and would
   * fail outright on a bad signal. Club and county are matched as well as
   * name, because "who do I know at Portmarnock" is the question this screen
   * actually gets asked.
   */
  const term = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (term === "") return () => true;
    return (member: Member) =>
      member.name.toLowerCase().includes(term) ||
      (member.homeClub ?? "").toLowerCase().includes(term) ||
      (member.county ?? "").toLowerCase().includes(term);
  }, [term]);

  const sections: { title: string; data: Row[] }[] = [
    {
      title: data.incoming.length === 1 ? "1 request waiting" : `${data.incoming.length} requests waiting`,
      data: data.incoming.filter((entry) => matches(entry.member)).map((entry) => ({
        kind: "incoming" as const,
        connectionId: entry.connectionId,
        member: entry.member,
      })),
    },
    {
      title: "Connected",
      data: data.accepted.filter(matches).map((member) => ({ kind: "accepted" as const, member })),
    },
    {
      title: "Sent, not answered yet",
      data: data.outgoing.filter(matches).map((member) => ({ kind: "outgoing" as const, member })),
    },
  ].filter((section) => section.data.length > 0);

  // The header says how many golfers you are actually connected to, which is
  // the number the screen is about — requests waiting and invitations you
  // have sent get their own section headings below.
  const connected = data.accepted.length;
  const total = connected + data.incoming.length + data.outgoing.length;
  const subtitle =
    connected === 0
      ? "Nobody yet"
      : connected === 1
        ? "1 golfer"
        : `${connected} golfers`;

  return (
    <>
      {/* The band carries the screen's name, so the bar above it
          does not need to carry it too. */}
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />

      <ScreenHeader scene="dunesGold" title="My connections" subtitle={subtitle} />

      {/* Hidden below a handful of people: a search box over four names is
          furniture, not a feature. The threshold counts everyone on the
          screen, since requests and sent invitations are searchable too. */}
      {!loading && total >= 6 ? (
        <View style={styles.search}>
          <Ionicons name="search" size={17} color={colors.ink500} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Name, club or county"
            placeholderTextColor={colors.ink500}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search your connections"
          />
        </View>
      ) : null}

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <SectionList keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          style={styles.fill}
          contentContainerStyle={styles.list}
          sections={sections}
          keyExtractor={(item) => `${item.kind}-${item.member.id}`}
          stickySectionHeadersEnabled={false}
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
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          ListEmptyComponent={
            // A search that matched nothing is not the same as having nobody,
            // and telling someone with forty connections to "find a few from
            // your club to start" because they mistyped a name would be daft.
            term !== "" ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={40} color={colors.ink500} />
                <Text style={styles.emptyTitle}>Nobody matched that</Text>
                <Text style={styles.emptyBody}>
                  Try a shorter search, or a club name.
                </Text>
                <Pressable
                  style={styles.cta}
                  onPress={() => setQuery("")}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaLabel}>Clear search</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="person-add-outline" size={44} color={colors.ink500} />
                <Text style={styles.emptyTitle}>No connections yet</Text>
                <Text style={styles.emptyBody}>
                  Connecting is what lets you message another golfer and see them
                  in your own directory. Find a few from your club to start.
                </Text>
                <Pressable
                  style={styles.cta}
                  onPress={() => router.push("/members")}
                  accessibilityRole="button"
                >
                  <Text style={styles.ctaLabel}>Browse members</Text>
                </Pressable>
              </View>
            )
          }
          renderItem={({ item, index, section }) => (
            <WithInvite
              show={inviteAfter(index, section.data.length, INVITE_EVERY.connections)}
              gap={spacing.sm}
              title="Know a golfer who'd fit in?"
              body="Invite them — connections are what make PinPals work."
            >
            <View style={[styles.card, item.kind === "outgoing" && styles.cardQuiet]}>
              <View style={styles.cardTop}>
                {/* Photo and name open the member's page (tester feedback,
                    4 Oct 2026). The message button beside them stays its
                    own target. */}
                <Pressable
                  style={styles.cardLink}
                  onPress={() => router.push({ pathname: "/member/[id]", params: { id: item.member.id } })}
                  accessibilityRole="link"
                  accessibilityLabel={`${item.member.name}'s page`}
                >
                <Avatar
                  url={item.member.avatarUrl}
                  color={item.member.avatarColor}
                  name={item.member.name}
                  size={44}
                />
                <View style={styles.cardHead}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.member.name}
                  </Text>
                  <Text style={styles.club} numberOfLines={1}>
                    {item.member.homeClub ?? "No club set yet"}
                  </Text>
                  {memberPlace(item.member) ? (
                    <Text style={styles.place} numberOfLines={1}>
                      {memberPlace(item.member)}
                    </Text>
                  ) : null}
                </View>
                {item.kind !== "accepted" ? <Ionicons name="chevron-forward" size={18} color={colors.ink500} /> : null}
                </Pressable>

                {item.kind === "accepted" ? (
                  <Pressable
                    style={styles.message}
                    disabled={busyId === item.member.id}
                    onPress={() => void message(item.member)}
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${item.member.name}`}
                  >
                    {busyId === item.member.id ? (
                      <ActivityIndicator color={colors.cream50} size="small" />
                    ) : (
                      <Ionicons name="chatbubble" size={17} color={colors.cream50} />
                    )}
                  </Pressable>
                ) : null}
              </View>

              {item.kind === "incoming" ? (
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.button, styles.buttonYes]}
                    disabled={busyId === item.member.id}
                    onPress={() => void answer(item.connectionId, item.member, true)}
                    accessibilityRole="button"
                  >
                    {busyId === item.member.id ? (
                      <ActivityIndicator color={colors.cream50} size="small" />
                    ) : (
                      <Text style={styles.buttonYesLabel}>Accept</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={styles.button}
                    disabled={busyId === item.member.id}
                    onPress={() => void answer(item.connectionId, item.member, false)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.buttonLabel}>Decline</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
            </WithInvite>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
    paddingTop: spacing.sm,
    paddingBottom: 2,
  },

  card: {
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardQuiet: { backgroundColor: colors.surfaceTint },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardLink: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  cardHead: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.ink900 },
  club: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  place: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },

  message: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green700,
  },

  actions: { flexDirection: "row", gap: spacing.sm },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  buttonLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  buttonYes: { backgroundColor: colors.green700, borderColor: colors.green700 },
  buttonYesLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 21,
    color: colors.ink900,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
