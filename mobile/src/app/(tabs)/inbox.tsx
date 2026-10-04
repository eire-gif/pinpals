import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
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
  DAY_BUCKET_LABELS,
  INBOX_FILTERS,
  INBOX_FILTER_LABELS,
  alertLook,
  dayBucket,
  type DayBucket,
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
import { ApiError } from "@/lib/api";
import { hideConversation, inboxTime } from "@/lib/messages";
import { confirmPlace, respondToRequest } from "@/lib/tee-time-interest";
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

  /**
   * Sections, not one long list.
   *
   * Under Messages, threads group the way a messaging app groups them: group
   * chats first (they are the busiest and the easiest to lose), then this
   * week's conversations, then older ones. Everywhere else rows group by day —
   * Today, Yesterday, This week, Earlier — because an alert is about when
   * something happened. A search drops the grouping entirely: results are
   * ranked answers, and splitting them by date makes the right one harder
   * to spot.
   */
  const sections = useMemo<InboxSection[]>(() => {
    if (searchingNow) return visible.length ? [{ key: "results", title: "", data: visible, fresh: 0 }] : [];

    if (filter === "messages") {
      const convs = visible.filter((r): r is InboxConversation => r.kind === "conversation");
      const groups = convs.filter((c) => c.conversationKind === "group");
      const direct = convs.filter((c) => c.conversationKind !== "group");
      const recent = direct.filter((c) => dayBucket(c.at) !== "earlier");
      const older = direct.filter((c) => dayBucket(c.at) === "earlier");
      const out: InboxSection[] = [];
      if (groups.length) out.push({ key: "groups", title: "Group chats", data: groups, fresh: groups.filter(isUnread).length });
      if (recent.length) out.push({ key: "recent", title: "Recent conversations", data: recent, fresh: recent.filter(isUnread).length });
      if (older.length) out.push({ key: "older", title: "Older conversations", data: older, fresh: older.filter(isUnread).length });
      return out;
    }

    const order: DayBucket[] = ["today", "yesterday", "week", "earlier"];
    return order
      .map((bucket) => {
        const data = visible.filter((r) => dayBucket(r.at) === bucket);
        const fresh = data.filter((r) => r.kind !== "message" && isUnread(r)).length;
        return { key: bucket, title: DAY_BUCKET_LABELS[bucket], data, fresh };
      })
      .filter((section) => section.data.length > 0);
  }, [visible, filter, searchingNow]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {/* Above the chips, not among them. Searching narrows by what a row
          SAYS, the chips by what it IS; a field wedged into a row of pills
          reads as a fourth pill. Bigger than before, because it is the
          quickest way to anything in here. */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={20} color={colors.ink500} />
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

        {/* A toggle rather than a fourth filter: it composes with the other
            three (Alerts + Unread is a question people ask). The dot is what
            says it is a different sort of control. */}
        <Pressable
          onPress={() => setUnreadOnly((on) => !on)}
          style={[styles.chip, styles.chipUnread, unreadOnly && styles.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: unreadOnly }}
          accessibilityLabel={unreadOnly ? "Showing unread only" : "Show unread only"}
        >
          <View style={[styles.chipDot, unreadOnly && styles.chipDotOn]} />
          <Text style={[styles.chipLabel, unreadOnly && styles.chipLabelOn]}>Unread</Text>
        </Pressable>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        contentContainerStyle={styles.list}
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
        ListHeaderComponent={
          // Shown only when there is something to clear. A button that does
          // nothing teaches people it is safe to ignore.
          total > 0 && !searchingNow ? (
            <View style={styles.markRow}>
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
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.fresh > 0 ? (
                <View style={styles.newPill}>
                  <Text style={styles.newPillText}>{section.fresh} new</Text>
                </View>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Empty filter={filter} query={searchingNow ? query : ""} unreadOnly={unreadOnly} />
        }
        renderItem={({ item }) => {
          // A search hit is a view onto a message, not a row that belongs to
          // you — nothing to hide, nothing to delete, so no swipe.
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
                <AlertRow row={item} onPress={() => openAlert(item)} onAnswered={() => void load()} />
              )}
            </SwipeRow>
          );
        }}
      />
    </View>
  );
}

type InboxSection = { key: string; title: string; data: InboxRowItem[]; fresh: number };

