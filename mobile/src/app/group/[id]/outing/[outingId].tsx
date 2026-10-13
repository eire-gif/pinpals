import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { DoneHome } from "@/components/done-home";
import { Avatar } from "@/components/avatar";
import { OutingPayCard } from "@/components/outing-pay-card";
import { SectionTitle } from "@/components/group-bits";
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
  cancelOuting,
  claimOutingPaid,
  loadOuting,
  markOutingGuestPaid,
  markOutingPaid,
  removeOutingGuest,
  setOutingEntry,
  updateOutingGuest,
  type OutingEntry,
  type OutingGuest,
  type OutingPage,
} from "@/lib/outings";
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
  const [societyName, setSocietyName] = useState<string | null>(null);
  const [kind, setKind] = useState<GroupKind | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** The guest form: closed, adding a new guest, or changing one. */
  const [guestForm, setGuestForm] = useState<null | { id: number | null; name: string; index: string }>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [o, g] = await Promise.all([loadOuting(outingId), loadGroupPage(groupId, userId)]);
      setPage(o);
      setMembers(g?.members ?? []);
      setOfficer(g?.myRole === "owner" || g?.myRole === "admin");
      setSocietyName(g?.group.name ?? null);
      setKind(g?.group.kind ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
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
      ...(page?.entries ?? []).map((e): Row => ({ key: `m:${e.memberId}`, name: e.name, member: e, guest: null, teeGroup: e.teeGroup, teeTime: e.teeTime, teePosition: e.teePosition })),
      ...(page?.guests ?? []).map((g): Row => ({ key: `g:${g.id}`, name: g.name, member: null, guest: g, teeGroup: g.teeGroup, teeTime: g.teeTime, teePosition: g.teePosition })),
    ];
    const drawn = new Map<number, Row[]>();
    for (const r of rows) if (r.teeGroup) drawn.set(r.teeGroup, [...(drawn.get(r.teeGroup) ?? []), r]);
    const ordered = [...drawn.entries()].sort((a, b) => a[0] - b[0]).map(([n, list]) => ({ n, time: list[0]?.teeTime ?? null, list: list.sort((a, b) => (a.teePosition ?? 0) - (b.teePosition ?? 0)) }));
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

  const { outing, entries, payments, claims, guests, guestPayments } = page;
  const me = entries.find((e) => e.memberId === userId) ?? null;
  const cancelled = outing.status === "cancelled";
  const started = outing.matchDayId != null;
  const trip = isTrip(outing.kind) && outing.endsOn != null;
  const past = outingPast(outing.endsOn ?? outing.playsOn);
  const open = !cancelled && !started && entriesOpen(outing.playsOn);
  const today = isOutingDay(outing.playsOn);
  const myPaid = userId ? payments.get(userId) : undefined;
  const myGroup = me?.teeGroup ? groups.ordered.find((g) => g.n === me.teeGroup) : null;
  const notIn = members.filter((m) => !entries.some((e) => e.memberId === m.id));

  function join() {
    void act("me", () => setOutingEntry(outingId, true));
  }
  function leave() {
    Alert.alert(`Cancel your place at ${outing.title}?`, "You can join again until midnight before the day.", [
      { text: "Keep my place", style: "cancel" },
      { text: "Cancel my place", style: "destructive", onPress: () => void act("me", () => setOutingEntry(outingId, false)) },
    ]);
  }

  function guestMenu(g: OutingGuest) {
    if (!officer) return;
    const paid = guestPayments.get(g.id);
    const mark = (s: Exclude<PaidStatus, "card"> | null, label: string) => ({ text: label, onPress: () => void act(`gpay-${g.id}`, () => markOutingGuestPaid(g.id, s)) });
    const detail = [g.handicapIndex != null ? `Guest · index ${indexLabel(g.handicapIndex)}` : "Guest", outing.entryFeeCents ? (paid ? PAID_LABELS[paid] : `Not paid yet · ${feeLabel(outing.entryFeeCents)}`) : null].filter(Boolean).join("\n");
    Alert.alert(g.name, detail, [
      ...(outing.entryFeeCents
        ? [
            ...(paid !== "cash" ? [mark("cash", "Paid cash")] : []),
            ...(paid !== "transfer" ? [mark("transfer", "Paid by transfer")] : []),
            ...(paid !== "waived" ? [mark("waived", "Waive the fee")] : []),
            ...(paid ? [mark(null, "Not paid")] : []),
          ]
        : []),
      ...(!started
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
    if (!officer) {
      router.push({ pathname: "/member/[id]", params: { id: e.memberId } });
      return;
    }
    const paid = payments.get(e.memberId);
    const claim = paid ? undefined : claims.get(e.memberId);
    const mark = (s: Exclude<PaidStatus, "card"> | null, label: string) => ({ text: label, onPress: () => void act(`pay-${e.memberId}`, () => markOutingPaid(outingId, e.memberId, s)) });
    Alert.alert(e.name, paid ? PAID_LABELS[paid] : claim ? `Says they paid by ${CLAIM_LABELS[claim]} · ${feeLabel(outing.entryFeeCents)}` : outing.entryFeeCents ? `Not paid yet · ${feeLabel(outing.entryFeeCents)}` : undefined, [
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
      ...(!started
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

  const person = (r: Row) => {
    if (r.guest) {
      const g = r.guest;
      const paid = guestPayments.get(g.id);
      return (
        <Pressable key={r.key} style={styles.person} onPress={() => guestMenu(g)} disabled={!officer} accessibilityRole={officer ? "button" : undefined} accessibilityLabel={`${g.name}, guest${officer && paid ? `, ${PAID_LABELS[paid]}` : ""}`}>
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
          {officer && outing.entryFeeCents ? (
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
        {officer && outing.entryFeeCents ? (
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
        contentContainerStyle={styles.body}
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
          <Text style={styles.heroCloses}>{cancelled ? "This outing was cancelled" : started ? "The round is under way" : past ? "Played" : closesLabel(outing.playsOn)}</Text>
        </View>

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
            <Text style={styles.teeKicker}>YOUR TEE TIME</Text>
            <Text style={styles.teeTime}>{clock(myGroup.time) ?? `Group ${myGroup.n}`}</Text>
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

        {started ? (
          <Pressable style={styles.cta} onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(outing.matchDayId) } })} accessibilityRole="button">
            <Ionicons name="podium-outline" size={18} color={colors.cream50} />
            <Text style={styles.ctaText}>Leaderboard and cards</Text>
          </Pressable>
        ) : open ? (
          me ? (
            <Pressable style={[styles.cta, styles.ctaSoft]} onPress={leave} disabled={busy !== null} accessibilityRole="button">
              {busy === "me" ? <ActivityIndicator color={colors.green800} /> : <Ionicons name="checkmark-circle" size={18} color={colors.green700} />}
              <Text style={[styles.ctaText, styles.ctaSoftText]}>You&apos;re in · Cancel my place</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.cta} onPress={join} disabled={busy !== null} accessibilityRole="button">
              {busy === "me" ? <ActivityIndicator color={colors.cream50} /> : <Ionicons name="add-circle-outline" size={18} color={colors.cream50} />}
              <Text style={styles.ctaText}>{trip ? "Join this trip" : "Join this outing"}</Text>
            </Pressable>
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
            {outing.entryFeeCents ? <Text style={styles.officerHint}>{`${paidCount} of ${inCount} paid or waived${claimCount ? ` · ${claimCount} say they've paid` : ""}. Tap a name to mark it.`}</Text> : null}
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

        {/* Who's in */}
        {groups.ordered.length > 0 ? (
          <>
            <SectionTitle>Tee times</SectionTitle>
            {groups.ordered.map((g) => (
              <View key={g.n} style={[styles.group, g.n === me?.teeGroup && styles.groupMine]}>
                <Text style={styles.groupTitle}>{`${clock(g.time) ?? ""}${g.time ? " · " : ""}Group ${g.n}`}</Text>
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
  paidYesText: { color: colors.green800 },
  paidNoText: { color: colors.red600 },
});

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** A member or a guest, as the page lists them. */
type Row = {
  key: string;
  name: string;
  member: OutingEntry | null;
  guest: OutingGuest | null;
  teeGroup: number | null;
  teeTime: string | null;
  teePosition: number | null;
};
