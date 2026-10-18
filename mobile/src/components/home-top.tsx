import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { RaisedCard } from "@/components/live-scoring-card";
import { isOn } from "@/lib/features";
import type { HomeEvent, HomePlayer, HomeSummary, NextRound } from "@/lib/home";
import { loadFollowing, type FollowingItem } from "@/lib/live-follow";
import { openGamePath } from "@/lib/open-game";
import { myOpenGame, type MyOpenGame } from "@/lib/open-game-alert";
import { clockTime, todayIso } from "@/lib/tee-times";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing } from "@/lib/theme";

/**
 * The top of Home (Oct 2026), over the hero photograph:
 *
 *   1. Watch live — only when a member or connection has shared their round.
 *   2. The date and "Morning, Geoff." with your invite QR code.
 *   3. Today — on the day of a round (tee time, crew round or society
 *      outing) one card with Start your round here. Before it, within a
 *      week, a slim Up next strip. Nothing booked, nothing shown.
 *   4. Four big buttons in the live hub's own raised style: Find Golfers,
 *      Start a Round, Groups & Societies, Marketplace — every title the same
 *      size.
 *
 * Mock-ups: the "PinPals Home Page Ideas" canvas, boards ★.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Sunday 18 October" — built by hand so it never depends on Intl. */
export function longDate(d = new Date()): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

/** "in 42 min" / "in 2 hr 10 min" for a time later today; null otherwise. */
export function untilLabel(time: string | null, now = new Date()): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  const mins = Math.round((at.getTime() - now.getTime()) / 60000);
  if (mins <= 0 || mins > 12 * 60) return null;
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `in ${hrs} hr` : `in ${hrs} hr ${rest} min`;
}

const shortDay = (iso: string): string => {
  const [y, mo, d] = iso.split("-").map((x) => Number.parseInt(x, 10));
  return DAYS[new Date(y, mo - 1, d).getDay()].slice(0, 3).toUpperCase();
};

// ---------------------------------------------------------------------------
// Watch live
// ---------------------------------------------------------------------------

