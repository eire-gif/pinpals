import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { COURSE_PHOTOS } from "@/components/course-photos";
import { StarRow } from "@/components/stars";
import {
  coursePhotoIndex,
  dateLabel,
  distanceLabel,
  hostName,
  whenLabel,
  type CardPlayer,
  type Invite,
} from "@/lib/tee-times";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * A round looking for players — the Tee times tab's card (Oct 2026 design).
 *
 * Left: the date, the club in Playfair, time and place, and what is true of
 * the round. Right: a photograph with the spaces left on it. Underneath: who
 * is hosting, and the faces of whoever has already confirmed.
 *
 * Your own part in a round comes first, as a green band across the top:
 * "You're playing" once your place is confirmed, "Your round" on one you're
 * hosting — so the list answers "am I in this?" without a tap. Spaces left
 * sit on a band across the foot of the photo, big enough to read at a glance.
 *
 * The photograph is decoration — no club in the directory has one of its
 * own yet — picked steadily per club so a club always looks the same. See
 * tools/prep-tee-time-images.py.
 */

const PHOTOS = COURSE_PHOTOS;

/** Faces shown before "+N". */
const FACES = 3;

export function TeeTimeCard({
  invite,
  players,
  me = null,
  onPress,
}: {
  invite: Invite;
  players: CardPlayer[];
  /** The signed-in member, to mark rounds they're in or hosting. */
  me?: string | null;
  onPress: () => void;
}) {
  const host = hostName(invite);
  const club = invite.club?.name ?? invite.club_name ?? "Course to be confirmed";
  const spaces = invite.spaces_available;
  const distance = distanceLabel(invite.distance_km);
  const place = distance ?? invite.county ?? invite.club?.region ?? null;
  const faces = players.slice(0, FACES);
  const extra = players.length - faces.length;
  const playing = me != null && players.some((p) => p.id === me);
  const hosting = me != null && invite.member_id === me;
  const mine = playing ? "You're playing" : hosting ? "Your round" : null;
  const spacesLabel = spaces <= 0 ? "Full" : `${spaces} ${spaces === 1 ? "space" : "spaces"} left`;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, mine && styles.cardMine, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${mine ? `${mine}. ` : ""}${club}, ${dateLabel(invite.play_date)}, ${whenLabel(invite)}, ${spacesLabel}${
        host && !hosting ? `, hosted by ${host}` : ""
      }`}
    >
      {mine ? (
        <View style={styles.mineBand}>
          <Ionicons name={playing ? "checkmark-circle" : "flag"} size={18} color={colors.cream50} />
          <Text style={styles.mineText}>{mine}</Text>
        </View>
      ) : null}
      <View style={styles.top}>
        <View style={styles.left}>
          <View style={styles.datePill}>
            <Text style={styles.dateText}>{dateLabel(invite.play_date).toUpperCase()}</Text>
          </View>

          <Text style={styles.club} numberOfLines={3}>
            {club}
          </Text>

          <View style={styles.whenRow}>
            <Ionicons name="time-outline" size={17} color={colors.ink500} />
            <Text style={styles.when}>{whenLabel(invite)}</Text>
            {place ? (
              // Icon and name stay together and shorten, rather than the
              // name wrapping onto a line of its own.
              <View style={styles.placeWrap}>
                <Text style={styles.dot}>·</Text>
                <Ionicons name="location-outline" size={16} color={colors.ink500} />
                <Text style={styles.place} numberOfLines={1}>
                  {place}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.tags}>
            {invite.has_tee_time_booked ? <Tag icon="checkmark-circle-outline" label="Tee time booked" /> : null}
            {invite.handicap_limit !== null ? (
              <Tag icon="stats-chart-outline" label={`Handicap ${invite.handicap_limit} or better`} />
            ) : null}
            {invite.ladies_only ? <Tag icon="female-outline" label="Ladies only" /> : null}
          </View>
        </View>

        <View style={styles.photoCol}>
          <View style={styles.photoWrap}>
            <Image source={PHOTOS[coursePhotoIndex(invite, PHOTOS.length)]} style={styles.photo} />
            <View style={[styles.spaces, spaces <= 0 && styles.spacesFull]}>
              <Ionicons name="people" size={16} color={spaces <= 0 ? colors.cream50 : colors.gold400} />
              <Text
                style={[styles.spacesText, spaces <= 0 && { color: colors.cream50 }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {spacesLabel}
              </Text>
            </View>
          </View>
          <CourseRating avg={invite.club?.rating_avg} count={invite.club?.rating_count} />
        </View>
      </View>

      <View style={styles.bottom}>
        <Avatar url={invite.host?.avatar_url} color={invite.host?.avatar_color} name={host} size={40} />
        <View style={styles.hostText}>
          <Text style={styles.hostName} numberOfLines={1}>
            {host || "A PinPals member"}
          </Text>
          {invite.host?.home_club ? (
            <Text style={styles.hostClub} numberOfLines={1}>
              {invite.host.home_club}
            </Text>
          ) : null}
        </View>

        {faces.length > 0 ? (
          <View style={styles.faces} accessibilityLabel={`${players.length} already playing`}>
            {faces.map((p, i) => (
              <View key={p.id} style={[styles.face, i > 0 && styles.faceOverlap]}>
                <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={30} />
              </View>
            ))}
            {extra > 0 ? (
              <View style={[styles.face, styles.faceOverlap, styles.more]}>
                <Text style={styles.moreText}>+{extra}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color={colors.green700} />
        </View>
      </View>
    </Pressable>
  );
}

function Tag({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.tag}>
      <Ionicons name={icon} size={13} color={colors.green800} />
      <Text style={styles.tagText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The course's member rating, under its photo — only once someone has rated
 * it. Five grey stars on an unrated course would read as "rated badly", and
 * at launch that is nearly every course.
 */
function CourseRating({ avg, count }: { avg?: number | null; count?: number }) {
  if (!count || avg === null || avg === undefined) return null;
  const value = Number(avg);
  return (
    <View
      style={styles.rating}
      accessible
      accessibilityLabel={`Course rated ${value.toFixed(1)} out of 5 by ${count} ${count === 1 ? "member" : "members"}`}
    >
      <StarRow value={value} size={12} />
      <Text style={styles.ratingText}>
        {value.toFixed(1)}/5
        <Text style={styles.ratingCount}> ({count})</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 14,
    gap: 12,
    // A soft lift rather than a rule, as in the design.
    shadowColor: "#0c2038",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: "rgba(221,210,184,0.6)",
  },
  pressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  cardMine: { borderWidth: 2, borderColor: colors.green600 },
  mineBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    // Bleeds to the card's edges: the card's padding is 14.
    marginTop: -14,
    marginHorizontal: -14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: colors.green600,
  },
  mineText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50, letterSpacing: 0.2 },

  top: { flexDirection: "row", gap: 12 },
  left: { flex: 1, minWidth: 0, gap: 7 },

  datePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dateText: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.1, color: colors.green800 },

  club: { fontFamily: fonts.display, fontSize: 21, lineHeight: 25, color: colors.ink900 },

  whenRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  placeWrap: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 0 },
  when: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  dot: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink500, marginHorizontal: 3 },
  place: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink900, flexShrink: 1 },

  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
    maxWidth: "100%",
  },
  tagText: { fontFamily: fonts.bodySemi, fontSize: 11.5, color: colors.green800, flexShrink: 1 },

  photoCol: {
    alignSelf: "flex-start",
    width: "40%",
    maxWidth: 160,
    gap: 6,
  },
  photoWrap: {
    width: "100%",
    aspectRatio: 0.92,
    borderRadius: 16,
    overflow: "hidden",
  },
  photo: { width: "100%", height: "100%", backgroundColor: colors.cream100 },
  // A band across the foot of the photo: dark behind light text reads on
  // any picture, sea or sky, where a small pill on top didn't.
  spaces: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 5,
    backgroundColor: "rgba(12,32,56,0.82)",
  },
  spacesFull: { backgroundColor: "rgba(168,58,43,0.9)" },
  spacesText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold400, flexShrink: 1 },
  rating: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  ratingText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.ink900 },
  ratingCount: { fontFamily: fonts.body, color: colors.ink500 },

  bottom: { flexDirection: "row", alignItems: "center", gap: 10 },
  hostText: { flex: 1, minWidth: 0 },
  hostName: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink900 },
  hostClub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },

  faces: { flexDirection: "row", alignItems: "center" },
  face: { borderRadius: 17, borderWidth: 2, borderColor: colors.surface },
  faceOverlap: { marginLeft: -9 },
  more: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green100,
  },
  moreText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green800 },

  chevron: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green100,
  },
});

