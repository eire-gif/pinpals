import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, useIsFocused, useLocalSearchParams, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { StatusBar } from "expo-status-bar";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { Avatar } from "@/components/avatar";
import { alertAction, appRouteFor, teeTimeFocus } from "@/lib/alert-routes";
import { loadAgeAccess, useAgeAccess } from "@/lib/age";
import { goHome } from "@/lib/go-home";
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
import { hideConversation, inboxTime, listInbox, unhideConversation } from "@/lib/messages";
import { loadDrafts } from "@/lib/chat-drafts";
import { groupsForConversations, myAlertsFor, nextEvents, type ChatGroup, type GroupEventCard } from "@/lib/group-chat";
import { eventWhen, groupTag, tripCountdown, type ChatAlertLevel } from "@/lib/group-chat-rules";
import { irishToday } from "@/lib/outing-rules";
import { confirmPlace, passOnPlace, respondToRequest, takePlace } from "@/lib/tee-time-interest";
import { subscribeToInbox } from "@/lib/realtime";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";

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
  // Light status bar only while Chats is on screen (tabs stay mounted).
  const focused = useIsFocused();

  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<InboxCounts>({ messages: 0, alerts: 0 });
  const [chosenFilter, setFilter] = useState<InboxFilter>("all");
  // ?filter=marketplace — the marketplace's Messages button lands here.
  const { filter: askedFilter, at: askedAt } = useLocalSearchParams<{ filter?: string; at?: string }>();
  useEffect(() => {
    if (askedFilter && (INBOX_FILTERS as readonly string[]).includes(askedFilter)) setFilter(askedFilter as InboxFilter);
  }, [askedFilter, askedAt]);
  // Junior members (0159): under 18s have no chats — the inbox is their
  // alerts, and the Chats tile and filter chips go. (Any old conversation
  // from before still can't be written to: the database refuses it.)
  const chat = useAgeAccess().allows("chat");
  const filter: InboxFilter = chat ? chosenFilter : "alerts";
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

  /** For group chats (0181): the Golf Buddies group or trip behind the chat,
   *  its next event, and your alert setting. Loaded after the list itself so
   *  the inbox never waits on it. */
  const [groupInfo, setGroupInfo] = useState<Map<number, GroupRowInfo>>(new Map());

  /** Unsent words per chat, read from the phone (chat-drafts.ts). */
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());
  /** The Archived list (Oct 2026): null while closed. */
  const [archived, setArchived] = useState<InboxConversation[] | null>(null);
  const [archivedCount, setArchivedCount] = useState(0);

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
      void loadGroupInfo(loaded.items, userId).then(setGroupInfo).catch(() => undefined);
      void loadDrafts().then(setDrafts).catch(() => undefined);
      void listInbox(userId, "archived")
        .then((rows) => setArchivedCount(rows.length))
        .catch(() => undefined);
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

    // Junior members (0159): "your parent said yes" / "you're 16 now" — a
    // fresh age answer, then Home, where the newly opened parts are.
    if (alertAction(item.type) === "refreshAge") {
      void loadAgeAccess(true).then(() => goHome());
      return;
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
      setArchivedCount((n) => n + 1);
      await hideConversation(item.id, userId);
    }
  }

  /**
   * Sections, not one long list.
   *
   * Chats are one flat list, newest first (Oct 2026). Alerts group by day —
   * Today, Yesterday, This week, Earlier — because an alert is about when
   * something happened. A search drops the grouping entirely: results are
   * ranked answers, and splitting them by date makes the right one harder
   * to spot.
   */
  const sections = useMemo<InboxSection[]>(() => {
    if (searchingNow) return visible.length ? [{ key: "results", title: "", data: visible, fresh: 0 }] : [];

    // Groups (0181): every group chat, busiest first, in one list.
    if (filter === "groups") {
      const convs = visible.filter((r): r is InboxConversation => r.kind === "conversation");
      return convs.length ? [{ key: "groups", title: "", data: convs, fresh: convs.filter(isUnread).length }] : [];
    }

    // Chat, Marketplace (Oct 2026): one flat list, newest first, the
    // WhatsApp way — the row itself says whether it's a group or an item.
    if (filter === "messages" || filter === "marketplace") {
      const convs = visible.filter((r): r is InboxConversation => r.kind === "conversation");
      return convs.length ? [{ key: filter, title: "", data: convs, fresh: 0 }] : [];
    }

    // All (Oct 2026, after WhatsApp): chats only. Alerts moved to the bell
    // at the top — except one that still wants an answer (a place offered,
    // a request to your round, your group's invite), which sits above the
    // chats until it's answered, so nothing with a clock on it gets missed.
    if (filter === "all") {
      const asks = visible.filter((r): r is InboxAlert => r.kind === "alert" && needsAnswer(r));
      const convs = visible.filter((r): r is InboxConversation => r.kind === "conversation");
      const out: InboxSection[] = [];
      if (asks.length) out.push({ key: "asks", title: "Needs your answer", data: asks, fresh: asks.filter(isUnread).length });
      if (convs.length) out.push({ key: "chats", title: asks.length ? "Chats" : "", data: convs, fresh: 0 });
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

  /** Unread chats under each chip — the number beside its name. */
  const chipCounts = useMemo(() => {
    const out: Partial<Record<InboxFilter, number>> = {};
    for (const name of INBOX_FILTERS) {
      if (name === "all") continue;
      out[name] = items.filter((i) => matchesInboxFilter(i, name) && isUnread(i)).length;
    }
    return out;
  }, [items]);
  const unreadChats = items.filter((i) => i.kind === "conversation" && isUnread(i)).length;

  async function openArchived() {
    if (!userId) return;
    setArchived([]);
    try {
      const rows = await listInbox(userId, "archived");
      setArchived(rows.map((row) => ({ ...row, kind: "conversation" as const, at: row.lastMessageAt ?? new Date(0).toISOString() })));
      setArchivedCount(rows.length);
    } catch {
      setArchived(null);
    }
  }

  async function unarchive(row: InboxConversation) {
    if (!userId) return;
    setArchived((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
    setArchivedCount((n) => Math.max(0, n - 1));
    await unhideConversation(row.id, userId);
    void load();
  }

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  // The Archived list: its own simple screen inside the tab, Back to Chats.
  if (archived) {
    return (
      <View style={styles.fill}>
        <View style={styles.titleRow}>
          <Pressable onPress={() => setArchived(null)} hitSlop={10} style={styles.backRow} accessibilityRole="button" accessibilityLabel="Back to chats">
            <Ionicons name="chevron-back" size={22} color={colors.green700} />
            <Text style={styles.backLabel}>Chats</Text>
          </Pressable>
        </View>
        <Text style={styles.bigTitle} accessibilityRole="header">Archived</Text>
        <Text style={styles.archivedNote}>
          Chats you&apos;ve swiped away. One comes back on its own when someone writes in it.
        </Text>
        <SectionList
          sections={archived.length ? [{ key: "archived", title: "", data: archived as InboxRowItem[], fresh: 0 }] : []}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="archive-outline" size={44} color={colors.ink500} />
              <Text style={styles.emptyTitle}>Nothing archived</Text>
              <Text style={styles.emptyBody}>Swipe a chat left and tap Archive to tidy it away here.</Text>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === "conversation" ? (
              <ReanimatedSwipeable
                friction={2}
                rightThreshold={44}
                overshootRight={false}
                renderRightActions={() => (
                  <Pressable style={styles.swipe} onPress={() => void unarchive(item)} accessibilityRole="button" accessibilityLabel="Unarchive this chat">
                    <Ionicons name="arrow-undo-outline" size={19} color={colors.cream50} />
                    <Text style={styles.swipeLabel}>Unarchive</Text>
                  </Pressable>
                )}
              >
                <ConversationRow
                  row={item}
                  info={groupInfo.get(item.id) ?? null}
                  draft={null}
                  onPress={() => router.push(`/conversation/${item.id}`)}
                />
              </ReanimatedSwipeable>
            ) : null
          }
        />
      </View>
    );
  }

  const chipLabel = (name: InboxFilter) => INBOX_FILTER_LABELS[name];
  // A small dot in each chat type's colour, matching the row tags.
  const chipDot: Partial<Record<InboxFilter, string>> = { groups: colors.gold500, messages: colors.green600, marketplace: "#3d6fa8" };

  return (
    <View style={styles.fill}>
      {/* Oct 2026, after WhatsApp: a big title, one search, one row of chips
          that scrolls sideways, and the chats as a flat list. Alerts are
          behind the bell at the top (components/chats-header.tsx). */}
      {focused ? <StatusBar style="light" /> : null}
      {/* Option B (31 Oct 2026): the navy band carries on from the bar
          behind the title and search, so the screen is ours, not WhatsApp's. */}
      <View style={styles.band}>
      <View style={styles.titleRow}>
        <Text style={[styles.bigTitle, styles.bigTitleInRow, styles.bigTitleOnBand]} accessibilityRole="header">
          {filter === "alerts" ? "Alerts" : "Chats"}
        </Text>
        {total > 0 && !searchingNow ? (
          <Pressable
            onPress={() => void clearAll()}
            disabled={clearing}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Mark everything as read"
          >
            <Text style={[styles.clear, styles.clearOnBand, clearing && styles.clearOff]}>
              {clearing ? "Marking…" : "Mark all read"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={20} color={colors.ink500} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={chat ? "Search chats and alerts" : "Search alerts"}
          placeholderTextColor={colors.ink500}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search chats and alerts"
        />
        {searching ? <ActivityIndicator size="small" color={colors.ink500} /> : null}
      </View>
      </View>

      {chat ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
        >
          {INBOX_FILTERS.flatMap((name) => {
            const chips: React.ReactNode[] = [];
            const active = filter === name;
            const n = chipCounts[name] ?? 0;
            chips.push(
              <Pressable
                key={name}
                onPress={() => setFilter(name)}
                style={[styles.chip, active && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={n > 0 ? `${chipLabel(name)}, ${n} unread` : chipLabel(name)}
              >
                {chipDot[name] ? <View style={[styles.chipDot, { backgroundColor: chipDot[name] }]} /> : null}
                <Text style={[styles.chipLabel, active && styles.chipLabelOn]}>{chipLabel(name)}</Text>
                {n > 0 ? <View style={styles.chipCount}><Text style={styles.chipCountLabel}>{n > 99 ? "99+" : n}</Text></View> : null}
              </Pressable>
            );
            // Unread sits straight after All, as on WhatsApp — still a toggle,
            // so it narrows whichever chip is chosen.
            if (name === "all") {
              chips.push(
                <Pressable
                  key="unread"
                  onPress={() => setUnreadOnly((on) => !on)}
                  style={[styles.chip, unreadOnly && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: unreadOnly }}
                  accessibilityLabel={unreadOnly ? "Showing unread only" : "Show unread only"}
                >
                  <Text style={[styles.chipLabel, unreadOnly && styles.chipLabelOn]}>Unread</Text>
                  {unreadChats > 0 ? <View style={styles.chipCount}><Text style={styles.chipCountLabel}>{unreadChats > 99 ? "99+" : unreadChats}</Text></View> : null}
                </Pressable>
              );
            }
            return chips;
          })}
        </ScrollView>
      ) : null}

      <SectionList keyboardDismissMode={KEYBOARD_DISMISS_MODE}
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
          // Archived, at the top of the chats as on WhatsApp — only once
          // there is something in it.
          chat && archivedCount > 0 && !searchingNow && (filter === "all" || filter === "messages") ? (
            <Pressable
              onPress={() => void openArchived()}
              style={({ pressed }) => [styles.archivedRow, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Archived, ${archivedCount} chats`}
            >
              <View style={styles.archivedIcon}>
                <Ionicons name="archive-outline" size={22} color={colors.ink500} />
              </View>
              <View style={styles.archivedBody}>
                <Text style={styles.archivedLabel}>Archived</Text>
                <Text style={styles.archivedCount}>{archivedCount}</Text>
              </View>
            </Pressable>
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
                  info={groupInfo.get(item.id) ?? null}
                  draft={drafts.get(item.id) ?? null}
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

/** An alert that still wants an answer on its row — pinned above the chats. */
function needsAnswer(row: InboxAlert): boolean {
  if (row.settled) return false;
  if (row.type === "tee_time_group_invited") return row.takeInviteId != null;
  return (row.type === "tee_time_interest_received" || row.type === "tee_time_place_offered") && row.interestId !== null;
}

type GroupRowInfo = { group: ChatGroup | null; next: GroupEventCard | null; alerts: ChatAlertLevel };

/** The group, next event and alert level behind each group chat in the list. */
async function loadGroupInfo(items: InboxItem[], userId: string): Promise<Map<number, GroupRowInfo>> {
  const ids = items
    .filter((i): i is InboxConversation => i.kind === "conversation" && i.conversationKind === "group")
    .map((i) => i.id);
  const out = new Map<number, GroupRowInfo>();
  if (ids.length === 0) return out;
  const [groups, alerts] = await Promise.all([groupsForConversations(ids), myAlertsFor(ids, userId)]);
  const groupIds = [...groups.values()].map((g) => g.id);
  const next = await nextEvents(groupIds, irishToday(), userId).catch(() => new Map<number, GroupEventCard>());
  for (const id of ids) {
    const group = groups.get(id) ?? null;
    out.set(id, { group, next: group ? (next.get(group.id) ?? null) : null, alerts: alerts.get(id) ?? "all" });
  }
  return out;
}

/** The line under a group chat's name: a trip's countdown, the next round, or how many are in it. */
function groupContext(row: InboxConversation, info: GroupRowInfo | null): string {
  const g = info?.group;
  const next = info?.next;
  const nextLine = next ? `Next: ${eventWhen(next.playsOn, next.firstTee)}${next.courseName ? ` · ${next.courseName}` : ""}` : null;
  if (g?.kind === "trip") {
    const countdown = tripCountdown(g.startsOn, g.endsOn, irishToday());
    return [countdown, nextLine && !countdown ? nextLine : null].filter(Boolean).join(" · ") || `${g.memberCount} golfers`;
  }
  if (nextLine) return nextLine;
  return `${g?.memberCount ?? row.memberCount ?? 0} ${g ? "members" : "people"}`;
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
          style={[styles.swipe, destructive ? styles.swipeDelete : styles.swipeFlat]}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={destructive ? "Delete this alert" : "Archive this chat"}
        >
          <Ionicons
            name={destructive ? "trash-outline" : "archive-outline"}
            size={19}
            color={colors.cream50}
          />
          <Text style={styles.swipeLabel}>{destructive ? "Delete" : "Archive"}</Text>
        </Pressable>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

// ---------------------------------------------------------------------------

/** "See you there" (mine, after its ticks), "Stephen: Lovely", or the photo / listing fallback. */
function previewLine(row: InboxConversation): string {
  const m = row.lastMessage;
  if (!m) {
    if (row.conversationKind === "group") return `${row.memberCount ?? 0} people`;
    return row.listingTitle ?? "Direct message";
  }
  const text = m.deleted
    ? m.mine
      ? "You deleted this message"
      : "This message was deleted"
    : m.body.trim() || (m.photo ? "📷 Photo" : "");
  if (m.deleted) return text;
  // Mine shows ✓ / ✓✓ in front instead of "You:", the WhatsApp way.
  if (m.mine) return text;
  if (row.conversationKind === "group" && m.senderFirstName) return `${m.senderFirstName}: ${text}`;
  return text;
}

function ConversationRow({
  row,
  info,
  draft,
  onPress,
}: {
  row: InboxConversation;
  /** Group chats only (0181). */
  info: GroupRowInfo | null;
  /** Unsent words saved on this phone (chat-drafts.ts). */
  draft: string | null;
  onPress: () => void;
}) {
  const unread = row.unreadCount > 0;
  const group = row.conversationKind === "group";
  const kind = info?.group?.kind ?? null;
  const tag = kind ? groupTag(kind) : null;
  const muted = info?.alerts === "none";
  // A chat about a listing (Oct 2026): the item is the face of the row, and
  // the line under it says who it's with and which side you're on.
  const listing = !group && row.listingTitle !== null;
  // Shown the WhatsApp way: only while nothing newer is waiting to be read.
  const showDraft = !!draft && !unread;
  const preview = showDraft ? draft!.replace(/\s+/g, " ").trim() : previewLine(row);

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${listing ? row.listingTitle : row.otherName}${unread ? `, ${row.unreadCount} unread` : ""}${muted ? ", muted" : ""}. ${showDraft ? "Draft: " : ""}${preview}`}
    >
      {/* A group has no single face, so it gets a glyph rather than one
          member's avatar — which would look like a chat with that person. */}
      {group ? (
        // A trip is navy with a gold plane; Golf Buddies green; a chat
        // built by hand keeps the plain circle.
        <View style={[styles.iconCircle, styles.groupCircle, kind === "trip" && styles.tripSquare, kind === "crew" && styles.crewSquare]}>
          <Ionicons
            name={kind === "trip" ? "airplane" : "people"}
            size={kind === "trip" ? 22 : 24}
            color={kind === "trip" ? colors.gold400 : kind === "crew" ? colors.cream50 : colors.green700}
          />
        </View>
      ) : listing ? (
        <View style={[styles.iconCircle, styles.itemSquare]}>
          <Ionicons name="pricetag" size={22} color="#7a5a12" />
        </View>
      ) : (
        <Avatar url={row.otherAvatarUrl} color={row.otherAvatarColor} name={row.otherName} size={52} />
      )}

      <View style={styles.rowBody}>
        <View style={styles.cardTop}>
          <View style={styles.titleLine}>
            <Text style={[styles.title, styles.titleShrink, unread && styles.titleUnread]} numberOfLines={1}>
              {listing ? row.listingTitle : row.otherName}
            </Text>
            {tag ? (
              <View style={[styles.tag, kind === "trip" ? styles.tagTrip : styles.tagCrew]}>
                <Text style={[styles.tagText, kind === "trip" ? styles.tagTextTrip : styles.tagTextCrew]}>{tag}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.time, unread && styles.timeUnread]}>{inboxTime(row.lastMessageAt)}</Text>
        </View>
        {group ? (
          <Text style={[styles.subtle, info?.next || (kind === "trip" && info?.group?.startsOn) ? styles.subtleNext : null]} numberOfLines={1}>
            {groupContext(row, info)}
          </Text>
        ) : listing ? (
          <Text style={[styles.subtle, styles.subtleItem]} numberOfLines={1}>
            {row.sellingIt ? "Selling" : "Buying"} · {row.otherName}
          </Text>
        ) : null}
        <View style={styles.previewRow}>
          {!showDraft && row.lastMessage?.mine && !row.lastMessage.deleted ? (
            <Ionicons
              name={row.lastMessage.seen ? "checkmark-done" : "checkmark"}
              size={16}
              color={row.lastMessage.seen ? colors.green600 : colors.ink500}
              accessibilityLabel={row.lastMessage.seen ? "Read" : "Sent"}
            />
          ) : null}
          <Text
            style={[styles.preview, styles.previewFlex, unread && styles.previewUnread, !showDraft && row.lastMessage?.deleted && styles.previewGone]}
            numberOfLines={1}
          >
            {showDraft ? <Text style={styles.draftLabel}>Draft: </Text> : null}
            {preview}
          </Text>
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>{row.unreadCount > 99 ? "99+" : row.unreadCount}</Text>
            </View>
          ) : muted ? (
            <Ionicons name="notifications-off-outline" size={17} color={colors.ink500} accessibilityLabel="Muted" />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * An alert, with its answer in place when it is the kind that needs one.
 *
 * "Geoff wants to join your round" and "You've been offered a place" are the
 * two alerts with a clock on them, and both used to need three taps to
 * answer. Now the buttons are on the row — while the request still wants an
 * answer. Once it doesn't (confirmed from the round itself, given back, the
 * round cancelled or played), the row says so instead: `settled`, read from
 * the request as it stands when the inbox loads. A 409 from the server, for
 * a change since then, collapses the buttons the same way.
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

  const canAnswerRequest = row.type === "tee_time_interest_received" && row.interestId !== null && !row.settled;
  const canAnswerOffer = row.type === "tee_time_place_offered" && row.interestId !== null && !row.settled;
  // 0186: invited with your group — take the place right here.
  const canTake = row.type === "tee_time_group_invited" && row.takeInviteId != null && !row.settled;

  const answer = async (fn: () => Promise<unknown>, label: string) => {
    setState("busy");
    try {
      await fn();
      setDoneText(label);
    } catch (e) {
      setDoneText(
        e instanceof ApiError && e.status === 409
          ? row.type === "tee_time_group_invited"
            ? "Sorry — the places have all been taken"
            : "Already answered"
          : "Couldn't do that — open it to try again"
      );
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
                onPress={() => {
                  // My rounds, at that round: the request is the first
                  // card on the page, with Offer a place on it.
                  const round = teeTimeFocus(row.href);
                  router.push(round !== null ? `/my-rounds?invite=${round}` : "/my-rounds?show=hosting");
                }}
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

      {canTake && state !== "done" ? (
        <View style={styles.inlineActions}>
          <Pressable
            style={[styles.inlineBtn, styles.inlinePrimary]}
            onPress={() => void answer(() => takePlace(row.takeInviteId!), "You're in — place confirmed")}
            disabled={state === "busy"}
            accessibilityRole="button"
          >
            <Text style={styles.inlinePrimaryLabel}>{state === "busy" ? "…" : "Take a place"}</Text>
          </Pressable>
          <Pressable
            style={[styles.inlineBtn, styles.inlineSecondary]}
            onPress={() => void answer(() => passOnPlace(row.takeInviteId!), "Thanks — you've passed on this one")}
            disabled={state === "busy"}
            accessibilityRole="button"
          >
            <Text style={styles.inlineSecondaryLabel}>Can&apos;t make it</Text>
          </Pressable>
        </View>
      ) : null}

      {state === "done" ? (
        <Text style={styles.doneText}>{doneText}</Text>
      ) : row.settled ? (
        <View style={styles.settledRow}>
          <Ionicons
            name={/^You (confirmed|accepted|'re playing)/.test(row.settled) ? "checkmark-circle" : "information-circle-outline"}
            size={16}
            color={/^You (confirmed|accepted|'re playing)/.test(row.settled) ? colors.green700 : colors.ink500}
          />
          <Text style={styles.settledText}>{row.settled}</Text>
        </View>
      ) : null}
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
    filter === "groups"
      ? {
          icon: "people-outline" as const,
          title: "No group chats yet",
          body: "Start Golf Buddies or plan a golf trip from Groups & Societies — its chat comes with it, and everyone you invite is in.",
        }
      : filter === "messages"
      ? {
          icon: "chatbubbles-outline" as const,
          title: "No chats yet",
          body: "Start a chat with the green + at the top, or message someone from a listing, a tee time or their profile.",
        }
      : filter === "alerts"
        ? {
            icon: "notifications-outline" as const,
            title: "No alerts yet",
            body: "Offers, tee-time replies, likes and comments all land here.",
          }
        : {
            icon: "chatbubbles-outline" as const,
            title: "No chats yet",
            body: "Start one with the green + at the top. Alerts about your listings and tee times are behind the bell.",
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

  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: 2,
  },
  bigTitle: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.ink900, paddingHorizontal: spacing.md, marginBottom: 10 },
  bigTitleInRow: { paddingHorizontal: 0 },
  band: { backgroundColor: colors.navy900, paddingBottom: 16, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  bigTitleOnBand: { color: colors.cream50 },
  clearOnBand: { color: colors.gold400 },
  backRow: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  backLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.green700 },
  archivedNote: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink500, paddingHorizontal: spacing.md, marginBottom: 6 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: spacing.md,
    paddingHorizontal: 16,
    minHeight: 46,
    borderRadius: radii.pill,
    backgroundColor: colors.cream50,
  },
  // 16pt floor — iOS zooms the screen when a smaller input takes focus.
  search: { flex: 1, height: 46, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },

  // One row that scrolls sideways — never wraps onto a second line.
  // flexShrink 0 + vertical padding: the row was being squeezed by the list
  // below and the chips' bottoms cut off (31 Oct 2026).
  chipScroll: { flexGrow: 0, flexShrink: 0, marginTop: 6 },
  chips: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, paddingVertical: 8 },
  chip: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipDot: { width: 9, height: 9, borderRadius: 4.5 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },
  chipCount: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  chipCountLabel: { fontFamily: fonts.bodyBold, fontSize: 12, lineHeight: 15, color: colors.navy900 },

  archivedRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52 },
  archivedIcon: { width: 52, alignItems: "center" },
  archivedBody: {
    flex: 1,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  archivedLabel: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink900 },
  archivedCount: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink500 },

  // A chat (Oct 2026): flat on the page, a hairline under the words only.
  row: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.cream50 },
  rowPressed: { backgroundColor: colors.cream100 },
  rowBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 78,
    justifyContent: "center",
    gap: 2,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  titleLine: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  itemSquare: { borderRadius: 14, backgroundColor: "#f5e6c2" },
  subtleItem: { color: "#7a5a12", fontFamily: fonts.bodySemi },
  draftLabel: { fontFamily: fonts.bodySemi, color: colors.green700 },
  swipeFlat: { marginBottom: 0, borderRadius: 0 },

  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
  clear: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700, paddingBottom: 14 },
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
  timeUnread: { fontFamily: fonts.bodyBold, color: "#8a6614" },
  subtle: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  preview: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 20, color: "#4c5667" },
  previewUnread: { color: colors.ink900, fontFamily: fonts.bodySemi },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  previewFlex: { flex: 1 },
  previewGone: { fontStyle: "italic", color: colors.ink500 },
  moreChats: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10 },
  moreChatsLabel: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.green700 },

  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  groupCircle: { backgroundColor: colors.green100 },
  tripSquare: { borderRadius: 14, backgroundColor: colors.navy900 },
  crewSquare: { borderRadius: 14, backgroundColor: colors.green700 },
  titleShrink: { flex: 0, flexShrink: 1 },
  tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagTrip: { backgroundColor: "#f5e6c2" },
  tagCrew: { backgroundColor: colors.green100 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  tagTextTrip: { color: "#7a5a12" },
  tagTextCrew: { color: colors.green800 },
  subtleNext: { color: colors.green700, fontFamily: fonts.bodySemi },
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
    backgroundColor: colors.gold500,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.navy900 },

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
  settledRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 62 },
  settledText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink500, flexShrink: 1 },

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
