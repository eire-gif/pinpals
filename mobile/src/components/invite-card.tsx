import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  dateLabel,
  distanceLabel,
  hostName,
  whenLabel,
  type Invite,
} from "@/lib/tee-times";
import { colors, radii, spacing, type } from "@/lib/theme";

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

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${invite.club_name ?? "Course to be confirmed"}, ${dateLabel(invite.play_date)}, ${invite.spaces_available} ${invite.spaces_available === 1 ? "space" : "spaces"}`}
    >
      <View style={styles.cardTop}>
        <Text style={styles.club} numberOfLines={1}>
          {invite.club_name ?? "Course to be confirmed"}
        </Text>
        <View style={styles.spaces}>
          <Text style={styles.spacesText}>
            {invite.spaces_available}{" "}
            {invite.spaces_available === 1 ? "space" : "spaces"}
          </Text>
        </View>
      </View>

      <Text style={styles.when}>
        {dateLabel(invite.play_date)} · {whenLabel(invite)}
      </Text>

      {distance && <Text style={styles.distance}>{distance}</Text>}

      <InviteTags invite={invite} />

      {host.length > 0 && <Text style={styles.host}>Posted by {host}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: 6,
  },
  cardPressed: { backgroundColor: colors.surfaceTint },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  club: {
    flex: 1,
    fontSize: type.heading,
    fontWeight: "700",
    color: colors.ink900,
  },
  spaces: {
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  spacesText: { fontSize: 12.5, fontWeight: "700", color: colors.green800 },
  when: { fontSize: type.body, color: colors.ink900 },
  distance: { fontSize: type.small, color: colors.green700, fontWeight: "600" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: { fontSize: 12, color: colors.green800, fontWeight: "600" },
  host: { fontSize: type.small, color: colors.ink500, marginTop: 2 },
});
