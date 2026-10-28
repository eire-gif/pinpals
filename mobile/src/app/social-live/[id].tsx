import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Animated,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { coursePhoto } from "@/components/course-photos";
import { teamRows } from "@/components/scramble-board";
import { useAgeGate } from "@/components/not-for-under-18";
import { useAuth } from "@/lib/auth";
import { ago } from "@/lib/feed-rules";
import { loadMatchDay, type MatchDayData } from "@/lib/live-match-days";
import { toParLabel } from "@/lib/live-scoring";
import {
  addDayComment,
  deleteDayComment,
  loadCheers,
  loadDayComments,
  pinDayComment,
  setCheer,
  setDayCommentLike,
  type DayComment,
} from "@/lib/social-live";
import {
  fourballRows,
  highlightsOf,
  movesSince,
  newHighlight,
  positionsOf,
  type Highlight,
  type ViewBoard,
} from "@/lib/social-live-rules";
import { supabase } from "@/lib/supabase";
import { colors, fonts, navyAlpha, radii, spacing } from "@/lib/theme";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/**
 * Social's full-screen live view of a day (Oct 2026, claude/social-live.md) —
 * TikTok's layout over the course photo: the day's leaderboard, a gold
 * banner when someone makes a birdie while you watch, Great Shots and the
 * comments (each with a heart) down the side and along the bottom.
 *
 * Opened from a red LIVE circle on Social, the LIVE banner on a society's
 * page, or a results card's comments (the thread carries on after the day).
 * The database decides who gets in (0194): the players, the organiser, and
 * the day's group unless the leaderboard is secret.
 */
const SHOWN_ROWS = 5;
const REFRESH_MS = 15_000;