/**
 * The row, with an action behind it.
 *
 * Right-side only: left-to-right is the back gesture on iOS, and stealing it
 * inside a list is how a screen stops feeling native.
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

/** "You: See you there", "Stephen: Lovely", or the photo / listing fallback. */
function previewLine(row: InboxConversation): string {
  const m = row.lastMessage;
  if (!m) {
    if (row.conversationKind === "group") return `${row.memberCount ?? 0} people`;
    return row.listingTitle ?? "Direct message";
  }
  const text = m.body.trim() || (m.photo ? "Sent a photo" : "");
  if (m.mine) return `You: ${text}`;
  if (row.conversationKind === "group" && m.senderFirstName) return `${m.senderFirstName}: ${text}`;
  return text;
}

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
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.otherName}${unread ? `, ${row.unreadCount} unread` : ""}. ${previewLine(row)}`}
    >
      <View>
        {/* A group has no single face, so it gets a glyph rather than one
            member's avatar — which would look like a chat with that person. */}
        {group ? (
          <View style={[styles.iconCircle, styles.groupCircle]}>
            <Ionicons name="people" size={24} color={colors.green700} />
          </View>
        ) : (
          <Avatar url={row.otherAvatarUrl} color={row.otherAvatarColor} name={row.otherName} size={50} />
        )}
        {unread ? <View style={[styles.cornerDot, { backgroundColor: colors.green600 }]} /> : null}
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {row.otherName}
          </Text>
          <Text style={[styles.time, unread && styles.timeUnread]}>{inboxTime(row.lastMessageAt)}</Text>
        </View>
        {group ? <Text style={styles.subtle}>{row.memberCount ?? 0} people</Text> : null}
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {previewLine(row)}
        </Text>
      </View>

      {unread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{row.unreadCount > 99 ? "99+" : row.unreadCount}</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      )}
    </Pressable>
  );
}

/**
 * An alert, with its answer in place when it is the kind that needs one.
 *
 * "Geoff wants to join your round" and "You've been offered a place" are the
 * two alerts with a clock on them, and both used to need three taps to
 * answer. Now the buttons are on the row. Anything the server says has
 * already been answered (409) just collapses the buttons — the member has
 * answered elsewhere, which is fine.
 */
function AlertRow({
  row,
  onPress,
  onAnswered,
}: {
  row: InboxAlert;
  onPress: () => void;
  onAnswered: () => void;
}) {
  const look = alertLook(row.type);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [doneText, setDoneText] = useState("");

  const canAnswerRequest = row.type === "tee_time_interest_received" && row.interestId !== null;
  const canAnswerOffer = row.type === "tee_time_place_offered" && row.interestId !== null;

  const answer = async (fn: () => Promise<unknown>, label: string) => {
    setState("busy");
    try {
      await fn();
      setDoneText(label);
    } catch (e) {
      setDoneText(e instanceof ApiError && e.status === 409 ? "Already answered" : "Couldn't do that — open it to try again");
    }
    setState("done");
    onAnswered();
  };

  const decline = () =>
    Alert.alert("Decline this request?", "They'll be told the round can't take them.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Decline",
        style: "destructive",
        onPress: () => void answer(() => respondToRequest(row.interestId!, false), "Declined"),
      },
    ]);

  return (
    <View style={[styles.card, styles.alertCard, row.unread && styles.cardUnread]}>
      <Pressable style={styles.alertMain} onPress={onPress} accessibilityRole="button">
        <View>
          <View style={[styles.iconCircle, { backgroundColor: look.bg }]}>
            <Ionicons name={look.icon as keyof typeof Ionicons.glyphMap} size={22} color={look.fg} />
          </View>
          {row.unread ? <View style={[styles.cornerDot, { backgroundColor: look.fg }]} /> : null}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={[styles.title, row.unread && styles.titleUnread]} numberOfLines={2}>
              {row.title}
            </Text>
            <Text style={styles.time}>{inboxTime(row.at)}</Text>
          </View>
          {row.body ? (
            <Text style={styles.preview} numberOfLines={3}>
              {row.body}
            </Text>
          ) : null}
        </View>

        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      </Pressable>

      {(canAnswerRequest || canAnswerOffer) && state !== "done" ? (
        <View style={styles.inlineActions}>
          {canAnswerRequest ? (
            <>
              <Pressable
                style={[styles.inlineBtn, styles.inlinePrimary]}
                onPress={() => router.push("/tee-time-requests")}
                disabled={state === "busy"}
                accessibilityRole="button"
              >
                <Text style={styles.inlinePrimaryLabel}>View request</Text>
              </Pressable>
              <Pressable
                style={[styles.inlineBtn, styles.inlineSecondary]}
                onPress={decline}
                disabled={state === "busy"}
                accessibilityRole="button"
              >
                <Text style={styles.inlineSecondaryLabel}>{state === "busy" ? "…" : "Decline"}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.inlineBtn, styles.inlinePrimary]}
                onPress={() => void answer(() => confirmPlace(row.interestId!, true), "You're in — place confirmed")}
                disabled={state === "busy"}
                accessibilityRole="button"
              >
                <Text style={styles.inlinePrimaryLabel}>{state === "busy" ? "…" : "Confirm place"}</Text>
              </Pressable>
              <Pressable
                style={[styles.inlineBtn, styles.inlineSecondary]}
                onPress={() =>
                  Alert.alert("Give the place back?", "The host will be told so they can offer it to someone else.", [
                    { text: "Keep it", style: "cancel" },
                    {
                      text: "Can't make it",
                      style: "destructive",
                      onPress: () => void answer(() => confirmPlace(row.interestId!, false), "Place given back"),
                    },
                  ])
                }
                disabled={state === "busy"}
                accessibilityRole="button"
              >
                <Text style={styles.inlineSecondaryLabel}>Can&apos;t make it</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {state === "done" ? <Text style={styles.doneText}>{doneText}</Text> : null}
    </View>
  );
}

/**
 * One message that matched a search. Shows the text — the member searched
 * for a word and wants to see it in context. Quieter than the cards: these
 * are somewhere you asked to be taken, not things waiting on you.
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
      <Avatar url={row.otherAvatarUrl} color={row.otherAvatarColor} name={row.otherName} size={32} />
      <View style={styles.cardBody}>
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
  // Nothing matched is not the same as nothing exists.
  if (query) {
    return (
      <View style={styles.empty}>
        <Ionicons name="search-outline" size={40} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Nothing matched “{query.trim()}”</Text>
        <Text style={styles.emptyBody}>
          Searching looks at alert text, who a conversation is with, and the messages inside it.
        </Text>
      </View>
    );
  }

  if (unreadOnly) {
    return (
      <View style={styles.empty}>
        <Ionicons name="checkmark-done-outline" size={44} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Nothing unread</Text>
        <Text style={styles.emptyBody}>You&apos;re all caught up. Turn Unread off to see everything again.</Text>
      </View>
    );
  }

  const copy =
    filter === "messages"
      ? {
          icon: "chatbubbles-outline" as const,
          title: "No messages yet",
          body: "Start one with the pencil at the top, or message someone from a listing, a tee time or their profile.",
        }
      : filter === "alerts"
        ? {
            icon: "notifications-outline" as const,
            title: "No alerts yet",
            body: "Offers, tee-time replies, likes and comments all land here.",
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

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: 16,
    minHeight: 50,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  // 16pt floor — iOS zooms the screen when a smaller input takes focus.
  search: { flex: 1, height: 50, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: spacing.md, paddingTop: 12 },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipUnread: { flexDirection: "row", alignItems: "center", gap: 7 },
  chipDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green600 },
  chipDotOn: { backgroundColor: colors.cream50 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },

  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
  markRow: { alignItems: "flex-end", paddingTop: 10 },
  clear: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  clearOff: { color: colors.ink500 },

  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitle: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink900 },
  newPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
  },
  newPillText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.green800 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginBottom: 10,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "#e8e0cc",
    backgroundColor: colors.surface,
  },
  cardPressed: { backgroundColor: colors.surfaceTint },
  cardUnread: { borderColor: "#cfe0cd" },
  alertCard: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  alertMain: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardBody: { flex: 1, gap: 3 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink900 },
  titleUnread: { fontFamily: fonts.bodyBold },
  time: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
  timeUnread: { fontFamily: fonts.bodySemi, color: colors.green700 },
  subtle: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  preview: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: "#4c5667" },
  previewUnread: { color: colors.ink900, fontFamily: fonts.bodySemi },

  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  groupCircle: { backgroundColor: colors.green100 },
  cornerDot: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2,
    borderColor: colors.surface,
  },

  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.cream50 },

  inlineActions: { flexDirection: "row", gap: 10, paddingLeft: 62 },
  inlineBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  inlinePrimary: { backgroundColor: colors.green700 },
  inlinePrimaryLabel: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.cream50 },
  inlineSecondary: { borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  inlineSecondaryLabel: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink900 },
  doneText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.green800, paddingLeft: 62 },

  hit: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 8,
    marginLeft: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceTint,
  },
  hitWho: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  hitWhen: { fontFamily: fonts.body, color: colors.ink500 },
  hitBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },

  swipe: {
    width: 86,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginLeft: spacing.sm,
    marginBottom: 10,
    borderRadius: radii.lg,
    backgroundColor: colors.ink500,
  },
  swipeDelete: { backgroundColor: colors.red600 },
  swipeLabel: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: colors.cream50 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, marginTop: 40 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
