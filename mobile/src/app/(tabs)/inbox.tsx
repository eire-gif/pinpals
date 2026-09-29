import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { Avatar } from "@/components/avatar";
import { appRouteFor } from "@/lib/alert-routes";
import { useAuth } from "@/lib/auth";
import {
  INBOX_FILTERS,
  INBOX_FILTER_LABELS,
  alertIcon,
  deleteAlert,
  inboxTotal,
  isUnread,
  loadInbox,
  markAlertRead,
  markInboxRead,
  matchesInboxFilter,
  matchesQuery,
  searchMessages,
  type InboxAlert,
  type InboxConversation,
  type InboxCounts,
  type InboxFilter,
  type InboxItem,
  type InboxMessageHit,
  type InboxRowItem,
} from "@/lib/inbox";
import { hideConversation, inboxTime } from "@/lib/messages";
import { subscribeToInbox } from "@/lib/realtime";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Messages and alerts, in one list.
 *
 * This screen replaces two: an Alerts tab that only ever showed
 * notifications, and a Messages screen reachable from an envelope on Home.
 * Keeping them apart meant a member had to check both to find out whether
 * anything had happened, and the envelope could only manage a dot because
 * nothing knew the combined total.
 *
 * An alert row opens inside the app's own web view rather than throwing the
 * member out to Safari — which is what the old Alerts tab did, and which is
 * the worst of both worlds: the app's own content, shown somewhere the member
 * is a stranger again.
 */
