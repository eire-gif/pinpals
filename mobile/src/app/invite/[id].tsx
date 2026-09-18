import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";

import { InviteTags } from "@/components/invite-card";
import { SITE_URL } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import {
  dateLabel,
  getInvite,
  hostName,
  whenLabel,
  type Invite,
} from "@/lib/tee-times";
import { colors, radii, spacing, type } from "@/lib/theme";

export default function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();

  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const host = hostName(invite);
  const isMine = session?.user.id === invite.member_id;
  const place = [invite.club?.town, invite.club?.region]
    .filter(Boolean)
    .join(", ");
  const handicapShown =
    invite.host?.handicap_visible && invite.host?.handicap !== null;

  return (
    <>
      <Stack.Screen options={{ title: invite.club_name ?? "Tee time" }} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.club}>
            {invite.club_name ?? "Course to be confirmed"}
          </Text>
          {place.length > 0 && <Text style={styles.place}>{place}</Text>}
          {invite.club?.holes ? (
            <Text style={styles.place}>{invite.club.holes} holes</Text>
          ) : null}
        </View>

        <View style={styles.panel}>
          <Row
            icon="calendar-outline"
            label={dateLabel(invite.play_date, true)}
          />
          <Row icon="time-outline" label={whenLabel(invite)} />
          <Row
            icon="people-outline"
            label={`${invite.spaces_available} ${invite.spaces_available === 1 ? "space" : "spaces"} available`}
          />
        </View>

        <InviteTags invite={invite} />

        {invite.notes ? (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>Notes from the host</Text>
            <Text style={styles.notesBody}>{invite.notes}</Text>
          </View>
        ) : null}

        {host.length > 0 && (
          <View style={styles.panel}>
            <Text style={styles.sectionLabel}>Host</Text>
            <Text style={styles.hostName}>{host}</Text>
            {invite.host?.home_club && (
              <Text style={styles.place}>{invite.host.home_club}</Text>
            )}
            {handicapShown && (
              <Text style={styles.place}>
                Handicap {invite.host?.handicap}
              </Text>
            )}
          </View>
        )}

        {isMine ? (
          <Text style={styles.ownNote}>
            This is your tee time. Manage who&apos;s coming on the website.
          </Text>
        ) : null}

        {/* Phase B: this becomes a native "I'm interested" calling a thin API
            route on the site. It cannot call respond/confirm RPCs directly —
            those manage spaces_available atomically but do NOT send the
            notification, which lives in notifyUser() on the server. Calling
            them from here would update the fourball and tell nobody. */}
        <Pressable
          style={styles.primary}
          onPress={() => void Linking.openURL(`${SITE_URL}/tee-times`)}
        >
          <Text style={styles.primaryLabel}>
            {isMine ? "Manage on pinpals.ie" : "Express interest on pinpals.ie"}
          </Text>
        </Pressable>
        <Text style={styles.footnote}>Opens the website for now.</Text>
      </ScrollView>
    </>
  );
}

function Row({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={19} color={colors.green700} />
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.md },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.cream50,
  },
  header: { gap: 2 },
  club: { fontSize: 26, fontWeight: "800", color: colors.ink900 },
  place: { fontSize: type.body, color: colors.ink500 },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowLabel: { fontSize: type.body, color: colors.ink900, flex: 1 },
  sectionLabel: {
    fontSize: type.label,
    fontWeight: "700",
    color: colors.ink500,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hostName: { fontSize: type.heading, fontWeight: "700", color: colors.ink900 },
  notes: {
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: 4,
  },
  notesLabel: { fontSize: type.label, fontWeight: "700", color: colors.ink500 },
  notesBody: { fontSize: type.body, color: colors.ink900, lineHeight: 22 },
  ownNote: { fontSize: type.small, color: colors.ink500, textAlign: "center" },
  primary: {
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  primaryLabel: {
    color: colors.cream50,
    fontWeight: "700",
    fontSize: type.body,
  },
  footnote: {
    fontSize: 12.5,
    color: colors.ink500,
    textAlign: "center",
    marginTop: -4,
  },
  emptyTitle: { fontSize: type.heading, fontWeight: "700", color: colors.ink900 },
  emptyBody: { fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