export default function SocialLiveScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const dayId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const insets = useSafeAreaInsets();
  // Under 18s (0159): the board, but not the comments or Great Shots.
  const social = useAgeGate("social") === "allowed";

  const [data, setData] = useState<MatchDayData | null | undefined>(undefined);
  const [comments, setComments] = useState<DayComment[]>([]);
  const [pinned, setPinned] = useState<DayComment | null>(null);
  const [count, setCount] = useState(0);
  const [cheers, setCheers] = useState({ count: 0, mine: false });
  const [organiser, setOrganiser] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [moves, setMoves] = useState<Map<string, "up" | "down">>(new Map());
  const [banner, setBanner] = useState<Highlight | null>(null);
  const input = useRef<TextInput>(null);
  const list = useRef<ScrollView>(null);
  const seenHighlights = useRef<Set<string> | null>(null);
  const lastPositions = useRef<Map<string, number>>(new Map());
  const fade = useRef(new Animated.Value(0)).current;

  const live = data?.matches.some((m) => m.round.status === "live") ?? false;

  const loadComments = useCallback(async () => {
    if (!userId || !social) return;
    const [c, ch] = await Promise.all([loadDayComments(dayId, userId), loadCheers(dayId, userId)]);
    setComments(c.comments);
    setPinned(c.pinned);
    setCount(c.count);
    setCheers(ch);
  }, [dayId, userId, social]);

  const load = useCallback(async () => {
    try {
      const d = await loadMatchDay(dayId);
      setData(d);
      if (d) {
        const board = boardOf(d);
        if (board) {
          setMoves((prev) => {
            const next = movesSince(lastPositions.current, board.rows);
            return lastPositions.current.size === 0 ? prev : next;
          });
          lastPositions.current = positionsOf(board.rows);
        }
        const highlights = highlightsOf(d);
        const fresh = newHighlight(seenHighlights.current, highlights);
        seenHighlights.current = new Set(highlights.map((h) => h.key));
        if (fresh) setBanner(fresh);
      }
    } catch {
      setData((prev) => (prev === undefined ? null : prev));
    }
    await loadComments().catch(() => undefined);
  }, [dayId, loadComments]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useLiveRefresh(load, data != null, REFRESH_MS);

  useEffect(() => {
    if (!userId) return;
    void supabase.rpc("live_day_is_organiser", { p_day_id: dayId }).then(({ data: o }) => setOrganiser(o === true));
  }, [dayId, userId]);

  // The birdie banner: in, six seconds, out.
  useEffect(() => {
    if (!banner) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setBanner(null));
    }, 6000);
    return () => clearTimeout(t);
  }, [banner, fade]);

  useEffect(() => {
    if (focus === "comment" && social && data) setTimeout(() => input.current?.focus(), 350);
  }, [focus, social, data]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await addDayComment(dayId, text);
      setDraft("");
      await loadComments();
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      Alert.alert("Couldn't post that", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSending(false);
    }
  }

  function toggleCheer() {
    if (!userId) return;
    const on = !cheers.mine;
    setCheers((c) => ({ mine: on, count: Math.max(0, c.count + (on ? 1 : -1)) }));
    setCheer(dayId, userId, on).catch(() => setCheers((c) => ({ mine: !on, count: Math.max(0, c.count + (on ? -1 : 1)) })));
  }

  function toggleLike(c: DayComment) {
    if (!userId) return;
    const on = !c.likedByMe;
    const flip = (to: boolean) => (x: DayComment) => (x.id === c.id ? { ...x, likedByMe: to, likeCount: Math.max(0, x.likeCount + (to ? 1 : -1)) } : x);
    setComments((all) => all.map(flip(on)));
    setPinned((p) => (p ? flip(on)(p) : p));
    setDayCommentLike(c.id, userId, on).catch(() => {
      setComments((all) => all.map(flip(!on)));
      setPinned((p) => (p ? flip(!on)(p) : p));
    });
  }

  function reply(c: DayComment) {
    setDraft((d) => (d.startsWith(`@${c.author.name.split(" ")[0]}`) ? d : `@${c.author.name.split(" ")[0]} ${d}`));
    input.current?.focus();
  }

  function options(c: DayComment) {
    const items: { label: string; destructive?: boolean; run: () => void }[] = [];
    if (organiser) items.push({ label: c.pinned ? "Unpin" : "Pin to the top", run: () => void pinDayComment(c.id, !c.pinned).then(loadComments).catch((e) => Alert.alert("Couldn't do that", e.message)) });
    if (c.isMine || organiser) items.push({ label: "Delete comment", destructive: true, run: () => void deleteDayComment(c.id).then(loadComments).catch((e) => Alert.alert("Couldn't do that", e.message)) });
    if (items.length === 0) return;
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...items.map((i) => i.label), "Cancel"], cancelButtonIndex: items.length, destructiveButtonIndex: items.findIndex((i) => i.destructive) },
        (i) => items[i]?.run()
      );
    } else {
      Alert.alert("Comment", undefined, [...items.map((i) => ({ text: i.label, style: i.destructive ? ("destructive" as const) : ("default" as const), onPress: i.run })), { text: "Cancel", style: "cancel" as const }]);
    }
  }

  if (data === undefined) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.cream50} />
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={[styles.fill, styles.centre, { padding: spacing.xl }]}>
        <StatusBar style="light" />
        <Ionicons name="eye-off-outline" size={36} color={colors.gold400} />
        <Text style={styles.goneTitle}>This day isn't open to you</Text>
        <Text style={styles.goneBody}>It may have been deleted, or the leaderboard is being kept secret until the prize-giving.</Text>
        <Pressable onPress={() => router.back()} style={styles.goneButton} accessibilityRole="button">
          <Text style={styles.goneButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const { day } = data;
  const board = boardOf(data);
  const playing = data.matches.reduce((n, m) => n + m.players.length, 0);

  return (
    <View style={styles.fill}>
      <StatusBar style="light" />
      <ImageBackground source={coursePhoto(day.clubId, day.courseName)} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: navyAlpha(0.45) }]} />
        <View style={styles.bottomShade} />
      </ImageBackground>

      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Top bar */}
        <View style={[styles.top, { paddingTop: insets.top + 4 }]}>
          <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={colors.cream50} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>
              {day.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {day.courseName} · {playing} playing
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: live ? colors.red600 : navyAlpha(0.7) }]}>
            {live ? <View style={styles.dot} /> : null}
            <Text style={styles.pillText}>{live ? "LIVE" : "FINAL"}</Text>
          </View>
        </View>

        {banner ? (
          <Animated.View style={[styles.banner, { opacity: fade }]} accessibilityLiveRegion="polite">
            <Ionicons name="flag" size={18} color={colors.navy900} />
            <Text style={styles.bannerText} numberOfLines={1}>
              {banner.word} · {banner.name} on the {ordinal(banner.hole)}
            </Text>
          </Animated.View>
        ) : null}

        {/* Leaderboard */}
        <View style={styles.board}>
          {day.leaderboardHidden ? (
            <Text style={styles.secret}>The leaderboard is secret until the prize-giving.</Text>
          ) : board ? (
            <>
              <View style={styles.boardHead}>
                <Text style={styles.boardHeadText}>LEADERBOARD</Text>
                <Text style={styles.boardHeadText}>{board.heading} · THRU</Text>
              </View>
              {board.rows.slice(0, SHOWN_ROWS).map((r) => {
                const move = moves.get(r.key);
                return (
                  <View key={r.key} style={styles.boardRow}>
                    <Text style={styles.boardPos}>{r.position || "–"}</Text>
                    <Text style={styles.boardName} numberOfLines={1}>
                      {r.name}
                      {move ? <Text style={{ color: move === "up" ? "#8fd19e" : "#f2a59a", fontSize: 11 }}> {move === "up" ? "▲" : "▼"}</Text> : null}
                    </Text>
                    <Text style={styles.boardValue}>{r.value}</Text>
                    <Text style={styles.boardThru}>{r.thru}</Text>
                  </View>
                );
              })}
            </>
          ) : (
            <Text style={styles.secret}>
              {day.teamNames ? `${day.teamNames[0]} ${pts(data.totals.final[0])} – ${pts(data.totals.final[1])} ${day.teamNames[1]}` : "Matches in play"}
            </Text>
          )}
          <Pressable
            onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(day.id) } })}
            style={styles.boardMore}
            accessibilityRole="link"
          >
            <Text style={styles.boardMoreText}>Full leaderboard</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }} />

        {/* Comments, and the buttons down the side */}
        <View style={styles.lower}>
          {social ? (
            <ScrollView
              ref={list}
              style={styles.comments}
              contentContainerStyle={{ gap: spacing.sm + 2, paddingBottom: spacing.xs }}
              onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
              keyboardShouldPersistTaps="handled"
              accessibilityLabel="Comments"
            >
              {comments.length === 0 && !pinned ? <Text style={styles.noComments}>No comments yet. Say well done!</Text> : null}
              {comments.map((c) => (
                <CommentRow key={c.id} c={c} onLike={toggleLike} onReply={reply} onOptions={options} />
              ))}
              {pinned ? <CommentRow c={pinned} onLike={toggleLike} onReply={reply} onOptions={options} /> : null}
            </ScrollView>
          ) : (
            <View style={styles.comments} />
          )}

          <View style={styles.rail}>
            {social ? (
              <Pressable onPress={toggleCheer} style={styles.railButton} accessibilityRole="button" accessibilityState={{ selected: cheers.mine }} accessibilityLabel={`Great Shot${cheers.count ? `, ${cheers.count}` : ""}`}>
                <Ionicons name={cheers.mine ? "flag" : "flag-outline"} size={30} color={colors.gold400} />
                <Text style={styles.railText}>{cheers.count || "Great Shot"}</Text>
              </Pressable>
            ) : null}
            {social ? (
              <Pressable onPress={() => input.current?.focus()} style={styles.railButton} accessibilityRole="button" accessibilityLabel={`Comment${count ? `, ${count} comments` : ""}`}>
                <Ionicons name="chatbubble" size={27} color={colors.cream50} />
                <Text style={styles.railText}>{count}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(day.id) } })}
              style={styles.railButton}
              accessibilityRole="button"
              accessibilityLabel="Leaderboard and cards"
            >
              <Ionicons name="podium" size={26} color={colors.cream50} />
              <Text style={styles.railText}>Cards</Text>
            </Pressable>
          </View>
        </View>

        {social ? (
          <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            <TextInput
              ref={input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a comment…"
              placeholderTextColor="rgba(247,243,234,0.7)"
              style={styles.input}
              maxLength={300}
              returnKeyType="send"
              onSubmitEditing={() => void send()}
              accessibilityLabel="Add a comment"
            />
            <Pressable onPress={() => void send()} disabled={!draft.trim() || sending} style={[styles.send, (!draft.trim() || sending) && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Post comment">
              {sending ? <ActivityIndicator color={colors.navy900} /> : <Ionicons name="arrow-up" size={20} color={colors.navy900} />}
            </Pressable>
          </View>
        ) : (
          <View style={{ height: Math.max(insets.bottom, spacing.md) }} />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function CommentRow({
  c,
  onLike,
  onReply,
  onOptions,
}: {
  c: DayComment;
  onLike: (c: DayComment) => void;
  onReply: (c: DayComment) => void;
  onOptions: (c: DayComment) => void;
}) {
  return (
    <Pressable onLongPress={() => onOptions(c)} style={[styles.comment, c.pinned && styles.commentPinned]} accessibilityHint="Long press for options">
      <Avatar url={c.author.avatarUrl} color={c.author.avatarColor} name={c.author.name} size={28} />
      <View style={{ flex: 1 }}>
        <Text style={styles.commentBody}>
          <Text style={styles.commentName}>{c.author.name} </Text>
          {c.body}
        </Text>
        <Text style={styles.commentMeta}>
          {c.pinned ? "Pinned · " : `${ago(c.createdAt)} · `}
          <Text style={styles.commentReply} onPress={() => onReply(c)} suppressHighlighting>
            Reply
          </Text>
        </Text>
      </View>
      <Pressable
        onPress={() => onLike(c)}
        hitSlop={10}
        style={styles.heart}
        accessibilityRole="button"
        accessibilityState={{ selected: c.likedByMe }}
        accessibilityLabel={`${c.likedByMe ? "Liked" : "Like"} ${c.author.name}'s comment${c.likeCount ? `, ${c.likeCount}` : ""}`}
      >
        <Ionicons name={c.likedByMe ? "heart" : "heart-outline"} size={17} color={c.likedByMe ? "#f2a59a" : colors.cream50} />
        {c.likeCount > 0 ? <Text style={[styles.heartCount, c.likedByMe && { color: "#f2a59a" }]}>{c.likeCount}</Text> : null}
      </Pressable>
    </Pressable>
  );
}

/** The day's board in the live view's shape: players for a society day, teams for a scramble. */
function boardOf(d: MatchDayData): ViewBoard | null {
  if (d.day.kind === "fourballs") return fourballRows(d);
  if (d.day.kind === "scramble") {
    const stableford = d.matches.some((m) => m.round.scramble?.foursomes === "stableford");
    const rows = teamRows(d.matches, stableford ? "points" : "net");
    return {
      heading: stableford ? "PTS" : "NET",
      rows: rows.map((r) => ({
        key: String(r.m.round.id),
        position: r.position,
        name: r.name,
        value: r.thru === 0 ? "–" : stableford ? String(r.points) : toParLabel(r.netToPar),
        thru: r.thru === 0 ? "–" : r.done ? "F" : String(r.thru),
        roundId: r.m.round.id,
      })),
    };
  }
  return null;
}

const pts = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  centre: { alignItems: "center", justifyContent: "center" },
  bottomShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", backgroundColor: navyAlpha(0.55) },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingRight: spacing.md - 4 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  subtitle: { fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ffffff" },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, color: "#ffffff" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    marginHorizontal: spacing.md - 4,
    marginTop: spacing.sm,
    backgroundColor: colors.gold500,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm + 2,
  },
  bannerText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  board: {
    marginHorizontal: spacing.md - 4,
    marginTop: spacing.sm + 2,
    alignSelf: "flex-start",
    width: 260,
    maxWidth: "80%",
    backgroundColor: navyAlpha(0.88),
    borderRadius: radii.md,
    paddingHorizontal: spacing.md - 4,
    paddingTop: spacing.sm,
  },
  boardHead: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 4 },
  boardHeadText: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1, color: colors.gold400 },
  boardRow: { flexDirection: "row", alignItems: "center", height: 28 },
  boardPos: { width: 26, fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.gold400 },
  boardName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.cream50 },
  boardValue: { width: 34, textAlign: "right", fontFamily: fonts.bodyBold, fontSize: 14, color: colors.cream50 },
  boardThru: { width: 26, textAlign: "right", fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100 },
  boardMore: { minHeight: 36, alignItems: "center", justifyContent: "center" },
  boardMoreText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400 },
  secret: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.cream50, paddingVertical: spacing.sm },
  lower: { flexDirection: "row", alignItems: "flex-end", paddingLeft: spacing.md - 4 },
  comments: { flex: 1, maxHeight: 300 },
  noComments: { fontFamily: fonts.body, fontSize: 14, color: colors.cream100 },
  comment: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  commentPinned: { backgroundColor: "rgba(211,165,63,0.25)", borderRadius: radii.sm, padding: 6, marginLeft: -6 },
  commentName: { fontFamily: fonts.bodyBold, color: colors.gold400 },
  commentBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.cream50 },
  commentMeta: { fontFamily: fonts.body, fontSize: 11.5, color: colors.cream100, marginTop: 1 },
  commentReply: { fontFamily: fonts.bodyBold },
  heart: { alignItems: "center", minWidth: 28 },
  heartCount: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.cream50 },
  rail: { width: 76, alignItems: "center", gap: spacing.md, paddingBottom: spacing.xs },
  railButton: { alignItems: "center", minWidth: 56, minHeight: 50, justifyContent: "center" },
  railText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.cream50, marginTop: 2 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md - 4, paddingTop: spacing.sm },
  input: {
    flex: 1,
    height: 46,
    borderRadius: radii.pill,
    backgroundColor: "rgba(247,243,234,0.18)",
    color: colors.cream50,
    paddingHorizontal: spacing.md + 2,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  goneTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50, marginTop: spacing.md, textAlign: "center" },
  goneBody: { fontFamily: fonts.body, fontSize: 15, color: colors.cream100, textAlign: "center", marginTop: spacing.sm },
  goneButton: { marginTop: spacing.lg, backgroundColor: colors.cream50, borderRadius: radii.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 4 },
  goneButtonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
});