export default function InboxScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts>({ messages: 0, alerts: 0 });
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<InboxMessageHit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setCounts({ messages: 0, alerts: 0 });
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const loaded = await loadInbox(userId);
      setItems(loaded.items);
      setCounts(loaded.counts);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from a conversation should show it read, not still bold.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // One subscription for the whole inbox, never one per row. A ping means
  // "look again", never data to render.
  useEffect(() => {
    if (!userId) return;
    return subscribeToInbox(userId, () => void load());
  }, [userId, load]);

  /**
   * Message bodies, searched on the server.
   *
   * Debounced, because this is a round trip per keystroke otherwise. 250ms
   * is under the threshold where typing feels like it is waiting for you and
   * well over the interval between two keys.
   *
   * The timer is cleared on every change including the one that empties the
   * box, so a request for "dri" never lands after the member has already
   * given up and cleared the field.
   */
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `items` is read by the search but deliberately not a dependency of it.
  // The list is only there to put names on the hits, and it changes identity
  // on every refresh, every focus and every realtime ping — depending on it
  // would restart the debounce each time, so a member typing while a message
  // arrived would watch their search never fire.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const q = query.trim();
    // Two characters: one letter matches half the inbox and is nothing but a
    // round trip. Alerts and names are still filtered from the first
    // character, in `visible` below, because that costs nothing.
    if (!userId || q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimer.current = setTimeout(() => {
      void (async () => {
        const conversations = itemsRef.current.filter(
          (item): item is InboxConversation => item.kind === "conversation"
        );
        setHits(await searchMessages(q, userId, conversations));
        setSearching(false);
      })();
    }, 250);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, userId]);

  const total = inboxTotal(counts);
  const searchingNow = query.trim().length > 0;

  /**
   * The list, in one place.
   *
   * Order of operations matters and is not arbitrary. The chips choose what
   * KIND of thing to show, Unread narrows that to what still needs you, and
   * the query narrows again — so "unread alerts about an offer" is three
   * controls composing rather than three controls fighting.
   *
   * Message hits only join while there is a query, and only under All or
   * Messages: a member who has asked to see alerts has said they don't want
   * messages, and a search is not a reason to overrule them.
   */
  const visible = useMemo<InboxRowItem[]>(() => {
    const rows: InboxRowItem[] = items
      .filter((item) => matchesInboxFilter(item, filter))
      .filter((item) => !unreadOnly || isUnread(item))
      .filter((item) => !searchingNow || matchesQuery(item, query));

    if (!searchingNow || filter === "alerts") return rows;

    // Deliberately appended rather than interleaved by time. A matching
    // message is a different sort of answer from a matching thread, and
    // shuffling the two together by timestamp makes both harder to scan.
    return [...rows, ...hits.filter((hit) => matchesQuery(hit, query))];
  }, [items, filter, unreadOnly, searchingNow, query, hits]);

  /**
   * Opening an alert.
   *
   * Every notification's href is a path on the WEBSITE, because notifications
   * long predate the app. This screen used to honour that literally: tapping
   * "You've been offered a place" opened a web view. Being handed the site's
   * own chrome, from inside the app, at the moment you wanted to say yes, is
   * the worst version of both screens.
   *
   * appRouteFor() is the table that says which of those destinations the app
   * now has — and it is tested (mobile/src/lib/alert-routes.test.ts), because
   * a wrong entry sends someone to the wrong screen and reads as the alert
   * being unhelpful rather than as a bug. Where the app genuinely has no
   * screen — notification settings, golf news — the web view is still the
   * right answer and still opens signed in.
   *
   * Marked read optimistically: the row is about to disappear from view and
   * a badge that waits for a round trip to come down is how people learn to
   * distrust it.
   */
  function openAlert(item: InboxAlert) {
    if (item.unread) {
      void markAlertRead(item.id);
      setItems((prev) =>
        prev.map((entry) =>
          entry.kind === "alert" && entry.id === item.id
            ? { ...entry, unread: false }
            : entry
        )
      );
      setCounts((prev) => ({ ...prev, alerts: Math.max(0, prev.alerts - 1) }));
    }

    const route = appRouteFor(item.href);
    if (route.kind === "native") {
      // typedRoutes is on, so Href is a union of the literal paths in
      // src/app. This one is computed from a table at runtime and cannot be
      // one of them by construction — the cast is the escape hatch, and
      // alert-routes.test.ts is what actually checks the paths are real.
      router.push(route.path as Href);
      return;
    }
    router.push({ pathname: "/web", params: { path: route.path, title: item.title } });
  }

  async function clearAll() {
    setClearing(true);
    // Optimistic: the numbers a member just asked to clear should go now,
    // not after a round trip. load() below is what makes it true.
    setCounts({ messages: 0, alerts: 0 });
    await markInboxRead();
    await load();
    setClearing(false);
  }

  /**
   * Swiping a row away.
   *
   * The two kinds are not the same operation and the button says so. An
   * alert is yours alone, so Delete destroys it — 0084's DELETE policy, own
   * rows only, no undo. A conversation belongs to two people, so Hide sets
   * your own archived_at and touches nothing the other member can see; if
   * they write again it comes back.
   *
   * The row leaves the list first and the write follows. A swipe that sits
   * there for a round trip feels broken, and neither of these can fail in a
   * way that matters: a failed hide reappears on the next refresh, and a
   * failed delete is an alert that is still there.
   */
  async function removeItem(item: InboxItem) {
    setItems((prev) =>
      prev.filter((entry) => !(entry.kind === item.kind && entry.id === item.id))
    );

    if (item.kind === "alert") {
      if (item.unread) setCounts((prev) => ({ ...prev, alerts: Math.max(0, prev.alerts - 1) }));
      await deleteAlert(item.id);
      return;
    }

    if (userId) {
      if (item.unreadCount > 0) {
        setCounts((prev) => ({
          ...prev,
          messages: Math.max(0, prev.messages - item.unreadCount),
        }));
      }
      await hideConversation(item.id, userId);
    }
  }

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {/* Above the chips, not among them. Searching is a different kind of
          act from filtering — one narrows by what a row IS, the other by
          what it says — and a field wedged into a row of pills reads as a
          fourth pill. */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={colors.ink500} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search messages and alerts"
          placeholderTextColor={colors.ink500}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search messages and alerts"
        />
        {searching ? <ActivityIndicator size="small" color={colors.ink500} /> : null}
      </View>

      <View style={styles.bar}>
        <View style={styles.chips}>
          {INBOX_FILTERS.map((name) => {
            const active = filter === name;
            return (
              <Pressable
                key={name}
                onPress={() => setFilter(name)}
                style={[styles.chip, active && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>
                  {INBOX_FILTER_LABELS[name]}
                </Text>
              </Pressable>
            );
          })}

          {/* A toggle rather than a fourth filter, because it composes with
              the other three instead of replacing them: Alerts + Unread is a
              question people ask, and a four-way radio could not express it.
              The dot is what says it is a different sort of control. */}
          <Pressable
            onPress={() => setUnreadOnly((on) => !on)}
            style={[styles.chip, styles.chipUnread, unreadOnly && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: unreadOnly }}
            accessibilityLabel={
              unreadOnly ? "Showing unread only" : "Show unread only"
            }
          >
            <View style={[styles.chipDot, unreadOnly && styles.chipDotOn]} />
            <Text style={[styles.chipLabel, unreadOnly && styles.chipLabelOn]}>
              Unread
            </Text>
          </Pressable>
        </View>

        {/* Shown only when there is something to clear. A button that does
            nothing teaches people it is safe to ignore. */}
        {total > 0 ? (
          <Pressable
            onPress={() => void clearAll()}
            disabled={clearing}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Mark everything as read"
          >
            <Text style={[styles.clear, clearing && styles.clearOff]}>
              {clearing ? "Marking…" : "Mark all read"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        contentContainerStyle={styles.list}
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
        ListEmptyComponent={
          <Empty
            filter={filter}
            query={searchingNow ? query : ""}
            unreadOnly={unreadOnly}
          />
        }
        renderItem={({ item }) => {
          // A search hit is a view onto a message, not a row that belongs to
          // you — there is nothing to hide and nothing to delete, so it does
          // not get a swipe. Giving it one would offer to destroy something
          // it cannot.
          if (item.kind === "message") {
            return (
              <MessageHitRow
                row={item}
                onPress={() => router.push(`/conversation/${item.conversationId}`)}
              />
            );
          }

          return (
            <SwipeRow item={item} onRemove={() => void removeItem(item)}>
              {item.kind === "conversation" ? (
                <ConversationRow
                  row={item}
                  onPress={() => router.push(`/conversation/${item.id}`)}
                />
              ) : (
                <AlertRow row={item} onPress={() => openAlert(item)} />
              )}
            </SwipeRow>
          );
        }}
      />
    </View>
  );
}

/**
 * The row, with an action behind it.
 *
 * Right-side only: left-to-right is the back gesture on iOS, and stealing it
 * inside a list is how a screen stops feeling native. `rightThreshold` is
 * generous enough that a brush past a row while scrolling does not open it.
 */
function SwipeRow({
  item,
  onRemove,
  children,
}: {
  item: InboxItem;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const destructive = item.kind === "alert";

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={44}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          style={[styles.swipe, destructive && styles.swipeDelete]}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={destructive ? "Delete this alert" : "Hide this conversation"}
        >
          <Ionicons
            name={destructive ? "trash-outline" : "eye-off-outline"}
            size={19}
            color={colors.cream50}
          />
          <Text style={styles.swipeLabel}>{destructive ? "Delete" : "Hide"}</Text>
        </Pressable>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

// ---------------------------------------------------------------------------

function ConversationRow({
  row,
  onPress,
}: {
  row: InboxConversation;
  onPress: () => void;
}) {
  const unread = row.unreadCount > 0;

  const group = row.conversationKind === "group";

  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      {/* A group has no single face, so it gets a glyph rather than one
          member's avatar picked arbitrarily — which would look like a
          conversation with that person. */}
      {group ? (
        <View style={styles.glyph}>
          <Ionicons name="people" size={21} color={colors.green700} />
        </View>
      ) : (
        <Avatar
          url={row.otherAvatarUrl}
          color={row.otherAvatarColor}
          name={row.otherName}
          size={44}
        />
      )}

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {row.otherName}
          </Text>
          <Text style={styles.time}>{inboxTime(row.lastMessageAt)}</Text>
        </View>

        {/* The listing, not the last message — it says which of two threads
            with the same person this is, and costs no extra query. A group
            says how many are in it instead, which is the equivalent fact. */}
        <Text style={styles.context} numberOfLines={1}>
          {group
            ? `${row.memberCount ?? 0} people`
            : (row.listingTitle ?? "Direct message")}
        </Text>
      </View>

      {unread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>
            {row.unreadCount > 99 ? "99+" : row.unreadCount}
          </Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      )}
    </Pressable>
  );
}

function AlertRow({ row, onPress }: { row: InboxAlert; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.row, row.unread && styles.rowUnread]}
      onPress={onPress}
      accessibilityRole="button"
    >
      {/* Same 44pt circle as an avatar, so the two kinds of row line up down
          the left edge instead of looking like two lists stapled together. */}
      <View style={styles.glyph}>
        <Ionicons name={alertIcon(row.type)} size={21} color={colors.green700} />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {row.title}
          </Text>
          <Text style={styles.time}>{inboxTime(row.at)}</Text>
        </View>
        {row.body ? (
          <Text style={styles.context} numberOfLines={2}>
            {row.body}
          </Text>
        ) : null}
      </View>

      {row.unread ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

/**
 * One message that matched a search.
 *
 * Shows the text, which is the whole point — the member searched for a word
 * and wants to see it in context, not be told which thread to go and look
 * through. Two lines: enough to recognise the message, short enough that ten
 * hits are still a list.
 *
 * Quieter than the rows above it, deliberately. These are not things waiting
 * on you; they are somewhere you asked to be taken.
 */
function MessageHitRow({
  row,
  onPress,
}: {
  row: InboxMessageHit;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.hit} onPress={onPress} accessibilityRole="button">
      <Avatar
        url={row.otherAvatarUrl}
        color={row.otherAvatarColor}
        name={row.otherName}
        size={30}
      />
      <View style={styles.rowBody}>
        <Text style={styles.hitWho} numberOfLines={1}>
          {row.mine ? "You" : (row.otherName ?? "A conversation")}
          <Text style={styles.hitWhen}> · {inboxTime(row.at)}</Text>
        </Text>
        <Text style={styles.hitBody} numberOfLines={2}>
          {row.body}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.ink500} />
    </Pressable>
  );
}

function Empty({
  filter,
  query,
  unreadOnly,
}: {
  filter: InboxFilter;
  query: string;
  unreadOnly: boolean;
}) {
  // Nothing matched is not the same as nothing exists, and telling someone
  // who mistyped a name that they have no messages is how a search box
  // becomes something people stop trusting.
  if (query) {
    return (
      <View style={styles.empty}>
        <Ionicons name="search-outline" size={40} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Nothing matched “{query.trim()}”</Text>
        <Text style={styles.emptyBody}>
          Searching looks at alert text, who a conversation is with, and the
          messages inside it.
        </Text>
      </View>
    );
  }

  if (unreadOnly) {
    return (
      <View style={styles.empty}>
        <Ionicons name="checkmark-done-outline" size={44} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Nothing unread</Text>
        <Text style={styles.emptyBody}>
          You&apos;re all caught up. Turn Unread off to see everything again.
        </Text>
      </View>
    );
  }

  const copy =
    filter === "messages"
      ? {
          icon: "chatbubbles-outline" as const,
          title: "No messages yet",
          body: "Conversations start from a marketplace listing, a connection, or a tee time you've been accepted for.",
        }
      : filter === "alerts"
        ? {
            icon: "notifications-outline" as const,
            title: "No alerts yet",
            body: "Offers, auction activity, payments and tee-time replies all land here.",
          }
        : {
            icon: "mail-outline" as const,
            title: "Nothing here yet",
            body: "Messages from other members and alerts about your listings and tee times both arrive in this one list.",
          };

  return (
    <View style={styles.empty}>
      <Ionicons name={copy.icon} size={44} color={colors.ink500} />
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
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

  chips: { flexDirection: "row", gap: 6, flexShrink: 1, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipUnread: { flexDirection: "row", alignItems: "center", gap: 6 },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.green600,
  },
  chipDotOn: { backgroundColor: colors.cream50 },
  chipLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: type.small,
    color: colors.ink500,
  },
  chipLabelOn: { color: colors.cream50 },

  clear: {
    fontFamily: fonts.bodyBold,
    fontSize: type.small,
    color: colors.green700,
  },
  clearOff: { color: colors.ink500 },

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
  rowUnread: { backgroundColor: colors.green100, borderColor: colors.green600 },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  name: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink900,
  },
  time: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },
  context: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
  },

  glyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green100,
  },

  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.cream50,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.green600,
  },

  // Indented and unbordered, so a run of hits reads as results under the
  // list rather than as more inbox.
  hit: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginLeft: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceTint,
  },
  hitWho: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  hitWhen: { fontFamily: fonts.body, color: colors.ink500 },
  hitBody: {
    fontFamily: fonts.body,
    fontSize: type.small,
    lineHeight: 19,
    color: colors.ink500,
  },

  swipe: {
    width: 86,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginLeft: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.ink500,
  },
  swipeDelete: { backgroundColor: colors.red600 },
  swipeLabel: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: colors.cream50 },

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
    lineHeight: 27,
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