/** A live card someone shared with you (0158). Renders nothing otherwise. */
export function WatchLiveStrip() {
  const [item, setItem] = useState<FollowingItem | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!isOn("liveScoring")) return;
      let live = true;
      void loadFollowing()
        .then((all) => {
          if (live) setItem(all.find((f) => f.card.state === "live") ?? null);
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, [])
  );
  if (!item) return null;
  const c = item.card;
  const score = [c.summary.big, c.summary.unit].filter(Boolean).join(" ");
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/live/follow/[id]", params: { id: String(item.followId) } })}
      style={({ pressed }) => [styles.watch, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Watch ${c.name} live. ${score} ${c.summary.progress}`}
    >
      <View>
        <Avatar name={c.name} size={38} />
        <View style={styles.liveDot} />
      </View>
      <View style={styles.watchBody}>
        <Text style={styles.watchKicker}>Live · shared with you</Text>
        <Text style={styles.watchText} numberOfLines={1}>
          <Text style={styles.watchName}>{c.name}</Text>
          {` · ${score} ${c.summary.progress}`}
        </Text>
      </View>
      <Text style={styles.watchCta}>Watch live</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

export function HomeGreeting({ firstName, showQr }: { firstName: string | null; showQr: boolean }) {
  return (
    <View style={styles.greetRow}>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={styles.eyebrowRow}>
          <View style={styles.rule} />
          <Text style={styles.eyebrow}>{longDate()}</Text>
        </View>
        <Text style={styles.greet}>
          {greeting()}
          {firstName ? `, ${firstName}.` : "."}
        </Text>
      </View>
      {/* Your invite QR code — a golfer in the clubhouse can join from here. */}
      {showQr ? (
        <Pressable
          onPress={() => router.push("/invite-friends")}
          style={({ pressed }) => [styles.qr, pressed && styles.pressed]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Your PinPals QR code to invite someone"
        >
          <Ionicons name="qr-code-outline" size={26} color={colors.gold400} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Today / Up next
// ---------------------------------------------------------------------------

type Next = { kind: "tee"; round: NextRound } | { kind: "event"; event: HomeEvent };

/** The soonest of your tee time and your group event; the event on a tie. */
export function pickNext(summary: HomeSummary | null, teeTimes: boolean): Next | null {
  const round = teeTimes ? summary?.nextRound ?? null : null;
  const event = summary?.nextEvent ?? null;
  if (event && (!round || event.playsOn <= round.playDate)) return { kind: "event", event };
  return round ? { kind: "tee", round } : null;
}

const within = (iso: string, days: number): boolean => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const limit = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return iso <= limit;
};

/** True when the top card is showing this tee time (Home then skips its own card for it). */
export function showsTeeToday(next: Next | null): boolean {
  return next?.kind === "tee" && next.round.playDate === todayIso();
}

export function HomeToday({ summary, teeTimes }: { summary: HomeSummary | null; teeTimes: boolean }) {
  const [openGame, setOpenGame] = useState<MyOpenGame | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void myOpenGame()
        .then((g) => {
          if (live) setOpenGame(g);
        })
        .catch(() => undefined);
      return () => {
        live = false;
      };
    }, [])
  );

  const next = pickNext(summary, teeTimes);
  if (!next) return null;
  const date = next.kind === "tee" ? next.round.playDate : next.event.playsOn;
  const today = date === todayIso();

  if (!today) {
    if (!within(date, 7)) return null;
    return next.kind === "tee" ? (
      <UpNext
        day={shortDay(date)}
        time={next.round.when}
        kicker={next.round.role === "hosting" ? "Up next · you're hosting" : "Up next · you're playing"}
        title={next.round.club}
        tag={next.round.role === "hosting" && summary && summary.requestsWaiting > 0 ? { text: summary.requestsWaiting === 1 ? "1 request" : `${summary.requestsWaiting} requests`, alert: true } : { text: "You're in", alert: false }}
        onPress={() => router.push(`/invite/${next.round.inviteId}`)}
      />
    ) : (
      <UpNext
        day={shortDay(date)}
        time={clockTime(next.event.myTeeTime ?? next.event.firstTee) ?? "—"}
        kicker={`Up next · ${next.event.groupName}`}
        title={next.event.title}
        tag={next.event.paymentDue ? { text: "Pay entry", alert: true } : { text: "You're in", alert: false }}
        onPress={() => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(next.event.groupId), outingId: String(next.event.outingId) } })}
      />
    );
  }

  return next.kind === "tee" ? (
    <TeeToday round={next.round} players={summary?.todayPlayers ?? []} openGame={openGame} />
  ) : (
    <EventToday event={next.event} openGame={openGame} />
  );
}

function UpNext({
  day,
  time,
  kicker,
  title,
  tag,
  onPress,
}: {
  day: string;
  time: string;
  kicker: string;
  title: string;
  tag: { text: string; alert: boolean };
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.upNext, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${kicker}. ${title}, ${day} ${time}. ${tag.text}`}>
      <View style={styles.dateBlock}>
        <Text style={styles.dateDay}>{day}</Text>
        <Text style={styles.dateTime}>{time}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.upKicker} numberOfLines={1}>
          {kicker}
        </Text>
        <Text style={styles.upTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={[styles.tag, tag.alert ? styles.tagAlert : styles.tagOk]}>{tag.text}</Text>
    </Pressable>
  );
}

