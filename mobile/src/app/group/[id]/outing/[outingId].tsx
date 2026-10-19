import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { DoneHome } from "@/components/done-home";
import { Avatar } from "@/components/avatar";
import { OutingPayCard } from "@/components/outing-pay-card";
import { SectionTitle } from "@/components/group-bits";
import { TwoPane } from "@/components/two-pane";
import { FULL_WIDTH_CONTENT, pageColumn, useWideLayout } from "@/lib/content-width";
import { Chip, PlaceChip, euro, ordinal } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage, type GroupMember } from "@/lib/groups-data";
import { groupNoun, organisers, type GroupKind } from "@/lib/groups";
import { countdownLabel, isTrip, tripBadge, tripRangeLabel } from "@/lib/itinerary-rules";
import { clock, closesLabel, entriesOpen, feeLabel, irishToday, isOutingDay, outingDateLabel, outingPast, PAID_LABELS, type PaidStatus } from "@/lib/outing-rules";
import { SITE_URL } from "@/lib/config";
import { loadItinerary } from "@/lib/itinerary";
import { CLAIM_LABELS, type ClaimMethod } from "@/lib/outing-payments";
import { outingShareText } from "@/lib/outing-share";
import { indexLabel, parseIndex } from "@/lib/live-scoring";
import {
  addOutingGuest,
  answerOutingOffer,
  cancelOuting,
  claimOutingPaid,
  loadOuting,
  markOutingGuestPaid,
  markOutingPaid,
  markOutingRefunded,
  promoteOutingWaiting,
  keepOutingOnPhone,
  outingFromPhone,
  removeOutingGuest,
  requestOutingPlace,
  reviewOutingRequest,
  setOutingEntry,
  updateOutingGuest,
  type OutingEntry,
  type OutingGuest,
  type OutingPage,
  type OutingStart,
  type QueueEntry,
} from "@/lib/outings";
import { mySocietyAreas } from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * One society outing (0125).
 *
 * Everyone in the society: the details, Join / Cancel (until midnight at the
 * start of the day), who's in, and — once the captain or secretary has
 * published the draw — the tee groups, with your own tee time on top.
 *
 * The captain, secretary and owner also: edit or cancel it, add or take
 * people off at any time, mark who has paid, and make the draw (the From a
 * group screen, opened on this outing: publish the tee times beforehand,
 * start the round on the day). Only they can start it.
 *
 * Guests (0131): the officers enter people who aren't on PinPals, with a
 * name and a handicap index. They take a place, go in the draw and can be
 * marked paid, like a member.
 *
 * A trip (overnight or abroad, 0126) has no single draw: its rounds, flights,
 * rooms and notes are on its itinerary, which this page opens.
 */
