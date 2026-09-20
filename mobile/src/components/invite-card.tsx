import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import {
  dateLabel,
  distanceLabel,
  hostName,
  whenLabel,
  type Invite,
} from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A tee time, as an invitation rather than a table row.
 *
 * The card used to be a white rectangle with a thin border and a pale green
 * pill — competent, and indistinguishable from every other list in every
 * other app. What it was missing was the three things the website uses to
 * carry its character: navy, gold, and a display face.
 *
 * So the date moves into a navy band across the top, in gold, where it reads
 * as a date on an invitation. The club name below it is Playfair, which is
 * the single thing that makes this look like PinPals rather than like a
 * generic iOS app. And the host now appears as a person — a photograph if
 * they have one, their own colour and initials if not.
 */

export function Tag({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.tag}>
      <Ionicons name={icon} size={13} color={colors.green800} />
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

export function InviteTags({ invite }: { invite: Invite }) {
  const handicap =
    invite.handicap_limit !== null
      ? `Handicap ${invite.handicap_limit} or better`
      : null;

  return (
    <View style={styles.tags}>
      {invite.has_tee_time_booked && (
        <Tag icon="checkmark-circle-outline" label="Tee time booked" />
      )}
      {invite.ladies_only && <Tag icon="female-outline" label="Ladies only" />}
      {handicap && <Tag icon="stats-chart-outline" label={handicap} />}
      {invite.county && <Tag icon="location-outline" label={invite.county} />}
    </View>
  );
}

export function InviteCard({
  invite,
  onPress,
}: {
  invite: Invite;
  onPress: () => void;
}) {
  const host = hostName(invite);
  const distance = distanceLabel(invite.distance_km);
  const club = invite.club?.name ?? invite.club_name ?? "Course to be confirmed";
  const spaces = invite.spaces_available;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${club}, ${dateLabel(invite.play_date)}, ${spaces} ${spaces === 1 ? "space" : "spaces"}`}
    >
      <View style={styles.band}>
        <Text style={styles.bandDate}>
          {dateLabel(invite.play_date).toUpperCase()}
        </Text>
        <View style={styles.spaces}>
          <Text style={styles.spacesText}>
            {spaces} {spaces === 1 ? "space" : "spaces"}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.club} numberOfLines={2}>
          {club}
        </Text>

        <View style={styles.whenRow}>
          <Ionicons name="time-outline" size={15} color={colors.ink500} />
          <Text style={styles.when}>{whenLabel(invite)}</Text>
          {distance ? <Text style={styles.distance}>· {distance}</Text> : null}
        </View>

        <InviteTags invite={invite} />

        {host.length > 0 && (
          <View style={styles.hostRow}>
            <Avatar
              url={invite.host?.avatar_url}
              color={invite.host?.avatar_color}
              name={host}
              size={28}
            />
            <Text style={styles.host} numberOfLines={1}>
              {host}
              {invite.host?.home_club ? ` · ${invite.host.home_club}` : ""}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    // Without this the navy band's square corners punch through the card's
    // rounded ones.
    overflow: "hidden",
  },
  cardPressed: { opacity: 0.9 },

  band: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.navy900,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  bandDate: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.1,
    color: colors.gold400,
  },
  spaces: {
    backgroundColor: colors.gold500,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  // navy on gold is 6.7:1. White on it is 2.1:1, which is why it isn't white.
  spacesText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.navy900,
  },

  body: { padding: spacing.md, gap: 7 },
  club: {
    fontFamily: fonts.display,
    fontSize: 21,
    lineHeight: 26,
    color: colors.ink900,
  },
  whenRow: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  when: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  distance: { fontFamily: fonts.body, fontSize: type.small, color: colors.green700 },

  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 1 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.green800 },

  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 3,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  host: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
});
