import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Tabs, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { ScreenHeader, useCollapsingHeader } from "@/components/screen-header";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { addToCalendar } from "@/lib/calendar";
import { isOn } from "@/lib/features";
import { deleteRound, setRoundStatus } from "@/lib/hosting";
import { conversationWith } from "@/lib/members";
import { loadMyRounds } from "@/lib/my-rounds";
import {
  firstName,
  forFilter,
  listNames,
  shortDate,
  type Filter,
  type MyRound,
  type MyRoundsView,
  type Need,
  type PlayedRound,
  type Slot,
  type Tone,
} from "@/lib/my-rounds-rules";
import { confirmPlace, respondToRequest, withdrawRequest } from "@/lib/tee-time-interest";
import { guideHidden, hideGuide } from "@/lib/my-rounds-guide";
import { teeTimesChanged } from "@/lib/tee-times-waiting";
import { ForecastRow } from "@/components/weather-bits";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * My rounds (Oct 2026) — every tee time a member is part of, on one page.
 *
 * Replaces Rounds I've posted, Confirmed rounds, Rounds I've asked to join
 * and Places offered to you; those routes now forward here. The approved
 * mock-up and the rules behind it are in claude/my-rounds-redesign.md, and
 * what each card says is decided in lib/my-rounds-rules.ts.
 *
 * Top to bottom: filter tabs (All · Hosting · Playing · Requested), a short
 * "how a round comes together" strip, NEEDS YOUR ANSWER (requests to your
 * rounds and places offered to you — the only things waiting on you), then
 * COMING UP and PLAYED.
 *
 * ?invite=<id> (every tee-time alert): opens on All, scrolled to that round
 * with a gold border round it — and if it's waiting on you, the answer card
 * is the first thing on the page anyway.
 * ?show=hosting|playing|requested: opens on that tab.
 */

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "hosting", label: "Hosting" },
  { key: "playing", label: "Playing" },
  { key: "requested", label: "Requested" },
];