export default function OutingScreen() {
  // saved=1: just set up or changed (outing/new.tsx).
  const { id: rawId, outingId: rawOuting, saved } = useLocalSearchParams<{ id: string; outingId: string; saved?: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [page, setPage] = useState<OutingPage | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [officer, setOfficer] = useState(false);
  /** 0144: the money area (treasurer, captain, secretary) sees and marks payments. */
  const [money, setMoney] = useState(false);
  const [societyName, setSocietyName] = useState<string | null>(null);
  const [kind, setKind] = useState<GroupKind | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** The guest form: closed, adding a new guest, or changing one. */
  const [guestForm, setGuestForm] = useState<null | { id: number | null; name: string; index: string }>(null);
  const [refreshing, setRefreshing] = useState(false);
  // iPad on its side: the event on the left, places and entries on the right (claude/ipad.md).
  const wide = useWideLayout();
  /** Shown from the copy on the phone (no signal): when it was saved. */
  const [offlineAt, setOfflineAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [o, g, areas] = await Promise.all([loadOuting(outingId), loadGroupPage(groupId, userId), mySocietyAreas(groupId)]);
      setPage(o);
      setMembers(g?.members ?? []);
      // Before 0144 there are no areas: whoever runs the group does both.
      const runs = g?.myRole === "owner" || g?.myRole === "admin";
      setOfficer(areas.length ? areas.includes("events") : runs);
      setMoney(areas.length ? areas.includes("money") : runs);
      setOfflineAt(null);
      if (o) void keepOutingOnPhone(o, userId);
      setSocietyName(g?.group.name ?? null);
      setKind(g?.group.kind ?? null);
      setFailed(false);
    } catch {
      // No signal: the copy kept on the phone, if there is one.
      const kept = await outingFromPhone(outingId);
      if (kept) {
        setPage(kept);
        setOfflineAt(kept.savedAt);
        setOfficer(false);
        setMoney(false);
      } else setFailed(true);
    }
  }, [groupId, outingId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  // Members and guests, as one list: who's in, and the tee groups.
  const groups = useMemo(() => {
    const rows: Row[] = [
      ...(page?.entries ?? []).map((e): Row => ({ key: `m:${e.memberId}`, name: e.name, member: e, guest: null, teeGroup: e.teeGroup, teeTime: e.teeTime, teePosition: e.teePosition, start: e.start })),
      ...(page?.guests ?? []).map((g): Row => ({ key: `g:${g.id}`, name: g.name, member: null, guest: g, teeGroup: g.teeGroup, teeTime: g.teeTime, teePosition: g.teePosition, start: g.start })),
    ];
    const drawn = new Map<number, Row[]>();
    for (const r of rows) if (r.teeGroup) drawn.set(r.teeGroup, [...(drawn.get(r.teeGroup) ?? []), r]);
    const ordered = [...drawn.entries()].sort((a, b) => a[0] - b[0]).map(([n, list]) => ({ n, time: list[0]?.teeTime ?? null, start: list[0]?.start ?? null, list: list.sort((a, b) => (a.teePosition ?? 0) - (b.teePosition ?? 0)) }));
    return { all: rows, ordered, undrawn: rows.filter((r) => !r.teeGroup) };
  }, [page]);

  if (page === undefined && !failed) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Outing", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (failed && !page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Outing", headerBackTitle: "Back" }} />
        <LoadError onRetry={() => void load()} what="this outing" size="screen" />
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Outing", headerBackTitle: "Back" }} />
        <StateMessage icon="calendar-outline" title="This outing isn't available" body="It may have been removed, or you're not in the group." size="screen" />
      </View>
    );
  }

  const { outing, entries, payments, claims, guests, guestPayments, queue, choices, withdrawals } = page;
  const me = entries.find((e) => e.memberId === userId) ?? null;
  const myQueue = queue.find((q) => q.memberId === userId) ?? null;
  const requests = queue.filter((q) => q.status === "requested");
  const waiting = queue.filter((q) => q.status !== "requested");
  const myLine = myQueue?.status === "waiting" ? waiting.filter((q) => q.status === "waiting").findIndex((q) => q.memberId === userId) + 1 : null;
  const cancelled = outing.status === "cancelled";
  const started = outing.matchDayId != null;
  const trip = isTrip(outing.kind) && outing.endsOn != null;
  const past = outingPast(outing.endsOn ?? outing.playsOn);
  const closesAt = outing.entriesCloseAt ? new Date(outing.entriesCloseAt) : null;
  const open = !cancelled && !started && (closesAt ? Date.now() < closesAt.getTime() : entriesOpen(outing.playsOn));
  const today = isOutingDay(outing.playsOn);
  const myPaid = userId ? payments.get(userId) : undefined;
  const myGroup = me?.teeGroup ? groups.ordered.find((g) => g.n === me.teeGroup) : null;
  const notIn = members.filter((m) => !entries.some((e) => e.memberId === m.id));

  const openRequest = () => router.push({ pathname: "/group/[id]/outing/request", params: { id: String(groupId), outingId: String(outingId) } });
  /** A first-come event with nothing to choose: in, in one tap. Otherwise the request screen. */
  function join() {
    if (outing.entryMode === "request" || outing.mealOptions.length > 0) {
      openRequest();
      return;
    }
    void act("me", async () => {
      const status = await requestOutingPlace(outingId);
      if (status === "waiting") Alert.alert("On the waiting list", "It's full just now. You'll get a notification as soon as a place opens — then you have 24 hours to take it.");
    });
  }
  function leave() {
    Alert.alert(`Cancel your place at ${outing.title}?`, "Your place goes to the next person on the waiting list, if there is one.", [
      { text: "Keep my place", style: "cancel" },
      { text: "Cancel my place", style: "destructive", onPress: () => void act("me", () => setOutingEntry(outingId, false)) },
    ]);
  }
  function leaveQueue() {
    Alert.alert(myQueue?.status === "requested" ? "Withdraw your request?" : "Come off the waiting list?", undefined, [
      { text: "Keep it", style: "cancel" },
      { text: myQueue?.status === "requested" ? "Withdraw" : "Come off", style: "destructive", onPress: () => void act("me", () => setOutingEntry(outingId, false)) },
    ]);
  }

  /** Officers: a request or someone on the list. */
  function queueMenu(q: QueueEntry) {
    if (!officer) return;
    const c = choices.get(q.memberId);
    const asked = [
      q.guestName ? `With a guest: ${q.guestName}${q.guestIndex != null ? ` (${indexLabel(q.guestIndex)})` : ""}` : null,
      c?.meal ? `Meal: ${c.meal}` : null,
      c?.playWith ? `Play with: ${members.find((m) => m.id === c.playWith)?.name ?? "a member"}` : null,
      c?.teePref ? `${c.teePref === "early" ? "Early" : "Late"} tee time` : null,
      c?.note ? `"${c.note}"` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const go = (d: "approve" | "member_only" | "waiting" | "decline") => () => void act(`q-${q.memberId}`, () => reviewOutingRequest(outingId, q.memberId, d));
    Alert.alert(q.name, asked || undefined, [
      { text: q.guestName ? "Give them both a place" : "Give them a place", onPress: go("approve") },
      ...(q.guestName ? [{ text: "A place for them, not the guest", onPress: go("member_only") }] : []),
      ...(q.status === "requested" ? [{ text: "Put on the waiting list", onPress: go("waiting") }] : []),
      { text: q.status === "requested" ? "Decline" : "Take off the list", style: "destructive" as const, onPress: go("decline") },
      { text: "View profile", onPress: () => router.push({ pathname: "/member/[id]", params: { id: q.memberId } }) },
      { text: "Close", style: "cancel" as const },
    ]);
  }

  function guestMenu(g: OutingGuest) {
    if (!officer && !money) return;
    const paid = guestPayments.get(g.id);
    const mark = (s: Exclude<PaidStatus, "card"> | null, label: string) => ({ text: label, onPress: () => void act(`gpay-${g.id}`, () => markOutingGuestPaid(g.id, s)) });
    const detail = [g.handicapIndex != null ? `Guest · index ${indexLabel(g.handicapIndex)}` : "Guest", outing.entryFeeCents ? (paid ? PAID_LABELS[paid] : `Not paid yet · ${feeLabel(outing.entryFeeCents)}`) : null].filter(Boolean).join("\n");
    Alert.alert(g.name, detail, [
      ...(outing.entryFeeCents && money
        ? [
            ...(paid !== "cash" ? [mark("cash", "Paid cash")] : []),
            ...(paid !== "transfer" ? [mark("transfer", "Paid by transfer")] : []),
            ...(paid !== "waived" ? [mark("waived", "Waive the fee")] : []),
            ...(paid ? [mark(null, "Not paid")] : []),
          ]
        : []),
      ...(!started && officer
        ? [
            { text: "Change name or index", onPress: () => setGuestForm({ id: g.id, name: g.name, index: g.handicapIndex != null ? indexLabel(g.handicapIndex) : "" }) },
            { text: "Take off the outing", style: "destructive" as const, onPress: () => void act(`goff-${g.id}`, () => removeOutingGuest(g.id)) },
          ]
        : []),
      { text: "Close", style: "cancel" as const },
    ]);
  }

  async function saveGuest() {
    if (!guestForm) return;
    const name = guestForm.name.trim();
    const index = guestForm.index.trim() ? parseIndex(guestForm.index) : null;
    if (!name) return;
    if (guestForm.index.trim() && index == null) {
      Alert.alert("Check the index", "A handicap index looks like 14.2, or +1.5 for a plus handicap.");
      return;
    }
    const id = guestForm.id;
    await act("guest", async () => {
      if (id == null) await addOutingGuest(outingId, name, index);
      else await updateOutingGuest(id, name, index);
      setGuestForm(null);
    });
  }

  function entrantMenu(e: OutingEntry) {
    if (!officer && !money) {
      router.push({ pathname: "/member/[id]", params: { id: e.memberId } });
      return;
    }
    const c = choices.get(e.memberId);
    const extra = officer ? [c?.meal ? `Meal: ${c.meal}` : null, c?.teePref ? `${c.teePref === "early" ? "Early" : "Late"} tee` : null, c?.playWith ? `With ${members.find((m) => m.id === c.playWith)?.name ?? "a member"}` : null].filter(Boolean).join(" · ") : "";
    if (!money) {
      Alert.alert(e.name, extra || undefined, [
        ...(!started && officer ? [{ text: "Take off the outing", style: "destructive" as const, onPress: () => void act(`off-${e.memberId}`, () => setOutingEntry(outingId, false, e.memberId)) }] : []),
        { text: "View profile", onPress: () => router.push({ pathname: "/member/[id]", params: { id: e.memberId } }) },
        { text: "Close", style: "cancel" as const },
      ]);
      return;
    }
    const paid = payments.get(e.memberId);
    const claim = paid ? undefined : claims.get(e.memberId);
    const mark = (s: Exclude<PaidStatus, "card"> | null, label: string) => ({ text: label, onPress: () => void act(`pay-${e.memberId}`, () => markOutingPaid(outingId, e.memberId, s)) });
    const status = paid ? PAID_LABELS[paid] : claim ? `Says they paid by ${CLAIM_LABELS[claim]} · ${feeLabel(outing.entryFeeCents)}` : outing.entryFeeCents ? `Not paid yet · ${feeLabel(outing.entryFeeCents)}` : undefined;
    Alert.alert(e.name, [status, extra].filter(Boolean).join("\n") || undefined, [
      ...(claim
        ? [
            mark(claim === "cash" ? "cash" : "transfer", `Confirm — received by ${CLAIM_LABELS[claim]}`),
            { text: "Not received", onPress: () => void act(`pay-${e.memberId}`, () => claimOutingPaid(outingId, null, e.memberId)) },
          ]
        : []),
      ...(paid !== "card" && !claim
        ? [
            ...(paid !== "cash" ? [mark("cash", "Paid cash")] : []),
            ...(paid !== "transfer" ? [mark("transfer", "Paid by transfer")] : []),
            ...(paid !== "waived" ? [mark("waived", "Waive the fee")] : []),
            ...(paid ? [mark(null, "Not paid")] : []),
          ]
        : []),
      ...(!started && officer
        ? [
            {
              text: "Take off the outing",
              style: "destructive" as const,
              onPress: () => void act(`off-${e.memberId}`, () => setOutingEntry(outingId, false, e.memberId)),
            },
          ]
        : []),
      { text: "View profile", onPress: () => router.push({ pathname: "/member/[id]", params: { id: e.memberId } }) },
      { text: "Close", style: "cancel" as const },
    ]);
  }

  function cancelIt() {
    Alert.alert(`Cancel ${outing.title}?`, "It stays in the list marked as cancelled, and nobody can join it.", [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel the outing", style: "destructive", onPress: () => void act("cancel", () => cancelOuting(outingId)) },
    ]);
  }

  const openItinerary = () => router.push({ pathname: "/group/[id]/itinerary/[outingId]", params: { id: String(groupId), outingId: String(outingId) } });
  const openDraw = () => router.push({ pathname: "/live/day/group", params: { group: String(groupId), outing: String(outingId) } });
  const paidCount = entries.filter((e) => payments.has(e.memberId)).length + guests.filter((g) => guestPayments.has(g.id)).length;
  const inCount = entries.length + guests.length;
  const full = outing.maxEntries != null && inCount >= outing.maxEntries;
  const claimCount = entries.filter((e) => !payments.has(e.memberId) && claims.has(e.memberId)).length;

  async function share() {
    try {
      // A trip lists its courses, from the rounds on its itinerary.
      const courses = trip ? (await loadItinerary(outingId).catch(() => [])).filter((i) => i.kind === "round").sort((a, b) => (a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : 0)).map((i) => i.title) : [];
      const message = outingShareText({ ...outing, societyName, courses }, SITE_URL);
      await Share.share(Platform.OS === "ios" ? { message, url: SITE_URL } : { message });
    } catch {
      // The member closed the share sheet.
    }
  }

  const queueRow = (q: QueueEntry, line?: number) => (
    <Pressable key={q.id} style={styles.person} onPress={() => queueMenu(q)} accessibilityRole="button" accessibilityLabel={`${q.name}, ${q.status === "requested" ? "asking for a place" : q.status === "offered" ? "offered a place" : `waiting, ${line ? ordinal(line) : ""}`}`}>
      <Avatar url={q.avatarUrl} color={q.avatarColor} name={q.name} size={36} />
      <View style={styles.personBody}>
        <Text style={styles.personName} numberOfLines={1}>
          {line ? `${line}. ${q.name}` : q.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[q.guestName ? `+ ${q.guestName}` : null, choices.get(q.memberId)?.note ? "Has a note" : null, new Date(q.askedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" })].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Chip tone={q.status === "requested" ? "asked" : "wait"}>{q.status === "requested" ? "Requested" : q.status === "offered" ? "Offered" : "Waiting"}</Chip>
      {q.status !== "requested" ? (
        <Pressable style={[styles.addButton, { backgroundColor: colors.gold400 }]} onPress={() => void act(`p-${q.memberId}`, () => promoteOutingWaiting(outingId, q.memberId))} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`Give ${q.name} a place`}>
          <Text style={[styles.addButtonText, { color: colors.navy900 }]}>Promote</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );

  const person = (r: Row) => {
    if (r.guest) {
      const g = r.guest;
      const paid = guestPayments.get(g.id);
      return (
        <Pressable key={r.key} style={styles.person} onPress={() => guestMenu(g)} disabled={!officer && !money} accessibilityRole={officer || money ? "button" : undefined} accessibilityLabel={`${g.name}, guest${money && paid ? `, ${PAID_LABELS[paid]}` : ""}`}>
          <View style={styles.guestBadge}>
            <Ionicons name="person-outline" size={17} color={colors.navy900} />
          </View>
          <View style={styles.personBody}>
            <Text style={styles.personName} numberOfLines={1}>
              {g.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {g.handicapIndex != null ? `Guest · index ${indexLabel(g.handicapIndex)}` : "Guest"}
            </Text>
          </View>
          {money && outing.entryFeeCents ? (
            <View style={[styles.paid, paid ? styles.paidYes : styles.paidNo]}>
              <Text style={[styles.paidText, paid ? styles.paidYesText : styles.paidNoText]}>{paid ? (paid === "waived" ? "Waived" : "Paid") : "Unpaid"}</Text>
            </View>
          ) : null}
        </Pressable>
      );
    }
    const e = r.member!;
    const paid = payments.get(e.memberId);
    const claimed = !paid && claims.has(e.memberId);
    return (
      <Pressable key={r.key} style={styles.person} onPress={() => entrantMenu(e)} accessibilityRole="button" accessibilityLabel={`${e.name}${officer && paid ? `, ${PAID_LABELS[paid]}` : ""}`}>
        <Avatar url={e.avatarUrl} color={e.avatarColor} name={e.name} size={36} />
        <View style={styles.personBody}>
          <Text style={styles.personName} numberOfLines={1}>
            {e.memberId === userId ? `${e.name} (you)` : e.name}
          </Text>
          {e.homeClub ? (
            <Text style={styles.meta} numberOfLines={1}>
              {e.homeClub}
            </Text>
          ) : null}
        </View>
        {money && outing.entryFeeCents ? (
          <View style={[styles.paid, paid ? styles.paidYes : claimed ? styles.paidClaim : styles.paidNo]}>
            <Text style={[styles.paidText, paid ? styles.paidYesText : claimed ? styles.paidClaimText : styles.paidNoText]}>{paid ? (paid === "waived" ? "Waived" : "Paid") : claimed ? "Says paid" : "Unpaid"}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          title: outing.title,
          headerBackTitle: "Back",
          contentStyle: FULL_WIDTH_CONTENT,
          headerRight: cancelled
            ? undefined
            : () => (
                <Pressable onPress={() => void share()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Share to Instagram, Facebook, WhatsApp…">
                  <Ionicons name="share-outline" size={22} color={colors.navy900} />
                </Pressable>
              ),
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.body, pageColumn(wide)]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <TwoPane
          wide={wide}
          left={
        <>
        {offlineAt ? (
          <View style={styles.warnRow}>
            <Ionicons name="cloud-offline-outline" size={18} color="#4d3203" />
            <Text style={[styles.warn, { flex: 1, padding: 0 }]}>
              {`No signal — showing what was saved on your phone ${new Date(offlineAt).toLocaleString("en-IE", { weekday: "short", hour: "numeric", minute: "2-digit" })}. Pull down to refresh.`}
            </Text>
          </View>
        ) : null}
        <View style={styles.hero}>
          <Text style={styles.heroDate}>{trip ? `${tripBadge(outing.kind, outing.playsOn, outing.endsOn)} · ${tripRangeLabel(outing.playsOn, outing.endsOn!).toUpperCase()}` : outingDateLabel(outing.playsOn).toUpperCase()}</Text>
          <Text style={[styles.heroTitle, cancelled && styles.struck]}>{outing.title}</Text>
          <Text style={styles.heroMeta}>
            {trip
              ? [outing.location, cancelled ? null : countdownLabel(outing.playsOn, outing.endsOn!, irishToday())].filter(Boolean).join(" · ")
              : [outing.courseName, outing.firstTee ? `First tee ${clock(outing.firstTee)}` : null].filter(Boolean).join(" · ")}
          </Text>
          <View style={styles.heroFacts}>
            {outing.entryFeeCents != null ? <Text style={styles.heroFact}>{`${trip ? "Cost" : "Entry"} ${feeLabel(outing.entryFeeCents)}`}</Text> : null}
            <Text style={styles.heroFact}>{`${inCount}${outing.maxEntries ? ` of ${outing.maxEntries}` : ""} in`}</Text>
          </View>
          <Text style={styles.heroCloses}>
            {cancelled
              ? "This outing was cancelled"
              : past
                ? "Played"
                : started
                  ? "The round is under way"
                  : closesAt
                    ? open
                      ? `Entries close ${closesAt.toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Europe/Dublin" })}`
                      : "Entries closed"
                    : closesLabel(outing.playsOn)}
          </Text>
          {!cancelled && (me || myQueue) ? (
            <View style={styles.heroChips}>
              <PlaceChip status={me ? "confirmed" : myQueue!.status} linePosition={myLine} />
              {me && outing.entryFeeCents && !myPaid ? <Chip tone="due">Payment due</Chip> : null}
            </View>
          ) : null}
        </View>

        {/* Played (Oct 2026): the results lead, not the entry details. */}
        {past && !cancelled && !trip ? (
          started ? (
            <Pressable
              style={styles.resultsCta}
              onPress={() => router.push({ pathname: "/live/day/results/[id]", params: { id: String(outing.matchDayId) } })}
              accessibilityRole="button"
            >
              <Ionicons name="trophy" size={20} color={colors.navy900} />
              <View style={{ flex: 1 }}>
                <Text style={styles.resultsCtaTitle}>See the results</Text>
                <Text style={styles.resultsCtaBody}>Winners, the full table and every card</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.navy900} />
            </Pressable>
          ) : (
            <View style={styles.noResults}>
              <Ionicons name="trophy-outline" size={18} color={colors.ink500} />
              <Text style={styles.noResultsText}>
                {officer
                  ? "No results for this one — the round wasn't scored on PinPals. Next time, start the round from the event and the results land here."
                  : "No results for this one — the round wasn't scored on PinPals."}
              </Text>
            </View>
          )
        ) : null}

        {/* The day itself (0142): arrival, format, dress, meals, where. */}
        {!trip && (outing.arriveBy || outing.formatLabel || outing.dressCode || outing.mealOptions.length || outing.guestFeeCents != null || outing.courseName) ? (
          <View style={styles.facts}>
            <View style={styles.factGrid}>
              {outing.arriveBy ? <Fact k="Arrive by" v={clock(outing.arriveBy)!} /> : null}
              {outing.firstTee ? <Fact k="First tee" v={clock(outing.firstTee)!} /> : null}
              {outing.formatLabel ? <Fact k="Format" v={outing.formatLabel} /> : null}
              {outing.guestFeeCents != null && outing.guestsAllowed ? <Fact k="Guests" v={outing.guestFeeCents ? euro(outing.guestFeeCents) : "Free"} /> : null}
            </View>
            {outing.dressCode ? <Fact k="Dress" v={outing.dressCode} wide /> : null}
            {outing.mealOptions.length ? <Fact k="Meal" v={outing.mealOptions.join(", ")} wide /> : null}
            {outing.courseName ? (
              <Pressable
                style={styles.directions}
                onPress={() => {
                  const q = encodeURIComponent(`${outing.courseName} golf club`);
                  void Linking.openURL(Platform.OS === "ios" ? `maps:?q=${q}` : `geo:0,0?q=${q}`).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`));
                }}
                accessibilityRole="button"
                accessibilityLabel={`Directions to ${outing.courseName}`}
              >
                <Ionicons name="navigate-outline" size={18} color={colors.cream50} />
                <Text style={styles.directionsText}>Directions</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {outing.details ? <Text style={styles.details}>{outing.details}</Text> : null}

        {trip ? (
          <Pressable style={styles.itinerary} onPress={openItinerary} accessibilityRole="button">
            <Ionicons name="map-outline" size={22} color={colors.gold400} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itineraryTitle}>{officer && !cancelled ? "Itinerary · build and edit" : "The itinerary"}</Text>
              <Text style={styles.itineraryBody}>{me ? "Your flights, room and tee times, day by day" : "Rounds, flights, where you're staying, day by day"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.cream100} />
          </Pressable>
        ) : null}

        {/* You */}
        {myGroup ? (
          <View style={styles.teeCard}>
            <Text style={styles.teeKicker}>{past ? "YOU PLAYED" : myGroup.start ? "SHOTGUN START" : "YOUR TEE TIME"}</Text>
            <Text style={styles.teeTime}>{clock(myGroup.time) ?? `Group ${myGroup.n}`}</Text>
            {myGroup.start ? <Text style={styles.teeWith}>{`You start on the ${ordinal(myGroup.start.hole)} tee${myGroup.start.letter && groups.ordered.some((o) => o !== myGroup && o.start?.hole === myGroup.start?.hole) ? ` — group ${myGroup.start.hole}${myGroup.start.letter}` : ""}`}</Text> : null}
            <Text style={styles.teeWith}>
              {myGroup.list.filter((p) => p.member?.memberId !== userId).length > 0
                ? `Group ${myGroup.n} · with ${myGroup.list
                    .filter((p) => p.member?.memberId !== userId)
                    .map((p) => (p.guest ? `${p.name} (guest)` : p.name))
                    .join(", ")}`
                : `Group ${myGroup.n}`}
            </Text>
          </View>
        ) : me && outing.drawPublishedAt ? (
          <Text style={styles.note}>{`You're in. ${cap(organisers(kind))} hasn't put you in a group yet.`}</Text>
        ) : null}

        {past && !trip ? null : started ? (
          <Pressable style={styles.cta} onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(outing.matchDayId) } })} accessibilityRole="button">
            <Ionicons name="podium-outline" size={18} color={colors.cream50} />
            <Text style={styles.ctaText}>Leaderboard and cards</Text>
          </Pressable>
        ) : myQueue?.status === "offered" && !cancelled ? (
          <View style={styles.offer}>
            <Text style={styles.offerTitle}>A place opened up — it&apos;s yours if you want it</Text>
            <Text style={styles.offerBody}>
              {myQueue.offerExpiresAt
                ? `Take it by ${new Date(myQueue.offerExpiresAt).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Europe/Dublin" })}, or it goes to the next person.`
                : "Take it, or it goes to the next person."}
            </Text>
            <View style={styles.officerRow}>
              <Pressable style={[styles.cta, { flex: 1 }]} onPress={() => void act("me", () => answerOutingOffer(outingId, true))} disabled={busy !== null} accessibilityRole="button">
                <Text style={styles.ctaText}>Take the place</Text>
              </Pressable>
              <Pressable
                style={[styles.cta, styles.ctaSoft, { flex: 1 }]}
                onPress={() =>
                  Alert.alert("Let the place go?", "It goes to the next person on the list.", [
                    { text: "Keep it", style: "cancel" },
                    { text: "Let it go", style: "destructive", onPress: () => void act("me", () => answerOutingOffer(outingId, false)) },
                  ])
                }
                disabled={busy !== null}
                accessibilityRole="button"
              >
                <Text style={[styles.ctaText, styles.ctaSoftText]}>Let it go</Text>
              </Pressable>
            </View>
          </View>
        ) : myQueue && !cancelled ? (
          <View style={styles.queued}>
            <Text style={styles.queuedTitle}>
              {myQueue.status === "requested" ? "You've asked for a place" : `You're on the waiting list${myLine ? ` · ${ordinal(myLine)}` : ""}`}
            </Text>
            <Text style={styles.queuedBody}>
              {myQueue.status === "requested"
                ? `${cap(organisers(kind))} will answer — you'll get a notification.`
                : "When a place opens you'll get a notification, and 24 hours to take it."}
            </Text>
            <View style={styles.officerRow}>
              {open ? (
                <Pressable style={styles.small} onPress={openRequest} accessibilityRole="button">
                  <Ionicons name="create-outline" size={16} color={colors.navy900} />
                  <Text style={styles.smallText}>Change my request</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.small} onPress={leaveQueue} accessibilityRole="button">
                <Ionicons name="close-circle-outline" size={16} color={colors.red600} />
                <Text style={[styles.smallText, { color: colors.red600 }]}>{myQueue.status === "requested" ? "Withdraw" : "Come off the list"}</Text>
              </Pressable>
            </View>
          </View>
        ) : open ? (
          me ? (
            <>
              <Pressable style={[styles.cta, styles.ctaSoft]} onPress={leave} disabled={busy !== null} accessibilityRole="button">
                {busy === "me" ? <ActivityIndicator color={colors.green800} /> : <Ionicons name="checkmark-circle" size={18} color={colors.green700} />}
                <Text style={[styles.ctaText, styles.ctaSoftText]}>You&apos;re in · Cancel my place</Text>
              </Pressable>
              {outing.mealOptions.length || !trip ? (
                <Pressable onPress={openRequest} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.linkText}>{outing.mealOptions.length ? "Your meal and playing requests" : "Your playing requests"}</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Pressable style={styles.cta} onPress={join} disabled={busy !== null} accessibilityRole="button">
                {busy === "me" ? <ActivityIndicator color={colors.cream50} /> : <Ionicons name="add-circle-outline" size={18} color={colors.cream50} />}
                <Text style={styles.ctaText}>
                  {outing.entryMode === "request" ? "Request a place" : full ? "Join the waiting list" : trip ? "Join this trip" : "Join this outing"}
                </Text>
              </Pressable>
              {outing.entryMode === "join" && outing.mealOptions.length === 0 && outing.guestsAllowed && !full ? (
                <Pressable onPress={openRequest} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.linkText}>Bring a guest or ask to play with someone</Text>
                </Pressable>
              ) : null}
              {outing.entryMode === "request" ? <Text style={styles.note}>{`${cap(organisers(kind))} gives out places for this one.`}</Text> : null}
            </>
          )
        ) : me ? (
          <Text style={styles.note}>{`You're in. Entries have closed — ask ${organisers(kind)} to make any change.`}</Text>
        ) : null}

        {me && outing.entryFeeCents && !cancelled ? (
          <OutingPayCard
            outing={outing}
            myName={me.name}
            paid={myPaid}
            claim={userId ? claims.get(userId) : undefined}
            busy={busy === "claim"}
            onClaim={(m: ClaimMethod | null) => void act("claim", () => claimOutingPaid(outingId, m))}
          />
        ) : null}

        {/* The captain and secretary */}
        {officer && !cancelled ? (
          <View style={styles.officer}>
            <Text style={styles.officerTitle}>{kind === "society" ? "Captain & secretary" : "Organiser"}</Text>
            {!started && !past && !trip ? (
              <Pressable style={[styles.cta, styles.ctaNavy]} onPress={openDraw} accessibilityRole="button">
                <Ionicons name="shuffle" size={18} color={colors.cream50} />
                <Text style={styles.ctaText}>{today ? "Draw and start the round" : outing.drawPublishedAt ? "Change the draw" : "Make the draw"}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.officerHint}>
              {trip
                ? "Add rounds, flights, rooms and notes on the itinerary; each round has its own groups and tee times."
                : started
                ? "The round has started."
                : today
                  ? "It's the day: check the draw, choose the tees, then start the round."
                  : "Publish the tee times whenever you're ready; members see theirs straight away. You start the round on the day."}
            </Text>
            {outing.entryFeeCents && money ? <Text style={styles.officerHint}>{`${paidCount} of ${inCount} paid or waived${claimCount ? ` · ${claimCount} say they've paid` : ""}. Tap a name to mark it.`}</Text> : null}
            {requests.length || waiting.length ? (
              <Text style={styles.officerHint}>{[requests.length ? `${requests.length} asking for a place` : null, waiting.length ? `${waiting.length} on the waiting list` : null].filter(Boolean).join(" · ")} — below.</Text>
            ) : null}
            <View style={styles.officerRow}>
              <Pressable
                style={styles.small}
                onPress={() => router.push({ pathname: "/group/[id]/message", params: { id: String(groupId), audience: "entrants", outing: String(outingId) } } as never)}
                accessibilityRole="button"
              >
                <Ionicons name="paper-plane-outline" size={16} color={colors.navy900} />
                <Text style={styles.smallText}>Message entrants</Text>
              </Pressable>
              {kind === "society" ? (
                <Pressable style={styles.small} onPress={() => router.push({ pathname: "/group/[id]/exports", params: { id: String(groupId) } } as never)} accessibilityRole="button">
                  <Ionicons name="download-outline" size={16} color={colors.navy900} />
                  <Text style={styles.smallText}>Booking sheet</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.officerRow}>
              {!started ? (
                <Pressable
                  style={styles.small}
                  onPress={() => router.push({ pathname: "/group/[id]/outing/new", params: { id: String(groupId), edit: String(outingId) } })}
                  accessibilityRole="button"
                >
                  <Ionicons name="create-outline" size={16} color={colors.navy900} />
                  <Text style={styles.smallText}>Edit</Text>
                </Pressable>
              ) : null}
              {!started ? (
                <Pressable style={styles.small} onPress={() => setAdding((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: adding }}>
                  <Ionicons name="person-add-outline" size={16} color={colors.navy900} />
                  <Text style={styles.smallText}>Add members</Text>
                </Pressable>
              ) : null}
              {!started ? (
                <Pressable
                  style={styles.small}
                  onPress={() => setGuestForm((f) => (f ? null : { id: null, name: "", index: "" }))}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: guestForm !== null }}
                >
                  <Ionicons name="person-outline" size={16} color={colors.navy900} />
                  <Text style={styles.smallText}>Add a guest</Text>
                </Pressable>
              ) : null}
              {!started ? (
                <Pressable style={styles.small} onPress={cancelIt} accessibilityRole="button">
                  <Ionicons name="close-circle-outline" size={16} color={colors.red600} />
                  <Text style={[styles.smallText, { color: colors.red600 }]}>Cancel outing</Text>
                </Pressable>
              ) : null}
            </View>
            {guestForm ? (
              <View style={styles.guestForm}>
                <Text style={styles.guestFormTitle}>{guestForm.id == null ? "Add a guest" : "Change the guest"}</Text>
                <Text style={styles.officerHint}>Someone who isn&apos;t on PinPals. They take a place and go in the draw like anyone else.</Text>
                <View style={styles.guestFields}>
                  <TextInput
                    value={guestForm.name}
                    onChangeText={(v) => setGuestForm((f) => (f ? { ...f, name: v } : f))}
                    placeholder="Guest's name"
                    placeholderTextColor={colors.ink500}
                    style={[styles.guestInput, { flex: 1 }]}
                    maxLength={60}
                    autoCapitalize="words"
                    accessibilityLabel="Guest's name"
                  />
                  <TextInput
                    value={guestForm.index}
                    onChangeText={(v) => setGuestForm((f) => (f ? { ...f, index: v } : f))}
                    placeholder="Index"
                    placeholderTextColor={colors.ink500}
                    style={[styles.guestInput, styles.guestIndex]}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    accessibilityLabel="Guest's handicap index, optional"
                  />
                </View>
                <View style={styles.officerRow}>
                  <Pressable style={[styles.addButton, !guestForm.name.trim() && { opacity: 0.4 }]} onPress={() => void saveGuest()} disabled={!guestForm.name.trim() || busy !== null} accessibilityRole="button">
                    {busy === "guest" ? <ActivityIndicator size="small" color={colors.cream50} /> : <Text style={styles.addButtonText}>{guestForm.id == null ? "Add guest" : "Save"}</Text>}
                  </Pressable>
                  <Pressable style={styles.small} onPress={() => setGuestForm(null)} accessibilityRole="button">
                    <Text style={styles.smallText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {adding ? (
              notIn.length === 0 ? (
                <Text style={styles.officerHint}>{`Everyone in the ${groupNoun(kind)} is in.`}</Text>
              ) : (
                notIn.map((m) => (
                  <View key={m.id} style={styles.addRow}>
                    <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={30} />
                    <Text style={styles.addName} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Pressable style={styles.addButton} onPress={() => void act(`add-${m.id}`, () => setOutingEntry(outingId, true, m.id))} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`Add ${m.name}`}>
                      {busy === `add-${m.id}` ? <ActivityIndicator size="small" color={colors.cream50} /> : <Text style={styles.addButtonText}>Add</Text>}
                    </Pressable>
                  </View>
                ))
              )
            ) : null}
          </View>
        ) : null}

        </>
          }
          right={
        <>
        {/* Requests and the waiting list (0142): the officers. */}
        {officer && !cancelled && requests.length > 0 ? (
          <>
            <SectionTitle>{`Asking for a place (${requests.length})`}</SectionTitle>
            {full ? <Text style={styles.warn}>{`The event is full${outing.maxEntries ? ` (${inCount} of ${outing.maxEntries})` : ""}. Put people on the waiting list, or add places in Edit.`}</Text> : null}
            {requests.map((q) => queueRow(q))}
          </>
        ) : null}
        {officer && !cancelled && waiting.length > 0 ? (
          <>
            <SectionTitle>{`Waiting list (${waiting.length})`}</SectionTitle>
            {waiting.map((q, i) => queueRow(q, i + 1))}
            <Text style={styles.officerHint}>
              {outing.autoOffer ? "When someone withdraws, the place is offered to the first in line, who has 24 hours to take it." : "Places aren't offered automatically on this event — tap someone to give them a place."}
            </Text>
          </>
        ) : null}
        {(officer || money) && withdrawals.length > 0 ? (
          <>
            <SectionTitle>{`Withdrew (${withdrawals.length})`}</SectionTitle>
            {withdrawals.map((w) => {
              const p = payments.get(w.memberId);
              const back = entries.some((e) => e.memberId === w.memberId);
              return (
                <View key={w.id} style={styles.person}>
                  <View style={styles.personBody}>
                    <Text style={styles.personName}>{w.name}</Text>
                    <Text style={styles.meta}>{`Withdrew ${new Date(w.at).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}${back ? " · back in since" : ""}${money && p ? ` · ${p === "refunded" ? "refunded" : PAID_LABELS[p as PaidStatus] ?? p}` : ""}`}</Text>
                  </View>
                  {money && !back && p && p !== "waived" && p !== "card" ? (
                    <Pressable style={styles.small} onPress={() => void act(`ref-${w.memberId}`, () => markOutingRefunded(outingId, w.memberId, p !== "refunded"))} accessibilityRole="button">
                      <Text style={styles.smallText}>{p === "refunded" ? "Undo refund" : "Mark refunded"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}

        {/* Who's in */}
        {groups.ordered.length > 0 ? (
          <>
            <SectionTitle>Tee times</SectionTitle>
            {groups.ordered.map((g) => (
              <View key={g.n} style={[styles.group, g.n === me?.teeGroup && styles.groupMine]}>
                <Text style={styles.groupTitle}>{`${clock(g.time) ?? ""}${g.time ? " · " : ""}${g.start ? `Starts ${g.start.hole}${g.start.letter && groups.ordered.some((o) => o !== g && o.start?.hole === g.start?.hole) ? g.start.letter : ""} · ` : ""}Group ${g.n}`}</Text>
                {g.list.map(person)}
              </View>
            ))}
            {groups.undrawn.length > 0 ? (
              <>
                <SectionTitle>{`Not drawn yet (${groups.undrawn.length})`}</SectionTitle>
                {groups.undrawn.map(person)}
              </>
            ) : null}
          </>
        ) : (
          <>
            <SectionTitle>{`Who's in (${inCount})`}</SectionTitle>
            {inCount === 0 ? <Text style={styles.note}>Nobody yet{open ? " — be the first." : "."}</Text> : groups.all.map(person)}
          </>
        )}
        </>
          }
        />
        <DoneHome saved={saved ? "Saved — everyone in the group can see it under Events" : null} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  hero: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  heroDate: { fontFamily: fonts.bodyBold, fontSize: 12.5, letterSpacing: 1.2, color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  struck: { textDecorationLine: "line-through" },
  itinerary: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  itineraryTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  itineraryBody: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  heroMeta: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.cream100 },
  heroFacts: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  heroFact: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900, backgroundColor: colors.gold400, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill, overflow: "hidden" },
  heroCloses: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100, marginTop: 4 },
  details: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, lineHeight: 22 },
  teeCard: { alignItems: "center", gap: 2, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.green100, borderWidth: 1, borderColor: colors.green600 },
  teeKicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.green800 },
  teeTime: { fontFamily: fonts.display, fontSize: 40, color: colors.green800 },
  teeWith: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green800, textAlign: "center" },
  note: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", paddingVertical: 4 },
  cta: { flexDirection: "row", gap: 8, minHeight: 50, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  ctaSoft: { backgroundColor: colors.green100, borderWidth: 1, borderColor: colors.green600 },
  ctaNavy: { backgroundColor: colors.navy900 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  ctaSoftText: { color: colors.green800 },
  payRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: colors.cream100 },
  payText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  officer: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.gold400, backgroundColor: "#fbf3df" },
  officerTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  officerHint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink900 },
  officerRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  small: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, height: 36, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  smallText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  addButton: { paddingHorizontal: 14, height: 32, borderRadius: radii.pill, justifyContent: "center", backgroundColor: colors.green700 },
  addButtonText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  group: { gap: 6, padding: spacing.sm, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceTint },
  groupMine: { borderColor: colors.green600, backgroundColor: colors.green100 },
  groupTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.navy900, paddingHorizontal: 4 },
  person: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 10, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  personBody: { flex: 1, gap: 1 },
  personName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  paid: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radii.pill },
  guestBadge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream100, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed" },
  guestForm: { gap: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  guestFormTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  guestFields: { flexDirection: "row", gap: spacing.sm },
  // 16pt floor: iOS zooms the screen when a smaller input takes focus.
  guestInput: { minHeight: 44, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  guestIndex: { width: 84, textAlign: "center" },
  paidYes: { backgroundColor: colors.green100 },
  paidNo: { backgroundColor: colors.red100 },
  paidClaim: { backgroundColor: "#fbf3df", borderWidth: 1, borderColor: colors.gold400 },
  paidClaimText: { color: "#7a5a12" },
  paidText: { fontFamily: fonts.bodySemi, fontSize: 12 },
  heroChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  resultsCta: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.gold400 },
  resultsCtaTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  resultsCtaBody: { fontFamily: fonts.body, fontSize: 13, color: colors.navy900 },
  noResults: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, backgroundColor: colors.surface },
  noResultsText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500 },
  facts: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  factGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fact: { gap: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.cream100, minWidth: 120, flexGrow: 1 },
  factK: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, color: "#7e5f14" },
  factV: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  directions: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: radii.md, backgroundColor: colors.navy900 },
  directionsText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  offer: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.gold500, backgroundColor: "#fbf3df" },
  offerTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  offerBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  queued: { gap: 6, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  queuedTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  queuedBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  linkText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900, textAlign: "center", textDecorationLine: "underline", paddingVertical: 6 },
  warnRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 10, borderRadius: radii.md, backgroundColor: "#f5e6c6" },
  warn: { fontFamily: fonts.body, fontSize: 13, color: "#4d3203", backgroundColor: "#f5e6c6", padding: 10, borderRadius: radii.md },
  paidYesText: { color: colors.green800 },
  paidNoText: { color: colors.red600 },
});

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Fact({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <View style={[styles.fact, wide && { alignSelf: "stretch" }]}>
      <Text style={styles.factK}>{k.toUpperCase()}</Text>
      <Text style={styles.factV}>{v}</Text>
    </View>
  );
}

/** A member or a guest, as the page lists them. */
type Row = {
  key: string;
  name: string;
  member: OutingEntry | null;
  guest: OutingGuest | null;
  teeGroup: number | null;
  teeTime: string | null;
  teePosition: number | null;
  /** Shotgun start (0173). */
  start: OutingStart;
};
