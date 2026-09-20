import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { loadHome, type HomeSummary } from "@/lib/home";
import { dateLabel } from "@/lib/tee-times";
import { colors, radii, spacing, type } from "@/lib/theme";
import { useUnreadCount } from "@/lib/unread";

/**
 * Home.
 *
 * It carries the website's hero — the same photograph, the gold rule, the
 * Playfair headline, the same three buttons in the same three colours — so the
 * app and the site are visibly one product. What it does NOT carry is the
 * half of that page written for someone who hasn't joined: "How it works",
 * "Free to join", "Create your profile". Everyone here is signed in, and a
 * member being invited to sign up is the kind of small wrongness that makes
 * software feel unattended.
 *
 * In its place: the member's next round, and anything waiting on them. That is
 * what someone opens this app to find out.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const unread = useUnreadCount();

  const userId = session?.user?.id ?? null;
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setSummary(await loadHome(userId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // Re-read on focus. Same freshness story as the tee-times list: a round
  // confirmed on the website is reflected here next time the tab is looked
  // at, with no websocket per screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const courses = summary?.courseCount;

  return (
    <ScrollView
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
      {/* HERO — the site's own photograph, loaded from the site rather than
          bundled. It is a large image that changes when the homepage changes,
          and a copy in the binary would need an App Store release to keep in
          step with one on Vercel. */}
      <ImageBackground
        source={{ uri: `${SITE_URL}/images/homepage-hero.jpg` }}
        style={styles.hero}
        imageStyle={styles.heroImage}
      >
        {/* A flat scrim rather than the site's gradient: a gradient would mean
            expo-linear-gradient, which is a native module and therefore a new
            build of the app for every member. Not worth it for a fade. */}
        <View style={styles.scrim} />

        <View style={styles.heroBody}>
          <View style={styles.eyebrowRow}>
            <View style={styles.rule} />
            <Text style={styles.eyebrow}>Golf community — Ireland &amp; the UK</Text>
          </View>

          <Text style={styles.heroTitle}>
            Find your <Text style={styles.heroTitleAccent}>next four ball</Text>.
          </Text>

          {courses ? (
            <Text style={styles.heroSub}>
              {courses.toLocaleString("en-IE")} clubs on the books, from
              Ballybunion to St Andrews.
            </Text>
          ) : null}

          <View style={styles.heroButtons}>
            <Pressable
              style={[styles.cta, styles.ctaGreen]}
              onPress={() => router.push("/post-tee-time")}
            >
              <Text style={styles.ctaGreenLabel}>Post a tee time</Text>
            </Pressable>

            <Pressable
              style={[styles.cta, styles.ctaCream]}
              onPress={() => router.push("/tee-times")}
            >
              <Text style={styles.ctaCreamLabel}>Find a game</Text>
            </Pressable>

            {/* The marketplace accent from globals.css, and ink-900 on it is
                not a style choice: white on this orange is 1.99:1, nowhere
                near WCAG AA. */}
            <Pressable
              style={[styles.cta, styles.ctaBuy]}
              onPress={() =>
                router.push("/web?path=/marketplace/new&title=List an item")
              }
            >
              <Text style={styles.ctaBuyLabel}>List an item</Text>
            </Pressable>
          </View>
        </View>
      </ImageBackground>

      {loading ? (
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      ) : (
        <View style={styles.body}>
          <NextRound summary={summary} onOpen={(id) => router.push(`/invite/${id}`)} />

          {/* Only rendered when there IS something waiting. A permanent row
              reading "0 requests" trains a member to stop looking at this part
              of the screen, which is the one part that ever needs them. */}
          {summary && summary.requestsWaiting > 0 ? (
            <WaitingRow
              icon="people-outline"
              text={
                summary.requestsWaiting === 1
                  ? "1 golfer is waiting on your answer"
                  : `${summary.requestsWaiting} golfers are waiting on your answer`
              }
              onPress={() => router.push("/tee-time-requests")}
            />
          ) : null}

          {summary && summary.offersWaiting > 0 ? (
            <WaitingRow
              icon="golf-outline"
              text={
                summary.offersWaiting === 1
                  ? "You've been offered a place — confirm it"
                  : `You've been offered ${summary.offersWaiting} places — confirm them`
              }
              onPress={() => router.push("/tee-times")}
            />
          ) : null}

          {unread > 0 ? (
            <WaitingRow
              icon="notifications-outline"
              text={unread === 1 ? "1 unread alert" : `${unread} unread alerts`}
              onPress={() => router.push("/notifications")}
            />
          ) : null}

          <Band
            eyebrow="Every county, every links"
            title={
              courses
                ? `Browse ${courses.toLocaleString("en-IE")} courses`
                : "Browse the course directory"
            }
            body="From Kerry to the Highlands — find a club, see who plays there, and put yourself on its map."
            action="See the directory"
            onPress={() =>
              router.push("/web?path=/courses&title=Courses")
            }
          />

          <Band
            eyebrow="Marketplace"
            title="Clearing out the garage?"
            body="Sell your old clubs to a fellow golfer, or see what other members have listed near you. No fees to list."
            action="Browse the marketplace"
            onPress={() => router.push("/marketplace")}
          />
        </View>
      )}
    </ScrollView>
  );
}

