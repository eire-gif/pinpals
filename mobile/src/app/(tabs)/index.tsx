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
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { describeUnread } from "@/lib/inbox";
import { useInboxUnread } from "@/lib/unread";

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
  const unread = useInboxUnread(session?.user?.id ?? null);

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

          {/* Two lines by design, not by wrapping. Left to wrap, the line
              break fell wherever the measured width said it would, and on
              some phones the italic rendered wider than it measured — "ball"
              ran off the edge of the screen. A fixed break leaves each line
              well short of the edge whatever the font does. */}
          <Text style={styles.heroTitle}>
            Find your{"\n"}
            <Text style={styles.heroTitleAccent}>next fourball.</Text>
          </Text>

          {courses ? (
            <Text style={styles.heroSub}>
              {courses.toLocaleString("en-IE")} clubs, from Ballybunion to St
              Andrews.
            </Text>
          ) : null}

          {/* Fixed-width buttons, label centred. They used to be sized to
              their own label, which left no slack: where a phone drew the
              text a touch wider than it measured it, the last letter was
              cut off ("Post a tee tim"). Two equal halves and a full-width
              third give every label room to spare. */}
          <View style={styles.heroButtons}>
            <Pressable
              style={[styles.cta, styles.ctaHalf, styles.ctaGreen]}
              onPress={() => router.push("/post-tee-time")}
              accessibilityRole="button"
            >
              <Text style={styles.ctaGreenLabel} numberOfLines={1}>
                Post a tee time
              </Text>
            </Pressable>

            <Pressable
              style={[styles.cta, styles.ctaHalf, styles.ctaCream]}
              onPress={() => router.push("/tee-times")}
              accessibilityRole="button"
            >
              <Text style={styles.ctaCreamLabel} numberOfLines={1}>
                Find a game
              </Text>
            </Pressable>

            {/* The marketplace accent from globals.css, and ink-900 on it is
                not a style choice: white on this orange is 1.99:1, nowhere
                near WCAG AA. */}
            <Pressable
              style={[styles.cta, styles.ctaFull, styles.ctaBuy]}
              onPress={() => router.push("/new-listing")}
              accessibilityRole="button"
            >
              <Text style={styles.ctaBuyLabel} numberOfLines={1}>
                List an item
              </Text>
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

          {/* One row for both, because they are one destination now. The
              wording splits them anyway — somebody waiting on a reply is a
              different call on your afternoon from an auction ending. */}
          {unread.total > 0 ? (
            <WaitingRow
              icon="mail-outline"
              text={describeUnread(unread.messages, unread.alerts)}
              onPress={() => router.push("/inbox")}
            />
          ) : null}

          {/* Only while there is something left to fill in, and never as a
              bare percentage — "60% complete" is a scold. What a member
              actually wants to know is why they'd bother, so the row says
              that instead and the meter is just the evidence. */}
          {summary?.profileCompletion !== null &&
          summary !== null &&
          summary.profileCompletion < 100 ? (
            <ProfileNudge
              percent={summary.profileCompletion}
              onPress={() => router.push("/edit-profile")}
            />
          ) : null}

          {/* Always here, unlike the rows above — these are shortcuts, not
              alerts. Two screens a member goes to on purpose and which were
              otherwise three taps away through the menu. */}
          <View style={styles.quickLinks}>
            <QuickLink
              icon="people-circle-outline"
              label="My connections"
              onPress={() => router.push("/connections")}
            />
            <QuickLink
              icon="pricetags-outline"
              label="My listings"
              onPress={() => router.push("/my-listings")}
            />
          </View>

          <Band
            eyebrow="Every county, every links"
            title={
              courses
                ? `Browse ${courses.toLocaleString("en-IE")} courses`
                : "Browse the course directory"
            }
            body="From Kerry to the Highlands — find a club, see who plays there, and put yourself on its map."
            action="See the directory"
            onPress={() => router.push("/courses")}
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

/**
 * The one piece of the website's dashboard worth carrying over to Home.
 *
 * A fuller profile is the difference between being invited into a fourball
 * and being scrolled past, so this is framed as what it gets you rather than
 * as a task list. It disappears at 100% and never comes back.
 */
function ProfileNudge({ percent, onPress }: { percent: number; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.nudge, pressed && styles.nudgeOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Finish your profile, ${percent}% complete`}
    >
      <View style={styles.nudgeBody}>
        <Text style={styles.nudgeTitle}>Finish your profile</Text>
        <Text style={styles.nudgeText}>
          Members with a club, a handicap and a line about themselves get asked to play more often.
        </Text>
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${Math.max(percent, 4)}%` }]} />
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

/** A shortcut tile. Deliberately plain: it competes with the waiting rows
 *  above it, and those are the ones that should win the eye. */
function QuickLink({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickLink, pressed && styles.quickLinkOn]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={21} color={colors.green700} />
      <Text style={styles.quickLinkLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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

  // Sized by what is in it, not a minimum: the old 380pt floor left a
  // band of empty sky above the text on every phone.
  hero: { justifyContent: "flex-end" },
  heroImage: { resizeMode: "cover" },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(6,16,30,0.62)",
  },
  heroBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },

  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 20, height: 2, backgroundColor: colors.gold400 },
  ruleGold: { width: 20, height: 2, backgroundColor: colors.gold500 },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.gold400,
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 38,
    color: "#ffffff",
  },
  // fontStyle: "italic" does nothing once fontFamily is set — the italic is
  // a separate registered family, not a style on this one.
  heroTitleAccent: { color: colors.gold400, fontFamily: fonts.displayItalic },
  heroSub: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: "rgba(255,255,255,0.92)",
    // Room on the right for a line drawn wider than it was measured.
    paddingRight: spacing.lg,
  },
  heroButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  cta: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  // Two halves either side of an 8pt gap, then one across the whole row.
  ctaHalf: { flexBasis: "47%", flexGrow: 1 },
  ctaFull: { flexBasis: "100%" },
  ctaGreen: { backgroundColor: colors.green600 },
  ctaGreenLabel: { color: "#ffffff", fontFamily: fonts.bodyBold, fontSize: type.body },
  ctaCream: { backgroundColor: "#fbf8ef" },
  ctaCreamLabel: { color: colors.navy900, fontFamily: fonts.bodyBold, fontSize: type.body },
  ctaBuy: {
    backgroundColor: colors.buy500,
    borderWidth: 1.5,
    borderColor: colors.buy700,
  },
  ctaBuyLabel: { color: colors.ink900, fontFamily: fonts.bodyBold, fontSize: type.body },

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
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.green700,
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 23,
    lineHeight: 28,
    color: colors.ink900,
  },
  cardBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardMeta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

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
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.green800,
  },

  nudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.gold400,
    backgroundColor: colors.surface,
  },
  nudgeOn: { backgroundColor: colors.surfaceTint },
  nudgeBody: { flex: 1, gap: 6 },
  nudgeTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  nudgeText: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
  meter: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.cream100,
    overflow: "hidden",
    marginTop: 2,
  },
  meterFill: { height: 5, borderRadius: 3, backgroundColor: colors.green600 },

  quickLinks: { flexDirection: "row", gap: spacing.sm },
  quickLink: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  quickLinkOn: { backgroundColor: colors.surfaceTint },
  quickLinkLabel: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: type.small,
    color: colors.ink900,
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
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.green700,
  },
  bandTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 25,
    color: colors.ink900,
  },
  bandBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  bandAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  bandActionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: type.small,
    color: colors.green700,
  },
});
