import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { COURSE_PHOTOS } from "@/components/course-photos";
import { InviteTags } from "@/components/invite-card";
import { StarRow } from "@/components/stars";
import { useAuth } from "@/lib/auth";
import { addToCalendar, offerCalendar } from "@/lib/calendar";
import {
  confirmedPlayersFor,
  coursePhotoIndex,
  getInvite,
  hostName,
  parseDate,
  todayIso,
  whenLabel,
  type CardPlayer,
  type Invite,
} from "@/lib/tee-times";
import {
  confirmPlace,
  expressInterest,
  getMyInterest,
  type MyInterest,
} from "@/lib/tee-time-interest";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing, type } from "@/lib/theme";

export default function InviteScreen() {
  // posted=1: just posted (post-tee-time.tsx) — offer the calendar once.
  const { id, posted } = useLocalSearchParams<{ id: string; posted?: string }>();
  const { session } = useAuth();
  const memberId = session?.user.id ?? null;

  const [invite, setInvite] = useState<Invite | null>(null);
  const [interest, setInterest] = useState<MyInterest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [players, setPlayers] = useState<CardPlayer[]>([]);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [calBusy, setCalBusy] = useState(false);
  const addMine = useCallback(async (inviteId: number) => {
    setCalBusy(true);
    await addToCalendar("tee_time", inviteId);
    setCalBusy(false);
  }, []);

  const load = useCallback(async () => {
    const numeric = Number.parseInt(String(id), 10);
    if (!Number.isFinite(numeric)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const row = await getInvite(numeric);
      // RLS makes "not visible to you" and "doesn't exist" the same answer, and
      // that's correct — telling a member an invite exists but isn't for them
      // leaks the existence of private fourballs.
      if (!row) setNotFound(true);
      setInvite(row);

      // Who is already in it. RLS decides whether anything comes back — 0084
      // opens this up on a round still looking for players and closes it
      // again the moment it fills. A failure here is a missing panel, never a
      // broken screen.
      if (row) {
        try {
          setPlayers((await confirmedPlayersFor([numeric])).get(numeric) ?? []);
        } catch {
          setPlayers([]);
        }
      }

      // Only worth asking for somebody else's invite: a host has no interest
      // row of their own, and the query would match other members' rows.
      if (row && memberId && row.member_id !== memberId) {
        setInterest(await getMyInterest(numeric, memberId));
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The moment the round becomes yours — just posted it, or just confirmed
  // your place — offer to put it in the calendar. Once each.
  const offeredPosted = useRef(false);
  useEffect(() => {
    if (posted && invite && !offeredPosted.current && invite.member_id === memberId) {
      offeredPosted.current = true;
      offerCalendar("tee_time", invite.id, "Tee time posted", "Add it to your calendar so the day's kept free?");
    }
  }, [posted, invite, memberId]);
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const now = interest?.status ?? null;
    if (lastStatus.current && lastStatus.current !== "confirmed" && now === "confirmed" && invite) {
      offerCalendar("tee_time", invite.id, "You're playing", "Add the round to your calendar?");
    }
    lastStatus.current = now;
  }, [interest?.status, invite]);

  /** One wrapper for both writes: nothing is optimistic, the screen only ever
   *  shows a status the server has actually returned. */
  const run = useCallback(async (work: () => Promise<MyInterest>) => {
    setBusy(true);
    setActionError(null);
    try {
      setInterest(await work());
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.green700} />
      </View>
    );
  }

  if (notFound || !invite) {
    return (
      <View style={styles.centre}>
        <Ionicons name="golf-outline" size={44} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Tee time not available</Text>
        <Text style={styles.emptyBody}>
          It may have been filled, cancelled, or it isn&apos;t open to you.
        </Text>
      </View>
    );
  }

  const inviteId = invite.id;
  const host = hostName(invite);
  const hostFirst = invite.host?.first_name?.trim() || "the host";
  const isMine = memberId === invite.member_id;
  const place = [invite.club?.town, invite.club?.region]
    .filter(Boolean)
    .join(", ");
  const handicapShown =
    invite.host?.handicap_visible && invite.host?.handicap !== null;

  const club = invite.club?.name ?? invite.club_name ?? "Course to be confirmed";
  const date = parseDate(invite.play_date);
  const countdown = daysUntil(invite.play_date);
  const playing = interest?.status === "confirmed";
  const myBadge = isMine
    ? { icon: "flag" as const, label: "Your round" }
    : playing
      ? { icon: "checkmark-circle" as const, label: "You're playing" }
      : interest?.status === "accepted"
        ? { icon: "mail-unread" as const, label: "Place offered" }
        : interest?.status === "pending"
          ? { icon: "hourglass" as const, label: "Interest sent" }
          : null;

  // The fourball as a line-up: host first, then whoever has confirmed, then
  // one empty seat per space left — so "who's playing and how many more are
  // needed" is one glance rather than two numbers to add up.
  const others = players.filter((p) => p.id !== invite.member_id);
  const openSeats = Math.max(0, invite.spaces_available);

  return (
    <>
      <Stack.Screen options={{ title: club }} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        {/* Hero: the same steady-per-club photo as the list card, so the
            round you tapped is recognisably the round you're looking at. */}
        <View style={styles.hero}>
          <Image source={COURSE_PHOTOS[coursePhotoIndex(invite, COURSE_PHOTOS.length)]} style={styles.heroPhoto} />
          <View style={styles.heroVeil} />
          {myBadge ? (
            <View style={[styles.heroBadge, (isMine || playing) && styles.heroBadgeStrong]}>
              <Ionicons name={myBadge.icon} size={16} color={colors.cream50} />
              <Text style={styles.heroBadgeText}>{myBadge.label}</Text>
            </View>
          ) : null}
          <View style={styles.heroText}>
            <Text style={styles.heroClub} numberOfLines={2}>{club}</Text>
            {(place.length > 0 || invite.club?.holes) ? (
              <View style={styles.heroMeta}>
                <Ionicons name="location" size={15} color={colors.gold400} />
                <Text style={styles.heroPlace} numberOfLines={1}>
                  {[place, invite.club?.holes ? `${invite.club.holes} holes` : null].filter(Boolean).join("  ·  ")}
                </Text>
              </View>
            ) : null}
            {invite.club?.rating_count ? (
              <View style={styles.heroMeta}>
                <StarRow value={invite.club.rating_avg ?? 0} size={14} />
                <Text style={styles.heroRating}>
                  {(invite.club.rating_avg ?? 0).toFixed(1)} ({invite.club.rating_count})
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* When: a calendar tile and the tee time, big enough to read from
            arm's length in a car park. */}
        <View style={styles.whenCard}>
          <View style={styles.calendar}>
            <Text style={styles.calendarMonth}>
              {date.toLocaleDateString("en-IE", { month: "short" }).toUpperCase()}
            </Text>
            <Text style={styles.calendarDay}>{date.getDate()}</Text>
          </View>
          <View style={styles.whenText}>
            <Text style={styles.whenWeekday}>
              {date.toLocaleDateString("en-IE", { weekday: "long" })}
            </Text>
            <View style={styles.whenTimeRow}>
              <Ionicons name="time" size={22} color={colors.green700} />
              <Text style={styles.whenTime}>{whenLabel(invite)}</Text>
            </View>
            {countdown ? (
              <View style={[styles.countdown, countdown === "Today" && styles.countdownToday]}>
                <Text style={[styles.countdownText, countdown === "Today" && styles.countdownTextToday]}>
                  {countdown}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <InviteTags invite={invite} />

        {/* Who's playing */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Who&apos;s playing</Text>
            <View style={[styles.spacesPill, openSeats === 0 && styles.spacesPillFull]}>
              <Ionicons name="people" size={14} color={openSeats === 0 ? colors.cream50 : colors.green800} />
              <Text style={[styles.spacesPillText, openSeats === 0 && styles.spacesPillTextFull]}>
                {openSeats === 0 ? "Full" : `${openSeats} ${openSeats === 1 ? "space" : "spaces"} left`}
              </Text>
            </View>
          </View>

          {host.length > 0 && (
            <Pressable
              style={({ pressed }) => [styles.seat, styles.seatHost, pressed && styles.pressed]}
              onPress={() => router.push(`/member/${invite.member_id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${host}, host. View profile`}
            >
              <Avatar url={invite.host?.avatar_url} color={invite.host?.avatar_color} name={host} size={46} />
              <View style={styles.seatText}>
                <View style={styles.seatNameRow}>
                  <Text style={styles.seatName} numberOfLines={1}>
                    {host}
                    {isMine ? " (you)" : ""}
                  </Text>
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>HOST</Text>
                  </View>
                </View>
                {invite.host?.home_club ? (
                  <Text style={styles.seatSub} numberOfLines={1}>
                    {invite.host.home_club}
                  </Text>
                ) : null}
                {handicapShown ? (
                  <Text style={styles.seatHandicap}>Handicap {invite.host?.handicap}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
            </Pressable>
          )}

          {others.map((p) => {
            const isMe = p.id === memberId;
            return (
              <Pressable
                key={p.id}
                style={({ pressed }) => [styles.seat, isMe && styles.seatMe, pressed && styles.pressed]}
                onPress={() => router.push(`/member/${p.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${isMe ? "You" : p.name}. View profile`}
              >
                <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={46} />
                <View style={styles.seatText}>
                  <Text style={styles.seatName} numberOfLines={1}>
                    {isMe ? `${p.name} (you)` : p.name}
                  </Text>
                  <Text style={styles.seatSub}>Confirmed</Text>
                </View>
                <Ionicons name="checkmark-circle" size={22} color={colors.green600} />
              </Pressable>
            );
          })}

          {Array.from({ length: openSeats }).map((_, i) => (
            <View key={`open-${i}`} style={[styles.seat, styles.seatOpen]}>
              <View style={styles.openAvatar}>
                <Ionicons name="add" size={22} color={colors.green700} />
              </View>
              <View style={styles.seatText}>
                <Text style={styles.openName}>Open place</Text>
                <Text style={styles.seatSub}>Waiting for a golfer</Text>
              </View>
            </View>
          ))}
        </View>

        {invite.notes ? (
          <View style={styles.notes}>
            <View style={styles.notesHead}>
              <Ionicons name="chatbubble-ellipses" size={16} color={colors.gold500} />
              <Text style={styles.notesLabel}>Notes from {hostFirst}</Text>
            </View>
            <Text style={styles.notesBody}>{invite.notes}</Text>
          </View>
        ) : null}

        {/* Answering interest is the host's job; accepting and declining
            golfers is native. */}
        {isMine ? (
          <>
            <Action
              icon="people"
              label="Manage who's coming"
              busy={false}
              onPress={() => router.push("/tee-time-requests")}
            />
            {invite.play_date >= todayIso() && (
              <Secondary icon="calendar-outline" label="Add to my calendar" busy={calBusy} onPress={() => void addMine(inviteId)} />
            )}
          </>
        ) : (
          <>
            {interest === null && (
              <Action
                icon="hand-right"
                label="I'm interested"
                busy={busy}
                onPress={() => void run(() => expressInterest(inviteId))}
              />
            )}

            {interest?.status === "pending" && (
              <Status
                tone="waiting"
                icon="hourglass-outline"
                title="Interest sent"
                body={`${hostFirst} will be told you'd like to play. You'll hear back here.`}
              />
            )}

            {interest?.status === "accepted" && (
              <>
                <Status
                  tone="offer"
                  icon="mail-unread-outline"
                  title="You've been offered a place"
                  body="Confirm and the space is yours. If you can't make it, say so now and it goes back to someone else."
                />
                <Action
                  icon="checkmark-circle"
                  label="Confirm my place"
                  busy={busy}
                  onPress={() => void run(() => confirmPlace(interest.id, true))}
                />
                <Secondary
                  icon="close-circle-outline"
                  label="I can't make it"
                  busy={busy}
                  onPress={() => void run(() => confirmPlace(interest.id, false))}
                />
              </>
            )}

            {interest?.status === "confirmed" && (
              <>
                <Status
                  tone="good"
                  icon="golf"
                  title="You're playing"
                  body={`Your place is confirmed. ${hostFirst} has your details.`}
                />
                {invite.play_date >= todayIso() && (
                  <Secondary icon="calendar-outline" label="Add to my calendar" busy={calBusy} onPress={() => void addMine(inviteId)} />
                )}
                {/* Until the day itself, a confirmed golfer can hand the place
                    back: the host is told and the space reopens (0090). */}
                {invite.play_date >= todayIso() && (
                  <Secondary
                    danger
                    icon="exit-outline"
                    label="Cancel my place"
                    busy={busy}
                    onPress={() =>
                      Alert.alert(
                        "Cancel your place?",
                        `${hostFirst} will be told you can't make it, and the space goes back for someone else to take.`,
                        [
                          { text: "Keep my place", style: "cancel" },
                          {
                            text: "Cancel my place",
                            style: "destructive",
                            onPress: () => void run(() => confirmPlace(interest.id, false)),
                          },
                        ]
                      )
                    }
                  />
                )}
              </>
            )}

            {interest?.status === "declined" &&
              (interest.withdrawn ? (
                <>
                  <Status
                    tone="neutral"
                    icon="refresh-outline"
                    title="You gave up your place"
                    body={
                      invite.status === "open"
                        ? `Can make it after all? Ask ${hostFirst} again — they'll decide as before.`
                        : "This round has no spaces left just now."
                    }
                  />
                  {invite.status === "open" && invite.play_date >= todayIso() ? (
                    <Action
                      icon="hand-right"
                      label="Ask to join again"
                      busy={busy}
                      onPress={() => void run(() => expressInterest(inviteId))}
                    />
                  ) : null}
                </>
              ) : (
                <Status
                  tone="neutral"
                  icon="close-circle-outline"
                  title="You're not in this round"
                  body="The host has filled this place. There are other tee times on the way."
                />
              ))}

            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

/** "Today", "Tomorrow", "In 5 days" — nothing for a round in the past. */
function daysUntil(iso: string): string | null {
  const today = parseDate(todayIso()).getTime();
  const days = Math.round((parseDate(iso).getTime() - today) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function Action({
  icon,
  label,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, busy && styles.disabled]}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator color={colors.cream50} />
      ) : (
        <>
          <Ionicons name={icon} size={20} color={colors.cream50} />
          <Text style={styles.primaryLabel}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function Secondary({
  icon,
  label,
  busy,
  danger = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const tint = danger ? colors.red600 : colors.green800;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.secondary,
        danger && styles.secondaryDanger,
        pressed && styles.pressed,
        busy && styles.disabled,
      ]}
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={20} color={tint} />
      <Text style={[styles.secondaryLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const TONES = {
  good: { bg: colors.green700, fg: colors.cream50, sub: "rgba(247,243,234,0.85)", icon: colors.gold400 },
  offer: { bg: "#fff4dc", fg: colors.ink900, sub: colors.ink500, icon: colors.gold500 },
  waiting: { bg: colors.green100, fg: colors.ink900, sub: colors.ink500, icon: colors.green700 },
  neutral: { bg: colors.surfaceTint, fg: colors.ink900, sub: colors.ink500, icon: colors.ink500 },
} as const;

function Status({
  tone,
  icon,
  title,
  body,
}: {
  tone: keyof typeof TONES;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.status, { backgroundColor: t.bg }, tone === "offer" && styles.statusOffer]}>
      <View style={[styles.statusIcon, tone === "good" && styles.statusIconGood]}>
        <Ionicons name={icon} size={24} color={t.icon} />
      </View>
      <View style={styles.statusText}>
        <Text style={[styles.statusTitle, { color: t.fg }]}>{title}</Text>
        <Text style={[styles.statusBody, { color: t.sub }]}>{body}</Text>
      </View>
    </View>
  );
}

const shadow = {
  shadowColor: colors.navy900,
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.cream50,
  },
  pressed: { opacity: 0.85 },

  hero: {
    height: 210,
    borderRadius: radii.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: colors.navy900,
    ...shadow,
  },
  heroPhoto: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  heroVeil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: navyAlpha(0.45) },
  heroBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: navyAlpha(0.7),
  },
  heroBadgeStrong: { backgroundColor: colors.green700, borderWidth: 1, borderColor: colors.gold400 },
  heroBadgeText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.cream50 },
  heroText: { padding: spacing.md, gap: 6 },
  heroClub: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: colors.cream50 },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroPlace: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: creamAlpha(0.92), flexShrink: 1 },
  heroRating: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: creamAlpha(0.92) },

  whenCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.green700,
    padding: spacing.md,
    ...shadow,
  },
  calendar: {
    width: 76,
    borderRadius: radii.md,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: colors.green700,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  calendarMonth: {
    alignSelf: "stretch",
    textAlign: "center",
    backgroundColor: colors.green700,
    color: colors.cream50,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 1.5,
    paddingVertical: 4,
  },
  calendarDay: { fontFamily: fonts.display, fontSize: 34, lineHeight: 44, color: colors.ink900 },
  whenText: { flex: 1, gap: 4 },
  whenWeekday: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  whenTimeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  whenTime: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.green800 },
  countdown: {
    alignSelf: "flex-start",
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
  },
  countdownToday: { backgroundColor: colors.gold400 },
  countdownText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.green800, letterSpacing: 0.3 },
  countdownTextToday: { color: colors.ink900 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  cardTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900 },
  spacesPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
  },
  spacesPillFull: { backgroundColor: colors.navy800 },
  spacesPillText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green800 },
  spacesPillTextFull: { color: colors.cream50 },

  seat: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceTint,
  },
  seatHost: { borderColor: colors.gold400, backgroundColor: "#fdf7e7" },
  seatMe: { borderColor: colors.green600, backgroundColor: colors.green100 },
  seatOpen: { borderStyle: "dashed", borderColor: colors.green600, backgroundColor: colors.surface },
  seatText: { flex: 1, gap: 2 },
  seatNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  seatName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900, flexShrink: 1 },
  seatSub: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500 },
  seatHandicap: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  hostBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.gold400,
  },
  hostBadgeText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, color: colors.ink900 },
  openAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.green600,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green100,
  },
  openName: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.green800 },

  notes: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 5,
    borderLeftColor: colors.gold500,
    padding: spacing.md,
    gap: 6,
  },
  notesHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  notesLabel: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.ink500 },
  notesBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, lineHeight: 22 },

  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.md,
    ...shadow,
  },
  statusOffer: { borderWidth: 1.5, borderColor: colors.gold500 },
  statusIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  statusIconGood: { backgroundColor: "rgba(255,255,255,0.14)" },
  statusText: { flex: 1, gap: 3 },
  statusTitle: { fontFamily: fonts.bodyBold, fontSize: 17 },
  statusBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20 },

  primary: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: colors.green800,
    ...shadow,
    shadowOpacity: 0.18,
  },
  primaryPressed: { backgroundColor: colors.green800 },
  primaryLabel: { color: colors.cream50, fontFamily: fonts.bodyBold, fontSize: 17 },
  secondary: {
    flexDirection: "row",
    gap: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.green700,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  secondaryDanger: { borderColor: colors.red600, backgroundColor: colors.red100 },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: 16.5 },
  disabled: { opacity: 0.6 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  emptyBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
