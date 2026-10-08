import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { InviteBanner } from "@/components/pinpals";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  conversationWith,
  listConnections,
  memberPlace,
  type Member,
} from "@/lib/members";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Who do you want to talk to?
 *
 * ONLY ACCEPTED CONNECTIONS ARE LISTED, and that is narrower than the rule
 * the database enforces. can_message() (0025) also lets a buyer and seller
 * talk mid-offer, and a host and an accepted golfer talk about a round — but
 * both of those threads already exist by the time they are allowed, started
 * from the listing or the tee time, where they have their context. A member
 * scrolling a picker for someone they once bid against is not a thing anyone
 * does. So this lists the people you have deliberately connected to, which is
 * what "new chat" means to the person pressing it.
 *
 * If the pair already has a thread, conversationWith() returns that one
 * rather than a second — the server looks for it before inserting, because
 * `conversations` has a unique index on the pair and a second attempt would
 * otherwise fail on it rather than do the obvious thing.
 */
export default function NewChatScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [people, setPeople] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const { accepted } = await listConnections(userId);
      setPeople(
        [...accepted].sort((a, b) => a.name.localeCompare(b.name, "en-IE"))
      );
    } catch {
      setError("Couldn't load your connections.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /**
   * Matched on name, club and county — the three things the row shows.
   * Searching on something invisible is how a picker ends up hiding somebody
   * for a reason nobody can see.
   */
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return people;
    return people.filter((member) => {
      const haystack = [member.name, member.homeClub, member.county]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [people, query]);

  /**
   * Opens the thread, replacing this screen rather than stacking on it.
   *
   * `router.replace` so Back from the conversation goes to the inbox, not
   * back to the picker that sent you there — nobody wants to choose a person
   * twice, and a stack that grows a dead screen per conversation is how the
   * back gesture stops meaning anything.
   */
  const open = async (member: Member) => {
    if (openingId) return;
    setOpeningId(member.id);
    setError(null);
    try {
      const conversationId = await conversationWith(member.id);
      router.replace(`/conversation/${conversationId}`);
    } catch (err) {
      // The server's own wording, which explains WHY a pair may not talk.
      setError(
        err instanceof ApiError ? err.message : "Couldn't open that conversation."
      );
      setOpeningId(null);
    }
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "New message", headerBackTitle: "Back" }} />

      {/* Always shown, unlike the connections screen's own search, which
          appears at six people. There it is a convenience on a list you were
          reading anyway; here, choosing someone IS the task, and a field that
          materialises once you are popular enough is a field nobody learns
          is there. */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={colors.ink500} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your connections"
          placeholderTextColor={colors.ink500}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search your connections"
        />
      </View>

      {/* Above the list, not behind a second button in the navigation bar: a
          group is a different kind of thing from a conversation with one
          person, and this is the screen where somebody has already decided
          they want to talk to someone. */}
      <Pressable
        style={styles.groupCta}
        onPress={() => router.push("/new-group")}
        accessibilityRole="button"
      >
        <View style={styles.groupGlyph}>
          <Ionicons name="people" size={20} color={colors.green700} />
        </View>
        <Text style={styles.groupLabel}>New group</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(member) => member.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <Empty searching={query.trim().length > 0} any={people.length > 0} />
          }
          // Under the list: the people you'd message most may not be here yet.
          ListFooterComponent={
            query.trim() === "" ? (
              <View style={styles.footer}>
                <InviteBanner title="Friend not on PinPals yet?" body="Send them a link — it's free to join." />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => void open(item)}
              disabled={openingId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Message ${item.name}`}
            >
              <Avatar
                url={item.avatarUrl}
                color={item.avatarColor}
                name={item.name}
                size={44}
              />
              <View style={styles.rowBody}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.place} numberOfLines={1}>
                  {memberPlace(item) || "PinPals member"}
                </Text>
              </View>
              {openingId === item.id ? (
                <ActivityIndicator size="small" color={colors.green700} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

/**
 * Three different empty states, because they need three different answers.
 * "No connections yet" wants a way to go and find some; "nothing matched"
 * wants you to try a different word. Showing the first to someone who simply
 * mistyped a name is the version of this that wastes their time.
 */
function Empty({ searching, any }: { searching: boolean; any: boolean }) {
  if (searching && any) {
    return (
      <View style={styles.empty}>
        <Ionicons name="search-outline" size={40} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Nobody by that name</Text>
        <Text style={styles.emptyBody}>
          Only golfers you&apos;re connected to are listed here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.empty}>
      <Ionicons name="people-outline" size={44} color={colors.ink500} />
      <Text style={styles.emptyTitle}>No connections yet</Text>
      <Text style={styles.emptyBody}>
        Connect with a golfer and you can message them from here.
      </Text>
      <Pressable
        style={styles.cta}
        onPress={() => router.push("/members")}
        accessibilityRole="button"
      >
        <Text style={styles.ctaLabel}>Browse members</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  // 16pt floor — iOS zooms the screen when a smaller input takes focus.
  search: {
    flex: 1,
    height: 44,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },

  groupCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.green600,
    backgroundColor: colors.green100,
  },
  groupGlyph: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  groupLabel: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    color: colors.ink900,
  },

  error: {
    fontFamily: fonts.bodySemi,
    fontSize: type.small,
    color: colors.red600,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowBody: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.ink900 },
  place: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

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
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    color: colors.cream50,
  },
  footer: { marginTop: spacing.md },
});
