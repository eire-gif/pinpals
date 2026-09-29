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
import { useAuth } from "@/lib/auth";
import { MAX_GROUP_MEMBERS, createGroup } from "@/lib/messages";
import { listConnections, memberPlace, type Member } from "@/lib/members";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** A group's name is required, and it is required for a reason: a group is
 *  the only conversation with nothing else to call it. 80 matches the check
 *  constraint on `conversations.title`. */
const MAX_TITLE = 80;

/**
 * Starting a group.
 *
 * TWO OTHER PEOPLE, MINIMUM, and the database says so too. A "group" of two
 * is a direct conversation, and every pair already has one of those — making a
 * second, differently-shaped thread for the same two people would split their
 * history in half and neither of them would know which half they were reading.
 *
 * THE LIST IS YOUR CONNECTIONS, which is narrower than the rule the database
 * enforces. can_message() also lets a buyer and seller talk mid-offer, and a
 * host and an accepted golfer — but those threads already exist by the time
 * they are allowed, started from the listing or the tee time where they have
 * their context. Nobody builds a group out of people they once bid against.
 *
 * THE REFUSALS COME FROM THE DATABASE, not from here.
 * create_group_conversation() checks that the creator may message everyone
 * they added AND that no two people in the list have blocked each other — the
 * second across all pairs, because otherwise you could put two people who
 * blocked each other in a room together and neither of them chose it. Its
 * exception text is written for a member, so this screen shows it as-is rather
 * than trying to pre-empt it with a second, drifting copy of the same rules.
 */
export default function NewGroupScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [people, setPeople] = useState<Member[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const { accepted } = await listConnections(userId);
      setPeople([...accepted].sort((a, b) => a.name.localeCompare(b.name, "en-IE")));
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

  // The creator counts toward the cap, which is why this is +1.
  const full = chosen.size + 1 >= MAX_GROUP_MEMBERS;

  const toggle = (id: string) => {
    setError(null);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (!full) next.add(id);
      return next;
    });
  };

  const ready = chosen.size >= 2 && title.trim().length > 0 && !creating;

  const create = async () => {
    if (!ready) return;
    setCreating(true);
    setError(null);
    try {
      const conversationId = await createGroup(title.trim(), [...chosen]);
      // replace, not push: Back from the new thread belongs in the inbox, not
      // in a half-filled form nobody wants to see again.
      router.replace(`/conversation/${conversationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start that group.");
      setCreating(false);
    }
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "New group", headerBackTitle: "Back" }} />

      <View style={styles.head}>
        <TextInput
          style={styles.title}
          value={title}
          onChangeText={setTitle}
          placeholder="Name this group"
          placeholderTextColor={colors.ink500}
          maxLength={MAX_TITLE}
          accessibilityLabel="Group name"
        />

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

        <Text style={styles.hint}>
          {chosen.size === 0
            ? "Pick at least two people."
            : chosen.size === 1
              ? "One more at least — two people is a direct message."
              : `${chosen.size} chosen${full ? ` · that's the maximum` : ""}`}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

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
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={44} color={colors.ink500} />
              <Text style={styles.emptyTitle}>
                {query.trim() ? "Nobody by that name" : "No connections yet"}
              </Text>
              <Text style={styles.emptyBody}>
                {query.trim()
                  ? "Only golfers you're connected to can be added."
                  : "Connect with a few golfers and you can start a group."}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const on = chosen.has(item.id);
            return (
              <Pressable
                style={[styles.row, on && styles.rowOn]}
                onPress={() => toggle(item.id)}
                // Greyed rather than hidden once full: a row that vanishes
                // when you reach the cap looks like the app lost somebody.
                disabled={!on && full}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !on && full }}
                accessibilityLabel={item.name}
              >
                <Avatar
                  url={item.avatarUrl}
                  color={item.avatarColor}
                  name={item.name}
                  size={40}
                />
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.place} numberOfLines={1}>
                    {memberPlace(item) || "PinPals member"}
                  </Text>
                </View>
                <Ionicons
                  name={on ? "checkmark-circle" : "ellipse-outline"}
                  size={23}
                  color={on ? colors.green700 : colors.line}
                />
              </Pressable>
            );
          }}
        />
      )}

      <View style={styles.footer}>
        <Pressable
          style={[styles.cta, !ready && styles.ctaOff]}
          onPress={() => void create()}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel="Start this group"
        >
          {creating ? (
            <ActivityIndicator size="small" color={colors.cream50} />
          ) : (
            <Text style={styles.ctaLabel}>Start group</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  head: { padding: spacing.md, gap: spacing.sm },
  // 16pt floor throughout — iOS zooms the screen when a smaller input takes
  // focus.
  title: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.ink900,
  },
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
  search: {
    flex: 1,
    height: 44,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },

  list: { paddingHorizontal: spacing.md, gap: 6, paddingBottom: spacing.md, flexGrow: 1 },

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

  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.cream50,
  },
  cta: {
    height: 50,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green700,
  },
  ctaOff: { backgroundColor: colors.ink500, opacity: 0.4 },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
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