function NextRound({
  summary,
  onOpen,
}: {
  summary: HomeSummary | null;
  onOpen: (inviteId: number) => void;
}) {
  const round = summary?.nextRound;

  if (!round) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardEyebrow}>Your next round</Text>
        <Text style={styles.cardTitle}>Nothing booked yet</Text>
        <Text style={styles.cardBody}>
          Post a tee time and your connections hear about it, or find a game
          someone else has going.
        </Text>
      </View>
    );
  }

  return (
    <Pressable style={styles.card} onPress={() => onOpen(round.inviteId)}>
      <Text style={styles.cardEyebrow}>
        {round.role === "hosting" ? "You're hosting" : "You're playing"}
      </Text>
      <Text style={styles.cardTitle}>{round.club}</Text>
      <View style={styles.cardMetaRow}>
        <Ionicons name="calendar-outline" size={16} color={colors.ink500} />
        <Text style={styles.cardMeta}>
          {dateLabel(round.playDate, true)} · {round.when}
        </Text>
      </View>
    </Pressable>
  );
}

function WaitingRow({
  icon,
  text,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.waiting} onPress={onPress}>
      <Ionicons name={icon} size={20} color={colors.green700} />
      <Text style={styles.waitingText}>{text}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function Band({
  eyebrow,
  title,
  body,
  action,
  onPress,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.band}>
      <View style={styles.eyebrowRow}>
        <View style={styles.ruleGold} />
        <Text style={styles.bandEyebrow}>{eyebrow}</Text>
      </View>
      <Text style={styles.bandTitle}>{title}</Text>
      <Text style={styles.bandBody}>{body}</Text>
      <Pressable style={styles.bandAction} onPress={onPress}>
        <Text style={styles.bandActionLabel}>{action}</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.green700} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { paddingBottom: spacing.xl },

  hero: { minHeight: 380, justifyContent: "flex-end" },
  heroImage: { resizeMode: "cover" },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(6,16,30,0.62)",
  },
  heroBody: { padding: spacing.lg, gap: spacing.sm },

  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 20, height: 2, backgroundColor: colors.gold400 },
  ruleGold: { width: 20, height: 2, backgroundColor: colors.gold500 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.gold400,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    color: "#ffffff",
  },
  heroTitleAccent: { color: colors.gold400, fontStyle: "italic" },
  heroSub: { fontSize: type.body, color: "rgba(255,255,255,0.92)" },
  heroButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  cta: {
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  ctaGreen: { backgroundColor: colors.green600 },
  ctaGreenLabel: { color: "#ffffff", fontWeight: "700", fontSize: type.body },
  ctaCream: { backgroundColor: "#fbf8ef" },
  ctaCreamLabel: { color: colors.navy900, fontWeight: "700", fontSize: type.body },
  ctaBuy: {
    backgroundColor: colors.buy500,
    borderWidth: 1.5,
    borderColor: colors.buy700,
  },
  ctaBuyLabel: { color: colors.ink900, fontWeight: "700", fontSize: type.body },

  spinner: { marginTop: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 6,
  },
  cardEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.green700,
  },
  cardTitle: { fontSize: type.title, fontWeight: "700", color: colors.ink900 },
  cardBody: { fontSize: type.small, color: colors.ink500 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardMeta: { fontSize: type.small, color: colors.ink500 },

  waiting: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.green100,
  },
  waitingText: {
    flex: 1,
    fontSize: type.body,
    fontWeight: "600",
    color: colors.green800,
  },

  band: {
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 6,
  },
  bandEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.green700,
  },
  bandTitle: { fontSize: type.heading, fontWeight: "700", color: colors.ink900 },
  bandBody: { fontSize: type.small, color: colors.ink500 },
  bandAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  bandActionLabel: {
    fontSize: type.small,
    fontWeight: "700",
    color: colors.green700,
  },
});
