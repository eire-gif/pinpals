import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import {
  INBOX_FILTERS,
  INBOX_FILTER_LABELS,
  alertIcon,
  deleteAlert,
  inboxTotal,
  loadInbox,
  markAlertRead,
  markInboxRead,
  matchesInboxFilter,
  type InboxAlert,
  type InboxConversation,
  type InboxCounts,
  type InboxFilter,
  type InboxItem,
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

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

  const total = inboxTotal(counts);
  const visible = items.filter((item) => matchesInboxFilter(item, filter));

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
        ListEmptyComponent={<Empty filter={filter} />}
        renderItem={({ item }) => (
          <SwipeRow item={item} onRemove={() => void removeItem(item)}>
          {item.kind === "conversation" ? (
            <ConversationRow
              row={item}
              onPress={() => router.push(`/conversation/${item.id}`)}
            />
          ) : (
            <AlertRow
              row={item}
              onPress={() => {
                if (item.unread) {
                  void markAlertRead(item.id);
                  setItems((prev) =>
                    prev.map((entry) =>
                      entry.kind === "alert" && entry.id === item.id
                        ? { ...entry, unread: false }
                        : entry
                    )
                  );
                  setCounts((prev) => ({
                    ...prev,
                    alerts: Math.max(0, prev.alerts - 1),
                  }));
                }
                router.push({
                  pathname: "/web",
                  params: { path: item.href, title: item.title },
                });
              }}
            />
          )}
          </SwipeRow>
        )}
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

  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <Avatar
        url={row.otherAvatarUrl}
        color={row.otherAvatarColor}
        name={row.otherName}
        size={44}
      />

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {row.otherName}
          </Text>
          <Text style={styles.time}>{inboxTime(row.lastMessageAt)}</Text>
        </View>

        {/* The listing, not the last message — it says which of two threads
            with the same person this is, and costs no extra query. */}
        <Text style={styles.context} numberOfLines={1}>
          {row.listingTitle ?? "Direct message"}
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

function Empty({ filter }: { filter: InboxFilter }) {
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
  chips: { flexDirection: "row", gap: 6, flexShrink: 1 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
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
