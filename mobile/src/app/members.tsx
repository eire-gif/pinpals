import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import {
  MEMBER_SCOPES,
  MEMBER_SCOPE_LABELS,
  conversationWith,
  listMembers,
  memberPlace,
  requestConnection,
  type ConnectionState,
  type Member,
  type MemberScope,
} from "@/lib/members";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The golfer directory.
 *
 * Search, three scopes, and one button per card that knows where you stand
 * with that member. The website's version is the same shape; what it cannot
 * do is be one tap from the tee-time you were just looking at.
 *
 * Handicap obeys `handicap_visible` and age is a band rather than a date —
 * both decided in lib/members.ts so no screen can forget.
 */
export default function MembersScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [scope, setScope] = useState<MemberScope>("everyone");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [connections, setConnections] = useState<Map<string, ConnectionState>>(new Map());
  const [unavailable, setUnavailable] = useState<false | "no-club" | "no-connections">(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Every keystroke would be a query. The token is what stops a slow early
  // response landing on top of a fast later one — the same guard the courses
  // screen uses.
  const token = useRef(0);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const mine = ++token.current;
    try {
      const result = await listMembers(userId, scope, query);
      if (mine !== token.current) return;
      setMembers(result.members);
      setConnections(result.connections);
      setUnavailable(result.unavailable);
    } finally {
      if (mine === token.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId, scope, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function connect(member: Member) {
    if (!userId) return;
    setBusyId(member.id);
    try {
      await requestConnection(userId, member.id);
      setConnections((prev) => {
        const next = new Map(prev);
        next.set(member.id, { connectionId: -1, status: "pending", theirsToAnswer: false });
        return next;
      });
    } catch (err) {
      Alert.alert(
        "Couldn't send that",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function message(member: Member) {
    setBusyId(member.id);
    try {
      const conversationId = await conversationWith(member.id);
      router.push(`/conversation/${conversationId}`);
    } catch (err) {
      Alert.alert(
        "Can't start that conversation",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {/* The band carries the screen's name, so the bar above it does
          not need to carry it too. */}
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />

      <View style={styles.fill}>
        <ScreenHeader
          scene="linksDusk"
          title="Members"
          subtitle="Golfers across Ireland and the UK"
        />

        <View style={styles.controls}>
          <View style={styles.search}>
            <Ionicons name="search" size={17} color={colors.ink500} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Name or club"
              placeholderTextColor={colors.ink500}
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          <View style={styles.chips}>
            {MEMBER_SCOPES.map((name) => {
              const active = scope === name;
              return (
                <Pressable
                  key={name}
                  onPress={() => setScope(name)}
                  style={[styles.chip, active && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>
                    {MEMBER_SCOPE_LABELS[name]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {loading ? (
          <View style={[styles.fill, styles.centre]}>
            <ActivityIndicator color={colors.green700} />
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.list}
            data={members}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
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
            ListEmptyComponent={<Empty unavailable={unavailable} searching={query.trim() !== ""} />}
            renderItem={({ item }) => (
              <MemberCard
                member={item}
                connection={connections.get(item.id)}
                busy={busyId === item.id}
                onConnect={() => void connect(item)}
                onMessage={() => void message(item)}
              />
            )}
          />
        )}
      </View>
    </>
  );
}

function MemberCard({
  member,
  connection,
  busy,
  onConnect,
  onMessage,
}: {
  member: Member;
  connection: ConnectionState | undefined;
  busy: boolean;
  onConnect: () => void;
  onMessage: () => void;
}) {
  const place = memberPlace(member);

  return (
    <View style={styles.card}>
      {/* The top of the card opens the member's own page: their posts, and
          anything they are selling. */}
      <Pressable
        style={styles.cardTop}
        onPress={() => router.push({ pathname: "/member/[id]", params: { id: member.id } })}
        accessibilityRole="link"
        accessibilityLabel={`${member.name}'s page`}
      >
        <Avatar
          url={member.avatarUrl}
          color={member.avatarColor}
          name={member.name}
          size={46}
        />
        <View style={styles.cardHead}>
          <Text style={styles.name} numberOfLines={1}>
            {member.name}
          </Text>
          <Text style={styles.club} numberOfLines={1}>
            {member.homeClub ?? "No club set yet"}
          </Text>
          {place ? (
            <Text style={styles.place} numberOfLines={1}>
              {place}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      </Pressable>

      <View style={styles.facts}>
        <Fact label="Handicap" value={member.handicap !== null ? String(member.handicap) : "Not shared"} />
        <Fact label="Age" value={member.ageBand ?? "Not shared"} />
      </View>

      <Action
        connection={connection}
        busy={busy}
        onConnect={onConnect}
        onMessage={onMessage}
      />
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

/**
 * One button, four states. A card that says "Connect" to somebody you are
 * already connected to is the thing that makes a directory feel broken.
 */
function Action({
  connection,
  busy,
  onConnect,
  onMessage,
}: {
  connection: ConnectionState | undefined;
  busy: boolean;
  onConnect: () => void;
  onMessage: () => void;
}) {
  if (busy) {
    return (
      <View style={[styles.action, styles.actionQuiet]}>
        <ActivityIndicator color={colors.green700} size="small" />
      </View>
    );
  }

  if (connection?.status === "accepted") {
    return (
      <Pressable style={styles.action} onPress={onMessage} accessibilityRole="button">
        <Ionicons name="chatbubble-outline" size={16} color={colors.cream50} />
        <Text style={styles.actionLabel}>Message</Text>
      </Pressable>
    );
  }

  if (connection?.status === "pending") {
    return (
      <View style={[styles.action, styles.actionQuiet]}>
        <Text style={styles.actionQuietLabel}>
          {connection.theirsToAnswer ? "Waiting on you — see Connections" : "Request sent"}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.action, styles.actionOutline]}
      onPress={onConnect}
      accessibilityRole="button"
    >
      <Ionicons name="person-add-outline" size={16} color={colors.green700} />
      <Text style={styles.actionOutlineLabel}>
        {connection?.status === "declined" ? "Connect again" : "Connect"}
      </Text>
    </Pressable>
  );
}

function Empty({
  unavailable,
  searching,
}: {
  unavailable: false | "no-club" | "no-connections";
  searching: boolean;
}) {
  const copy =
    unavailable === "no-club"
      ? {
          title: "No home club set",
          body: "Add your home club to your profile and this shows everyone else who plays there.",
        }
      : unavailable === "no-connections"
        ? {
            title: "No connections yet",
            body: "Connect with a few golfers and they'll show up here.",
          }
        : searching
          ? { title: "Nobody matched that", body: "Try a shorter search, or a club name." }
          : { title: "No members to show", body: "Pull down to try again." };

  return (
    <View style={styles.empty}>
      <Ionicons name="people-outline" size={44} color={colors.ink500} />
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },

  controls: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    height: 44,
    borderRadius: radii.pill,
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

  chips: { flexDirection: "row", gap: 6 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  chipLabelOn: { color: colors.cream50 },

  list: { padding: spacing.md, paddingTop: 0, gap: spacing.sm, flexGrow: 1 },

  card: {
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardHead: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.display, fontSize: 18, color: colors.ink900 },
  club: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  place: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },

  facts: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  fact: { gap: 1 },
  factLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.ink500,
  },
  factValue: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },

  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  actionLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  actionOutline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.green600,
  },
  actionOutlineLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  actionQuiet: { backgroundColor: colors.surfaceTint },
  actionQuietLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },

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
});