/** The gold "Start your round here" — or "Continue your round" once a game is open. */
function StartButton({ openGame, onStart }: { openGame: MyOpenGame | null; onStart: () => void }) {
  return (
    <Pressable
      onPress={() => (openGame ? router.push(openGamePath(openGame) as Href) : onStart())}
      accessibilityRole="button"
      style={styles.goldOuter}
    >
      {({ pressed }) => (
        <View style={[styles.goldLip, pressed && styles.goldLipPressed]}>
          <View style={styles.goldFace}>
            <Text style={styles.goldLabel}>
              <Ionicons name="flag" size={19} color={colors.navy900} /> {openGame ? "Continue your round" : "Start your round here"}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function Faces({ players }: { players: HomePlayer[] }) {
  if (players.length === 0) return null;
  return (
    <View style={styles.faces}>
      {players.slice(0, 4).map((p, i) => (
        <View key={`${p.name}-${i}`} style={[styles.face, { marginLeft: i === 0 ? 0 : -9 }]}>
          <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={32} />
        </View>
      ))}
    </View>
  );
}

function TodayFrame({ children }: { children: React.ReactNode }) {
  return <View style={styles.today}>{children}</View>;
}

function TeeToday({ round, players, openGame }: { round: NextRound; players: HomePlayer[]; openGame: MyOpenGame | null }) {
  const until = untilLabel(round.exactTime);
  return (
    <TodayFrame>
      <View style={styles.todayHead}>
        <View style={styles.liveDotGold} />
        <Text style={[styles.kicker, { flex: 1 }]} numberOfLines={1}>
          Today · {round.when} · {round.role === "hosting" ? "you're hosting" : "you're playing"}
        </Text>
        {until ? <Text style={styles.until}>{until}</Text> : null}
      </View>
      <View style={styles.todayTitleRow}>
        <Text style={[styles.todayTitle, { flex: 1 }]}>{round.club}</Text>
        <Faces players={players} />
      </View>
      <StartButton openGame={openGame} onStart={() => router.push({ pathname: "/live/new", params: { teeTime: String(round.inviteId) } })} />
      <View style={styles.links}>
        <Link label="Who's playing" onPress={() => router.push(`/invite/${round.inviteId}`)} />
        <Link label="My rounds" onPress={() => router.push("/my-rounds")} />
      </View>
    </TodayFrame>
  );
}

const KIND_LABEL: Partial<Record<HomeEvent["groupKind"], string>> = { crew: "Buddies round", trip: "Golf trip", society: "Society outing", club: "Club outing" };

function EventToday({ event, openGame }: { event: HomeEvent; openGame: MyOpenGame | null }) {
  const shotgun = event.start !== null;
  const myTime = clockTime(event.myTeeTime);
  const first = clockTime(event.firstTee);
  const until = untilLabel(event.myTeeTime ?? event.firstTee);
  const outingHref = { pathname: "/group/[id]/outing/[outingId]" as const, params: { id: String(event.groupId), outingId: String(event.outingId) } };

  const tiles: { value: string; label: string; mine?: boolean }[] = [];
  if (shotgun) {
    tiles.push({ value: first ?? "—", label: "Shotgun" });
    tiles.push({ value: `Hole ${event.start!.hole}${event.start!.letter ?? ""}`, label: "Your start", mine: true });
  } else {
    if (first && myTime && first !== myTime) tiles.push({ value: first, label: "First tee" });
    tiles.push({ value: myTime ?? first ?? "Draw to come", label: myTime ? "Your tee" : "First tee", mine: !!myTime });
  }
  tiles.push({ value: String(event.playing), label: "Playing" });

  return (
    <TodayFrame>
      <View style={styles.todayHead}>
        <View style={styles.badge}>
          <Ionicons name={event.groupKind === "society" ? "trophy" : event.groupKind === "trip" ? "airplane" : "people"} size={20} color={colors.gold400} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker} numberOfLines={1}>
            {KIND_LABEL[event.groupKind] ?? "Group round"} · today
          </Text>
          <Text style={styles.eventName} numberOfLines={2}>
            {event.groupName} · {event.title}
          </Text>
        </View>
        {event.hasFee ? (
          <Text style={[styles.tag, event.paymentDue ? styles.tagAlert : styles.tagPaid]}>{event.paymentDue ? "Pay entry" : "Paid ✓"}</Text>
        ) : until ? (
          <Text style={styles.until}>{until}</Text>
        ) : null}
      </View>

      {event.course ? <Text style={styles.todayTitle}>{event.course}</Text> : null}

      <View style={styles.tiles}>
        {tiles.map((t) => (
          <View key={t.label} style={[styles.tile, t.mine && styles.tileMine]}>
            <Text style={[styles.tileValue, t.mine && { color: colors.gold400 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {t.value}
            </Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {event.partners.length > 0 ? (
        <View style={styles.groupRow}>
          <Faces players={event.partners} />
          <Text style={styles.groupText} numberOfLines={2}>
            {event.myTeeGroup ? <Text style={styles.groupStrong}>Group {event.myTeeGroup}</Text> : null}
            {` · with ${event.partners.map((p) => p.name.split(" ")[0]).join(", ")}`}
          </Text>
        </View>
      ) : null}

      <StartButton
        openGame={openGame}
        onStart={() =>
          event.matchDayId
            ? router.push({ pathname: "/live/day/[id]", params: { id: String(event.matchDayId) } })
            : router.push("/live/new")
        }
      />
      <View style={styles.links}>
        <Link label="Draw & groups" onPress={() => router.push(outingHref)} />
        <Link label={event.groupKind === "society" ? "Society page" : "Group page"} onPress={() => router.push({ pathname: "/group/[id]", params: { id: String(event.groupId) } })} />
      </View>
    </TodayFrame>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="link">
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The four buttons
// ---------------------------------------------------------------------------

/** Find Golfers opens Find PinPals (the member directory), for members old
 *  enough to make connections. */
export function HomeButtons({ connections }: { connections: boolean }) {
  return (
    <View style={styles.buttons}>
      {connections ? (
        <RaisedCard
          inset={false}
          marginTop={0}
          tone="claret"
          icon="search"
          kicker="Play"
          title="Find Golfers"
          subtitle="Golfers at your club and near you — connect and play"
          wrapTitle
          onPress={() => router.push("/members")}
        />
      ) : null}
      {isOn("liveScoring") ? (
        <RaisedCard
          inset={false}
          marginTop={0}
          icon="flag"
          kicker="Live scoring"
          title="Start a Round"
          subtitle="Score with your group, watch the leaderboard move"
          wrapTitle
          onPress={() => router.navigate("/live")}
        />
      ) : null}
      {isOn("groups") ? (
        <RaisedCard
          inset={false}
          marginTop={0}
          tone="green"
          icon="people"
          kicker="Societies & outings"
          title="Groups & Societies"
          subtitle="Draw your buddies or society into groups and teams"
          wrapTitle
          onPress={() => router.push("/groups")}
        />
      ) : null}
      <RaisedCard
        inset={false}
        marginTop={0}
        tone="bronze"
        icon="pricetag"
        kicker="Buy & sell"
        title="Marketplace"
        subtitle="Clubs and gear from golfers near you"
        wrapTitle
        onPress={() => router.navigate("/marketplace")}
      />
    </View>
  );
}

/** "New here?" — opens the how-to guides. */
export function ExploreCard() {
  return (
    <Pressable
      onPress={() => router.push("/guide")}
      style={({ pressed }) => [styles.explore, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Explore how PinPals works"
    >
      <View style={styles.exploreDisc}>
        <Ionicons name="compass-outline" size={24} color={colors.cream50} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.exploreSub}>New here?</Text>
        <Text style={styles.exploreTitle}>Explore how PinPals works</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },

  watch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  liveDot: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.gold500,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  watchBody: { flex: 1 },
  watchKicker: { fontSize: 10, fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase", color: "#8a6a1f" },
  watchText: { fontFamily: fonts.body, fontSize: 15, color: colors.ink900 },
  watchName: { fontFamily: fonts.bodyBold },
  watchCta: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },

  greetRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 20, height: 2, backgroundColor: colors.gold400 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  greet: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.cream50 },
  qr: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: colors.gold400,
    backgroundColor: navyAlpha(0.5),
    alignItems: "center",
    justifyContent: "center",
  },

  upNext: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 12,
  },
  dateBlock: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  dateDay: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, color: colors.gold400 },
  dateTime: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400 },
  upKicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: colors.green700 },
  upTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900, marginTop: 1 },
  tag: { fontFamily: fonts.bodyBold, fontSize: 12, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden" },
  tagAlert: { backgroundColor: colors.red600, color: "#ffffff" },
  tagOk: { backgroundColor: colors.green100, color: colors.green800 },
  tagPaid: { backgroundColor: colors.gold400, color: colors.navy900 },

  today: {
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "rgba(232,196,107,0.85)",
    backgroundColor: "rgba(8,18,34,0.66)",
    padding: spacing.md,
    gap: 14,
  },
  todayHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  liveDotGold: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold400 },
  kicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.6, color: colors.gold400, textTransform: "uppercase" },
  until: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400 },
  todayTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  todayTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: colors.cream50 },
  eventName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50, marginTop: 2 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.gold400,
    backgroundColor: navyAlpha(0.6),
    alignItems: "center",
    justifyContent: "center",
  },
  faces: { flexDirection: "row" },
  face: { borderRadius: 18, borderWidth: 2, borderColor: colors.gold400 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(232,196,107,0.35)",
    backgroundColor: creamAlpha(0.07),
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  tileMine: { borderColor: colors.gold400, backgroundColor: "rgba(232,196,107,0.14)" },
  tileValue: { fontSize: 19, fontWeight: "800", color: colors.cream50 },
  tileLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", color: "#c9d3e3", marginTop: 2 },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: creamAlpha(0.06), borderRadius: 14, padding: 10 },
  groupText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: "#d9dee8" },
  groupStrong: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  links: { flexDirection: "row", justifyContent: "space-around" },
  link: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400, textDecorationLine: "underline" },

  goldOuter: {
    borderRadius: radii.pill,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  goldLip: { borderRadius: radii.pill, backgroundColor: "#9c7a2c", paddingBottom: 3 },
  goldLipPressed: { paddingBottom: 0, marginTop: 3 },
  goldFace: {
    minHeight: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
    borderWidth: 1,
    borderColor: "#f6dc97",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  goldLabel: { alignSelf: "stretch", textAlign: "center", color: colors.navy900, fontSize: 18, fontWeight: "800" },

  buttons: { gap: 18 },

  explore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#d9c79a",
    backgroundColor: colors.surfaceTint,
  },
  exploreDisc: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  exploreSub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  exploreTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
});
