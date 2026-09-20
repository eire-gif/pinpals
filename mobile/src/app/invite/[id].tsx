import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { InviteTags } from "@/components/invite-card";
import { useAuth } from "@/lib/auth";
import {
  dateLabel,
  getInvite,
  hostName,
  whenLabel,
  type Invite,
} from "@/lib/tee-times";
import {
  confirmPlace,
  expressInterest,
  getMyInterest,
  type MyInterest,
} from "@/lib/tee-time-interest";
import { colors, radii, spacing, type } from "@/lib/theme";

export default function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const memberId = session?.user.id ?? null;

  const [invite, setInvite] = useState<Invite | null>(null);
  const [interest, setInterest] = useState<MyInterest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

        {/* Answering interest is the host's job and it needs the list of who
            has asked, which the app doesn't have a screen for yet. Until it
            does, a host is sent to the website rather than shown a button that
            can't do the work. */}
        {isMine ? (
          <>
            <Text style={styles.ownNote}>
              This is your tee time.
            </Text>
            <Pressable
              style={styles.primary}
              onPress={() => router.push("/tee-time-requests")}
            >
              <Text style={styles.primaryLabel}>See who wants to join</Text>
            </Pressable>
          </>
        ) : (
          <>
            {interest === null && (
              <Action
                label="I'm interested"
                busy={busy}
                onPress={() => void run(() => expressInterest(inviteId))}
              />
            )}

            {interest?.status === "pending" && (
              <Status
                icon="hourglass-outline"
                title="Interest sent"
                body={`${hostFirst} will be told you'd like to play. You'll hear back here.`}
              />
            )}

            {interest?.status === "accepted" && (
              <>
                <Status
                  icon="checkmark-circle-outline"
                  title="You've been offered a place"
                  body="Confirm and the space is yours. If you can't make it, say so now and it goes back to someone else."
                />
                <Action
                  label="Confirm my place"
                  busy={busy}
                  onPress={() =>
                    void run(() => confirmPlace(interest.id, true))
                  }
                />
                <Pressable
                  style={[styles.secondary, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() =>
                    void run(() => confirmPlace(interest.id, false))
                  }
                >
                  <Text style={styles.secondaryLabel}>I can&apos;t make it</Text>
                </Pressable>
              </>
            )}

            {interest?.status === "confirmed" && (
              <Status
                icon="golf-outline"
                title="You're playing"
                body={`Your place is confirmed. ${hostFirst} has your details.`}
              />
            )}

            {interest?.status === "declined" && (
              <Status
                icon="close-circle-outline"
                title="Not this time"
                body="This place has gone. There are other tee times on the way."
              />
            )}

            {actionError ? (
              <Text style={styles.error}>{actionError}</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function Action({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.primary, busy && styles.disabled]}
      disabled={busy}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator color={colors.cream50} />
      ) : (
        <Text style={styles.primaryLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

function Status({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.status}>
      <Ionicons name={icon} size={22} color={colors.green700} />
      <View style={styles.statusText}>
        <Text style={styles.statusTitle}>{title}</Text>
        <Text style={styles.statusBody}>{body}</Text>
      </View>
    </View>
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
  status: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  statusText: { flex: 1, gap: 3 },
  statusTitle: {
    fontSize: type.body,
    fontWeight: "700",
    color: colors.ink900,
  },
  statusBody: { fontSize: type.small, color: colors.ink500, lineHeight: 20 },
  primary: {
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    marginTop: spacing.sm,
  },
  primaryLabel: {
    color: colors.cream50,
    fontWeight: "700",
    fontSize: type.body,
  },
  secondary: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: {
    color: colors.ink500,
    fontWeight: "600",
    fontSize: type.body,
  },
  disabled: { opacity: 0.6 },
  error: {
    fontSize: type.small,
    color: colors.red600,
    textAlign: "center",
  },
  emptyTitle: { fontSize: type.heading, fontWeight: "700", color: colors.ink900 },
  emptyBody: { fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