function MyRoundsScreenInner() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const params = useLocalSearchParams<{ invite?: string; show?: string }>();
  const focusId = params.invite && /^\d{1,15}$/.test(params.invite) ? Number(params.invite) : null;
  const startFilter = FILTERS.some((f) => f.key === params.show) ? (params.show as Filter) : "all";

  const [view, setView] = useState<MyRoundsView | null>(null);
  const [filter, setFilter] = useState<Filter>(startFilter);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Hidden once means hidden for good, on this phone (lib/my-rounds-guide.ts).
  // Starts hidden and appears once the phone says it wasn't, so a member who
  // dismissed it never sees it flash back for a frame.
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    let live = true;
    void guideHidden().then((hidden) => live && setShowGuide(!hidden));
    return () => {
      live = false;
    };
  }, []);

  const { scrollY, scrollProps } = useCollapsingHeader();
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<{ needs: number; upcoming: number; cards: Map<number, number> }>({
    needs: 0,
    upcoming: 0,
    cards: new Map(),
  });
  const scrolledTo = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      setView(await loadMyRounds(userId));
      setError(null);
    } catch {
      setError("Couldn't load your rounds just now. Pull down to try again.");
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

  // A new alert opens the same screen with a different ?invite — start
  // again on All so the round can't be hidden behind a tab, and scroll to
  // it once its card has laid out (onCardLayout).
  useEffect(() => {
    scrolledTo.current = null;
    if (focusId !== null) setFilter("all");
  }, [focusId]);

  const scrollTo = (y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: true });

  const onCardLayout = (inviteId: number) => (e: LayoutChangeEvent) => {
    const y = offsets.current.upcoming + e.nativeEvent.layout.y;
    offsets.current.cards.set(inviteId, y);
    if (focusId === inviteId && scrolledTo.current !== inviteId) {
      scrolledTo.current = inviteId;
      // After the frame, so the list under it has laid out too.
      setTimeout(() => scrollTo(y), 50);
    }
  };

  async function run(key: string, work: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError(null);
    try {
      await work();
      if (done) setToast(done);
      teeTimesChanged();
      await load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "That didn't go through. Check your signal and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function message(memberId: string) {
    try {
      const conversation = await conversationWith(memberId);
      router.push({ pathname: "/conversation/[id]", params: { id: String(conversation) } });
    } catch (err) {
      Alert.alert("Couldn't open a conversation", err instanceof Error ? err.message : "Please try again.");
    }
  }

  // ---- answers ----------------------------------------------------------

  const offerPlace = (need: Extract<Need, { kind: "request" }>) =>
    void run(
      `need-${need.interestId}`,
      () => respondToRequest(need.interestId, true),
      `Place offered to ${firstName(need.person.name)}. You'll be told when they confirm.`
    );

  const declineRequest = (need: Extract<Need, { kind: "request" }>) =>
    Alert.alert(
      `Decline ${firstName(need.person.name)}?`,
      "They'll be told this round can't fit them in. No reason is given.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: () =>
            void run(`need-${need.interestId}`, () => respondToRequest(need.interestId, false), `${firstName(need.person.name)} has been let know.`),
        },
      ]
    );

  const confirmOffer = (interestId: number, hostName: string, date: string) =>
    void run(`need-${interestId}`, () => confirmPlace(interestId, true), `You're in for ${shortDate(date)}. ${firstName(hostName)}'s been told.`);

  const giveBack = (interestId: number, hostName: string, club: string, date: string, confirmed: boolean) =>
    Alert.alert(
      confirmed ? "Cancel your place?" : "Can't make it?",
      `${club}, ${shortDate(date)}. ${firstName(hostName)} will be told so the place can go to someone else.`,
      [
        { text: "Keep my place", style: "cancel" },
        {
          text: "Give it back",
          style: "destructive",
          onPress: () =>
            void run(`need-${interestId}`, () => confirmPlace(interestId, false), `Done. ${firstName(hostName)}'s been told.`),
        },
      ]
    );

  const withdraw = (interestId: number, hostName: string, club: string, date: string) =>
    Alert.alert(
      "Withdraw your request?",
      `${club}, ${shortDate(date)}. ${firstName(hostName)} hasn't answered yet, so nothing changes for them. You can ask again later.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => void run(`need-${interestId}`, () => withdrawRequest(interestId), "Request withdrawn."),
        },
      ]
    );

  // ---- host actions -----------------------------------------------------

  const cancelRound = (round: MyRound) =>
    Alert.alert(
      "Cancel this round?",
      round.slots.some((s) => s.state !== "me" && s.state !== "open") || round.pendingCount > 0
        ? "Everyone who asked to join, or has a place, will be told it's off. It stays on their page marked Cancelled."
        : "Nobody has asked to join yet.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel round",
          style: "destructive",
          onPress: () => void run(`round-${round.inviteId}`, () => setRoundStatus(round.inviteId, "cancelled"), "Round cancelled."),
        },
      ]
    );

  const deleteIt = (round: MyRound) =>
    Alert.alert("Delete this round?", "It disappears for good. Nobody has asked to join it.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(`round-${round.inviteId}`, () => deleteRound(round.inviteId), "Round deleted.") },
    ]);

  const toggleFull = (round: MyRound) =>
    void run(`round-${round.inviteId}`, () => setRoundStatus(round.inviteId, round.isMarkedFull ? "open" : "full"));

  const primary = (round: MyRound) => {
    switch (round.next) {
      case "answer":
        setFilter((f) => (f === "playing" ? "all" : f));
        scrollTo(offsets.current.needs);
        return;
      case "confirm":
        if (round.myInterestId) confirmOffer(round.myInterestId, round.host.name, round.playDate);
        return;
      case "share":
        router.push({ pathname: "/round-invite", params: { id: String(round.inviteId) } });
        return;
      case "calendar":
        void addToCalendar("tee_time", round.inviteId);
        return;
      case "findAnother":
        router.push("/tee-times");
        return;
      default:
        router.push(`/invite/${round.inviteId}`);
    }
  };

  // ---- render ----------------------------------------------------------

  const shown = useMemo(() => (view ? forFilter(view, filter) : { needs: [], upcoming: [], played: [] }), [view, filter]);
  const needTotal = view?.needs.length ?? 0;
  const comingUp = view?.counts.all ?? 0;

  const subtitle = loading
    ? "Loading"
    : `${comingUp} ${comingUp === 1 ? "round" : "rounds"} coming up${needTotal > 0 ? ` · ${needTotal} ${needTotal === 1 ? "needs" : "need"} you` : ""}`;

  return (
    <View style={styles.fill}>
      {/* Oct 2026: My rounds lives inside the tab group (href: null in
          (tabs)/_layout.tsx) so the six bottom tabs — Home, Tee Times and
          the rest — stay on screen here. A tab has no back arrow of its
          own, so Back is drawn here. */}
      <Tabs.Screen
        options={{
          headerTitle: "",
          headerLeft: () => (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
              hitSlop={8}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={20} color={colors.ink900} />
              <Text style={styles.backLabel}>Back</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/post-tee-time")}
              hitSlop={8}
              style={styles.post}
              accessibilityRole="button"
              accessibilityLabel="Post a round"
            >
              <Ionicons name="add" size={18} color={colors.ink900} />
              <Text style={styles.postLabel}>Post a round</Text>
            </Pressable>
          ),
        }}
      />

      <ScreenHeader scene="linksDusk" title="My rounds" subtitle={subtitle} scrollY={scrollY} />

      <View style={styles.tabsWrap}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {FILTERS.map(({ key, label }) => {
            const on = filter === key;
            const count = view?.counts[key] ?? 0;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setFilter(key);
                  setMenuFor(null);
                }}
                style={[styles.tab, on && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${label}, ${count}`}
              >
                <Text style={[styles.tabLabel, on && styles.tabLabelOn]} numberOfLines={1}>
                  {label}
                </Text>
                <View style={[styles.tabCount, on && styles.tabCountOn]}>
                  <Text style={[styles.tabCountLabel, on && styles.tabCountLabelOn]}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      ) : (
        <ScrollView
          {...scrollProps}
          ref={scrollRef}
          style={styles.fill}
          contentContainerStyle={styles.content}
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
        >
          {showGuide ? (
            <Guide
              onClose={() => {
                setShowGuide(false);
                void hideGuide();
              }}
            />
          ) : null}

          {toast ? (
            <Pressable style={styles.toast} onPress={() => setToast(null)} accessibilityRole="button" accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={20} color={colors.green700} />
              <Text style={styles.toastLabel}>{toast}</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {shown.needs.length > 0 ? (
            <View style={styles.section} onLayout={(e) => (offsets.current.needs = e.nativeEvent.layout.y)}>
              <View style={styles.needsHeading}>
                <View style={styles.needsDot} />
                <Text style={[styles.sectionTitle, styles.needsTitle]}>Needs your answer · {shown.needs.length}</Text>
              </View>
              {shown.needs.map((need) => (
                <NeedCard
                  key={`${need.kind}-${need.interestId}`}
                  need={need}
                  busy={busy === `need-${need.interestId}`}
                  onYes={() =>
                    need.kind === "request" ? offerPlace(need) : confirmOffer(need.interestId, need.host.name, need.playDate)
                  }
                  onNo={() =>
                    need.kind === "request"
                      ? declineRequest(need)
                      : giveBack(need.interestId, need.host.name, need.club, need.playDate, false)
                  }
                  onMessage={() => void message(need.kind === "request" ? need.person.id : need.host.id)}
                  onOpen={() => router.push(`/invite/${need.inviteId}`)}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.section} onLayout={(e) => (offsets.current.upcoming = e.nativeEvent.layout.y)}>
            <Text style={styles.sectionTitle}>Coming up</Text>
            {shown.upcoming.length === 0 ? (
              <Empty filter={filter} />
            ) : (
              shown.upcoming.map((round) => (
                <View key={round.inviteId} onLayout={onCardLayout(round.inviteId)}>
                  <RoundCard
                    round={round}
                    focused={round.inviteId === focusId}
                    busy={busy === `round-${round.inviteId}` || (round.myInterestId !== null && busy === `need-${round.myInterestId}`)}
                    menuOpen={menuFor === round.inviteId}
                    onToggleMenu={() => setMenuFor((m) => (m === round.inviteId ? null : round.inviteId))}
                    onOpen={() => router.push(`/invite/${round.inviteId}`)}
                    onPrimary={() => primary(round)}
                    onToggleFull={() => toggleFull(round)}
                    onCancel={() => cancelRound(round)}
                    onDelete={() => deleteIt(round)}
                    onMessageHost={() => void message(round.host.id)}
                    onLeave={() => {
                      if (round.myInterestId === null) return;
                      if (round.role === "asked") withdraw(round.myInterestId, round.host.name, round.club, round.playDate);
                      else giveBack(round.myInterestId, round.host.name, round.club, round.playDate, round.role === "playing");
                    }}
                  />
                </View>
              ))
            )}
          </View>

          {shown.played.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Played</Text>
              <View style={styles.playedBox}>
                {shown.played.map((p, i) => (
                  <PlayedRow key={p.inviteId} round={p} first={i === 0} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------

function Guide({ onClose }: { onClose: () => void }) {
  const steps: { n: string; label: string; dot: object; text: object }[] = [
    { n: "1", label: "Ask to join a round", dot: styles.step1, text: styles.stepN1 },
    { n: "2", label: "Host offers a place", dot: styles.step2, text: styles.stepN2 },
    { n: "3", label: "You confirm", dot: styles.step3, text: styles.stepN3 },
    { n: "4", label: "Play & share", dot: styles.step4, text: styles.stepN4 },
  ];
  return (
    <View style={styles.guide} accessibilityLabel="How a round comes together: ask to join, the host offers a place, you confirm, then play and share.">
      <View style={styles.guideHead}>
        <Text style={styles.guideTitle}>How a round comes together</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide this guide">
          <Ionicons name="close" size={18} color={colors.ink500} />
        </Pressable>
      </View>
      <View style={styles.steps}>
        {steps.map((s) => (
          <View key={s.n} style={styles.step}>
            <View style={[styles.stepDot, s.dot]}>
              <Text style={[styles.stepN, s.text]}>{s.n}</Text>
            </View>
            <Text style={styles.stepLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function NeedCard({
  need,
  busy,
  onYes,
  onNo,
  onMessage,
  onOpen,
}: {
  need: Need;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
  onMessage: () => void;
  onOpen: () => void;
}) {
  const who = need.kind === "request" ? need.person : need.host;
  const sub = [who.handicap !== null ? `${who.handicap} hcp` : null, who.homeClub].filter(Boolean).join(" · ");
  const detail =
    need.kind === "request"
      ? `${shortDate(need.playDate)} · ${need.when} · ${need.spacesAvailable} ${need.spacesAvailable === 1 ? "place" : "places"} open`
      : `${shortDate(need.playDate)} · ${need.when}${need.withNames.length > 0 ? ` · with ${listNames([firstName(who.name), ...need.withNames])}` : ""}`;

  return (
    <View style={styles.need}>
      <Text style={styles.needKicker}>{need.kind === "request" ? "Someone wants to join your round" : "You've been offered a place"}</Text>
      <View style={styles.needWho}>
        <View style={styles.needAvatar}>
          <Avatar url={who.avatarUrl} color={who.avatarColor} name={who.name} size={44} />
        </View>
        <View style={styles.flex1}>
          <Text style={styles.needName}>
            {need.kind === "request" ? `${who.name} asked to join` : `${who.name} has a place for you`}
          </Text>
          {sub ? <Text style={styles.muted}>{sub}</Text> : null}
        </View>
      </View>
      <Pressable style={styles.needRound} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open the round at ${need.club}`}>
        <Ionicons name="flag-outline" size={18} color={colors.green700} />
        <View style={styles.flex1}>
          <Text style={styles.needClub} numberOfLines={1}>
            {need.club}
          </Text>
          <Text style={styles.muted}>{detail}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.ink500} />
      </Pressable>
      {busy ? (
        <ActivityIndicator color={colors.green700} style={styles.needBusy} />
      ) : (
        <View style={styles.needActions}>
          <Pressable style={[styles.btn, styles.btnGreen, styles.flex1]} onPress={onYes} accessibilityRole="button">
            <Text style={styles.btnGreenLabel}>{need.kind === "request" ? "Offer a place" : "Confirm my place"}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnOutline, styles.flex1]} onPress={onNo} accessibilityRole="button">
            <Text style={styles.btnDangerLabel}>{need.kind === "request" ? "Decline" : "Can't make it"}</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.btnOutline, styles.btnIcon]}
            onPress={onMessage}
            accessibilityRole="button"
            accessibilityLabel={`Message ${firstName(who.name)}`}
          >
            <Ionicons name="chatbubble-outline" size={19} color={colors.green700} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const BADGE: Record<MyRound["role"], { label: string; box: object; text: object }> = {
  hosting: { label: "You're hosting", box: { backgroundColor: "#f7edcf", borderColor: colors.gold400 }, text: { color: "#6b5212" } },
  playing: { label: "You're playing", box: { backgroundColor: colors.green100, borderColor: "#b9cdb4" }, text: { color: colors.green800 } },
  offered: { label: "Place offered", box: { backgroundColor: colors.gold400, borderColor: colors.gold500 }, text: { color: colors.ink900 } },
  asked: { label: "Requested", box: { backgroundColor: colors.surface, borderColor: "#b9ae96", borderStyle: "dashed" }, text: { color: colors.ink500 } },
  declined: { label: "Not this time", box: { backgroundColor: colors.cream100, borderColor: colors.line }, text: { color: colors.ink500 } },
  cancelled: { label: "Cancelled", box: { backgroundColor: colors.red600, borderColor: colors.red600 }, text: { color: colors.surface } },
};

const NEXT_LABEL: Record<MyRound["next"], string> = {
  answer: "Answer request",
  confirm: "Confirm my place",
  share: "Share this round",
  view: "View round",
  calendar: "Add to calendar",
  findAnother: "Find another round",
  none: "",
};

function RoundCard({
  round,
  focused,
  busy,
  menuOpen,
  onToggleMenu,
  onOpen,
  onPrimary,
  onToggleFull,
  onCancel,
  onDelete,
  onMessageHost,
  onLeave,
}: {
  round: MyRound;
  focused: boolean;
  busy: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpen: () => void;
  onPrimary: () => void;
  onToggleFull: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onMessageHost: () => void;
  onLeave: () => void;
}) {
  const dead = round.role === "cancelled" || round.role === "declined";
  const badge = BADGE[round.role];
  const [dow, day, mon] = shortDate(round.playDate).split(" ");
  const isHost = round.role === "hosting" || (round.role === "cancelled" && round.myInterestId === null);
  const gold = round.next === "answer" || round.next === "confirm";
  const quiet = round.next === "share" || round.next === "view";
  const primaryBox = gold ? styles.btnGold : quiet ? styles.btnOutline : styles.btnGreen;
  const primaryText = gold ? styles.btnGoldLabel : quiet ? styles.btnOutlineLabel : styles.btnGreenLabel;

  return (
    <View style={[styles.card, dead && styles.cardDead, round.role === "cancelled" && styles.cardCancelled, focused && styles.cardFocused]}>
      {round.cancelNote ? (
        <View style={styles.cancelNote}>
          <Ionicons name="close-circle-outline" size={16} color="#7e2e1c" />
          <Text style={styles.cancelNoteLabel}>{round.cancelNote}</Text>
        </View>
      ) : null}

      <Pressable style={styles.cardHead} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${round.club}, ${shortDate(round.playDate)}, ${round.when}. ${badge.label}.`}>
        <View style={styles.dateBlock}>
          <Text style={styles.dateDow}>{dow?.toUpperCase()}</Text>
          <Text style={styles.dateDay}>{day}</Text>
          <Text style={styles.dateMon}>{mon?.toUpperCase()}</Text>
        </View>
        <View style={styles.flex1}>
          <View style={styles.titleRow}>
            <Text style={[styles.club, dead && styles.clubDead]} numberOfLines={2}>
              {round.club}
            </Text>
            <View style={[styles.badge, badge.box]}>
              <Text style={[styles.badgeLabel, badge.text]}>{badge.label}</Text>
            </View>
          </View>
          <Text style={styles.muted}>
            {round.when}
            {isHost ? "" : ` · hosted by ${firstName(round.host.name)}`}
          </Text>
        </View>
      </Pressable>

      {/* The forecast from the tee time (Oct 2026), within ten days; when it will show, beyond. */}
      {!dead && round.clubRef ? (
        <ForecastRow clubId={round.clubRef.id} playDate={round.playDate} tee={round.teeTime} />
      ) : null}

      {round.slots.length > 0 ? (
        <View style={[styles.players, dead && styles.faded]}>
          <View style={styles.slots}>
            {round.slots.map((slot) => (
              <SlotDot key={slot.key} slot={slot} />
            ))}
          </View>
          {round.slotText ? <Text style={styles.slotText}>{round.slotText}</Text> : null}
        </View>
      ) : null}

      <View>
        <View style={styles.bar}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.barSeg,
                i < round.stage.filled && styles.barDone,
                round.stage.waiting && i === round.stage.filled && styles.barWaiting,
              ]}
            />
          ))}
        </View>
        <View style={styles.statusRow}>
          <StatusDot tone={round.tone} />
          <Text style={styles.status}>{round.status}</Text>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator color={colors.green700} style={styles.needBusy} />
      ) : (
        <View style={styles.cardActions}>
          {round.next !== "none" ? (
            <Pressable style={[styles.btn, styles.flex1, primaryBox]} onPress={onPrimary} accessibilityRole="button">
              <Text style={primaryText}>{NEXT_LABEL[round.next]}</Text>
            </Pressable>
          ) : (
            <View style={styles.flex1} />
          )}
          <Pressable
            style={[styles.btn, styles.btnOutline, styles.btnIcon]}
            onPress={onToggleMenu}
            accessibilityRole="button"
            accessibilityLabel="More options for this round"
            accessibilityState={{ expanded: menuOpen }}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink900} />
          </Pressable>
        </View>
      )}

      {menuOpen && !busy ? (
        <View style={styles.menu}>
          <MenuButton label="Open round" icon="open-outline" onPress={onOpen} />
          {isHost && round.canToggleFull ? (
            <MenuButton
              label={round.isMarkedFull ? "Re-open" : "Mark full"}
              icon={round.isMarkedFull ? "lock-open-outline" : "lock-closed-outline"}
              onPress={onToggleFull}
            />
          ) : null}
          {isHost && round.canCancel ? <MenuButton label="Cancel round" icon="close-circle-outline" danger onPress={onCancel} /> : null}
          {isHost && round.canDelete ? <MenuButton label="Delete" icon="trash-outline" danger onPress={onDelete} /> : null}
          {!isHost ? <MenuButton label={`Message ${firstName(round.host.name)}`} icon="chatbubble-outline" onPress={onMessageHost} /> : null}
          {!isHost && round.leaveLabel ? <MenuButton label={round.leaveLabel} icon="exit-outline" danger onPress={onLeave} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function MenuButton({
  label,
  icon,
  danger,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.menuButton} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={16} color={danger ? colors.red600 : colors.green700} />
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

function SlotDot({ slot }: { slot: Slot }) {
  const style =
    slot.state === "me"
      ? styles.slotMe
      : slot.state === "in"
        ? styles.slotIn
        : slot.state === "offered"
          ? styles.slotOffered
          : styles.slotOpen;
  const text =
    slot.state === "me" ? styles.slotMeLabel : slot.state === "in" ? styles.slotInLabel : slot.state === "offered" ? styles.slotOfferedLabel : styles.slotOpenLabel;
  return (
    <View
      style={[styles.slot, style]}
      accessible
      accessibilityLabel={
        slot.state === "open" ? "Open place" : slot.state === "offered" ? `${slot.name}, place offered, not confirmed yet` : `${slot.name}, confirmed`
      }
    >
      <Text style={[styles.slotLabel, text, slot.state === "me" && styles.slotLabelSmall]}>{slot.initials}</Text>
    </View>
  );
}

function StatusDot({ tone }: { tone: Tone }) {
  const s =
    tone === "gold"
      ? styles.dotGold
      : tone === "goldRing"
        ? styles.dotGoldRing
        : tone === "green"
          ? styles.dotGreen
          : tone === "red"
            ? styles.dotRed
            : styles.dotGrey;
  return <View style={[styles.dot, s]} />;
}

function PlayedRow({ round, first }: { round: PlayedRound; first: boolean }) {
  const recap = isOn("recapPrompts");
  return (
    <View style={[styles.played, !first && styles.playedDivider]}>
      <View style={styles.trophy}>
        <Ionicons name="trophy-outline" size={18} color={colors.gold400} />
      </View>
      <Pressable style={styles.flex1} onPress={() => router.push(`/invite/${round.inviteId}`)} accessibilityRole="button">
        <Text style={styles.playedClub} numberOfLines={1}>
          {round.club}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {shortDate(round.playDate)}
          {round.withNames.length > 0 ? ` · with ${listNames(round.withNames.map(firstName))}` : ""}
        </Text>
      </Pressable>
      {recap ? (
        <Pressable
          style={styles.share}
          onPress={() => router.push({ pathname: "/new-post", params: { type: "round", recap: String(round.inviteId) } })}
          accessibilityRole="button"
          accessibilityLabel={`Share your round at ${round.club}`}
        >
          <Text style={styles.shareLabel}>Share</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Empty({ filter }: { filter: Filter }) {
  const copy: Record<Filter, [string, string]> = {
    all: ["Nothing coming up", "Post a round, or find one and ask the host for a place."],
    hosting: ["Nothing posted", "Post a round and golfers can ask to join you. You choose who plays."],
    playing: ["No rounds to play yet", "When you confirm a place, the round lands here with everyone's names."],
    requested: ["You haven't asked to join anything", "Find a round that suits and ask the host for a place."],
  };
  const [title, body] = copy[filter];
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      <Pressable
        style={[styles.btn, styles.btnGreen, styles.emptyCta]}
        onPress={() => router.push(filter === "hosting" ? "/post-tee-time" : "/tee-times")}
        accessibilityRole="button"
      >
        <Text style={styles.btnGreenLabel}>{filter === "hosting" ? "Post a round" : "Browse tee times"}</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------

const GOLD_TINT = "#f7edcf";
const GOLD_TEXT = "#6b5212";
const CARD_BORDER = "#e4d9c2";

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  flex1: { flex: 1, minWidth: 0 },
  centre: { alignItems: "center", justifyContent: "center" },
  muted: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginTop: 2 },
  faded: { opacity: 0.45 },

  post: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 34,
    paddingHorizontal: 12,
    marginRight: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
  },
  postLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: spacing.sm, height: 34 },
  backLabel: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink900 },

  tabsWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 2 },
  tabs: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    backgroundColor: colors.surface,
  },
  tab: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 12 },
  tabOn: { backgroundColor: colors.green700 },
  tabLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink900 },
  tabLabelOn: { color: colors.surface },
  tabCount: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.pill, backgroundColor: colors.cream100, alignItems: "center" },
  tabCountOn: { backgroundColor: colors.gold400 },
  tabCountLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  tabCountLabelOn: { color: colors.ink900 },

  content: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: 22 },
  section: { gap: 12 },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, letterSpacing: 1.2, textTransform: "uppercase", color: colors.ink500 },

  guide: { borderRadius: 18, borderWidth: 1.5, borderColor: CARD_BORDER, backgroundColor: colors.surface, padding: 14, gap: 12 },
  guideHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  guideTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.1, textTransform: "uppercase", color: colors.ink500 },
  steps: { flexDirection: "row", gap: 6 },
  step: { flex: 1, alignItems: "center", gap: 6 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  step1: { backgroundColor: colors.green100, borderColor: "#b9cdb4" },
  step2: { backgroundColor: GOLD_TINT, borderColor: colors.gold400 },
  step3: { backgroundColor: colors.green700, borderColor: colors.green700 },
  step4: { backgroundColor: colors.ink900, borderColor: colors.ink900 },
  stepN: { fontFamily: fonts.bodyBold, fontSize: 14 },
  stepN1: { color: colors.green700 },
  stepN2: { color: GOLD_TEXT },
  stepN3: { color: colors.surface },
  stepN4: { color: colors.gold400 },
  stepLabel: { fontFamily: fonts.bodySemi, fontSize: 12, lineHeight: 15, color: colors.ink900, textAlign: "center" },

  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#b9cdb4",
    backgroundColor: colors.green100,
  },
  toastLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green800 },
  error: { fontFamily: fonts.body, fontSize: type.small, color: colors.red600, backgroundColor: colors.red100, borderRadius: radii.md, padding: spacing.md },

  needsHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  needsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold500 },
  needsTitle: { color: GOLD_TEXT },
  need: { borderRadius: 20, borderWidth: 2, borderColor: colors.gold400, backgroundColor: "#fffdf6", padding: spacing.md, gap: 12 },
  needKicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: GOLD_TEXT },
  needWho: { flexDirection: "row", alignItems: "center", gap: 12 },
  needAvatar: { borderRadius: 26, borderWidth: 2, borderColor: colors.gold400, padding: 1 },
  needName: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  needRound: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#efe5cc",
    backgroundColor: colors.surface,
  },
  needClub: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  needActions: { flexDirection: "row", gap: 8 },
  needBusy: { paddingVertical: 12 },

  btn: { minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  btnIcon: { width: 48, paddingHorizontal: 0 },
  btnGreen: { backgroundColor: colors.green700 },
  btnGreenLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.surface },
  btnGold: { backgroundColor: colors.gold400, borderWidth: 1.5, borderColor: colors.gold500 },
  btnGoldLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  btnOutline: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: "#d6c7a6" },
  btnOutlineLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700 },
  btnDangerLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.red600 },

  card: { borderRadius: 20, borderWidth: 1.5, borderColor: CARD_BORDER, backgroundColor: colors.surface, padding: 14, gap: 12 },
  cardDead: { backgroundColor: "#fbf8f4" },
  cardCancelled: { borderColor: "#e7c3b8" },
  cardFocused: { borderWidth: 2.5, borderColor: colors.gold500 },
  cancelNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e7c3b8",
    backgroundColor: colors.red100,
  },
  cancelNoteLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: "#7e2e1c" },

  cardHead: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  dateBlock: {
    width: 54,
    paddingTop: 6,
    paddingBottom: 7,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    backgroundColor: colors.surfaceTint,
    alignItems: "center",
  },
  dateDow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, color: colors.red600 },
  dateDay: { fontFamily: fonts.display, fontSize: 24, lineHeight: 27, color: colors.ink900 },
  dateMon: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.ink500 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  club: { flex: 1, fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: colors.ink900 },
  clubDead: { color: colors.ink500 },
  badge: { borderWidth: 1.5, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 4 },
  badgeLabel: { fontFamily: fonts.bodyBold, fontSize: 11.5 },

  players: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#efe7d5",
    backgroundColor: colors.surfaceTint,
  },
  slots: { flexDirection: "row", gap: 6, flexShrink: 1, flexWrap: "wrap" },
  slot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  slotMe: { backgroundColor: colors.ink900, borderWidth: 2, borderColor: colors.surface },
  slotIn: { backgroundColor: colors.green700, borderWidth: 2, borderColor: colors.surface },
  slotOffered: { backgroundColor: GOLD_TINT, borderWidth: 2, borderStyle: "dashed", borderColor: colors.gold500 },
  slotOpen: { backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#c9b98f" },
  slotLabel: { fontFamily: fonts.bodyBold, fontSize: 12 },
  slotLabelSmall: { fontSize: 10 },
  slotMeLabel: { color: colors.gold400 },
  slotInLabel: { color: colors.surface },
  slotOfferedLabel: { color: GOLD_TEXT },
  slotOpenLabel: { color: "#9a8c6b", fontSize: 16 },
  slotText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900, marginLeft: 8 },

  bar: { flexDirection: "row", gap: 4 },
  barSeg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "#ede6d6" },
  barDone: { backgroundColor: colors.green700 },
  barWaiting: { backgroundColor: colors.gold400 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  status: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotGold: { backgroundColor: colors.gold500 },
  dotGoldRing: { borderWidth: 2, borderColor: colors.gold500 },
  dotGreen: { backgroundColor: colors.green700 },
  dotRed: { backgroundColor: colors.red600 },
  dotGrey: { borderWidth: 2, borderColor: "#9aa3ad" },

  cardActions: { flexDirection: "row", gap: 8 },
  menu: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 10, borderTopWidth: 1.5, borderTopColor: "#efe7d5" },
  menuButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
    backgroundColor: colors.surface,
  },
  menuLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },
  menuLabelDanger: { color: colors.red600 },

  playedBox: { borderRadius: 20, borderWidth: 1.5, borderColor: CARD_BORDER, backgroundColor: colors.surface, overflow: "hidden" },
  played: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  playedDivider: { borderTopWidth: 1.5, borderTopColor: "#efe7d5" },
  trophy: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink900, alignItems: "center", justifyContent: "center" },
  playedClub: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  share: { minHeight: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.green700, justifyContent: "center" },
  shareLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },

  empty: { alignItems: "center", gap: 6, padding: 24, borderRadius: 20, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#d6c7a6", backgroundColor: colors.surface },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500, textAlign: "center" },
  emptyCta: { marginTop: 10, paddingHorizontal: 22, borderRadius: radii.pill },
});

/** Junior members (0159): tee times aren't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function MyRoundsScreen() {
  const gate = useAgeGate("teeTimes");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="teeTimes" title="Tee times" />;
  return <MyRoundsScreenInner />;
}
