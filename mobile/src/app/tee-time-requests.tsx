import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import {
  listIncomingRequests,
  respondToRequest,
  type IncomingRequest,
} from "@/lib/tee-time-interest";
import { clockTime, dateLabel } from "@/lib/tee-times";
import { colors, radii, spacing, type } from "@/lib/theme";

/**
 * Who has asked to join this member's rounds, and the two buttons that answer
 * them.
 *
 * The other half of hosting. Expressing interest has been native since Phase
 * B; answering it meant going to the website, which left the app able to start
 * a conversation it couldn't finish. A host who can't answer from their phone
 * answers slowly, and a request answered slowly is a fourball that doesn't
 * fill.
 *
 * Declined requests are not shown. They are the host's own past decisions, and
 * a list that accumulates them is a list that stops being worth opening.
 */
export default function TeeTimeRequestsScreen() {
  const { session } = useAuth();
  const memberId = session?.user.id ?? null;

  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!memberId) return;
    try {
      setRequests(await listIncomingRequests(memberId));
      setError(null);
    } catch {
      setError("Couldn't load your requests just now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = useCallback(
    async (request: IncomingRequest, accept: boolean) => {
      setBusyId(request.id);
      setError(null);
      try {
        const { status } = await respondToRequest(request.id, accept);
        setRequests((current) =>
          current.map((row) =>
            row.id === request.id ? { ...row, status } : row
          )
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't send that. Please try again."
        );
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.green700} />
      </View>
    );
  }

  const visible = requests.filter((row) => row.status !== "declined");

  // Grouped by the round they're about, because that is the unit a host thinks
  // in: "who wants Saturday at Hermitage", not "who asked me things".
  const groups = new Map<number, IncomingRequest[]>();
  for (const row of visible) {
    const list = groups.get(row.invite_id) ?? [];
    list.push(row);
    groups.set(row.invite_id, list);
  }

  return (
    <>
      <Stack.Screen options={{ title: "Requests to join" }} />
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
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {visible.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={44} color={colors.ink500} />
            <Text style={styles.emptyTitle}>Nobody waiting</Text>
            <Text style={styles.emptyBody}>
              When someone asks to join one of your tee times, they&apos;ll
              show up here.
            </Text>
          </View>
        ) : (
          Array.from(groups.entries()).map(([inviteId, rows]) => {
            const invite = rows[0].invite;
            const when = invite
              ? clockTime(invite.exact_tee_time) ??
                clockTime(invite.time_from) ??
                "Time flexible"
              : "";

            return (
              <View key={inviteId} style={styles.group}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupClub}>
                    {invite?.club_name ?? "Tee time"}
                  </Text>
                  <Text style={styles.groupMeta}>
                    {invite ? dateLabel(invite.play_date, true) : ""} · {when} ·{" "}
                    {invite?.spaces_available ?? 0} left
                  </Text>
                </View>

                {rows.map((row) => (
                  <RequestRow
                    key={row.id}
                    request={row}
                    busy={busyId === row.id}
                    onAnswer={(accept) => void answer(row, accept)}
                  />
                ))}
              </View>
            );
          })
        )}
      </ScrollView>
    </>
  );
}

function RequestRow({
  request,
  busy,
  onAnswer,
}: {
  request: IncomingRequest;
  busy: boolean;
  onAnswer: (accept: boolean) => void;
}) {
  const name =
    [request.member?.first_name, request.member?.last_name]
      .filter(Boolean)
      .join(" ") || "A member";

  const handicapShown =
    request.member?.handicap_visible && request.member?.handicap !== null;

  return (
    <View style={styles.row}>
      <View style={styles.who}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.meta}>
          {[
            request.member?.home_club,
            handicapShown ? `Handicap ${request.member?.handicap}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      {request.status === "pending" &&
        (busy ? (
          <ActivityIndicator color={colors.green700} />
        ) : (
          <View style={styles.actions}>
            <Pressable
              style={styles.decline}
              onPress={() => onAnswer(false)}
              accessibilityLabel={`Decline ${name}`}
            >
              <Text style={styles.declineLabel}>Decline</Text>
            </Pressable>
            <Pressable
              style={styles.accept}
              onPress={() => onAnswer(true)}
              accessibilityLabel={`Offer ${name} a place`}
            >
              <Text style={styles.acceptLabel}>Offer a place</Text>
            </Pressable>
          </View>
        ))}

      {request.status === "accepted" && (
        <Text style={styles.waiting}>Offered — waiting on them</Text>
      )}

      {request.status === "confirmed" && (
        <View style={styles.playing}>
          <Ionicons name="checkmark-circle" size={17} color={colors.green700} />
          <Text style={styles.playingLabel}>Playing</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream50,
  },
  empty: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontSize: type.heading,
    fontWeight: "700",
    color: colors.ink900,
  },
  emptyBody: {
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  groupHeader: {
    padding: spacing.md,
    backgroundColor: colors.surfaceTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 2,
  },
  groupClub: { fontSize: type.body, fontWeight: "700", color: colors.ink900 },
  groupMeta: { fontSize: type.small, color: colors.ink500 },
  row: {
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  who: { gap: 2 },
  name: { fontSize: type.body, fontWeight: "600", color: colors.ink900 },
  meta: { fontSize: type.small, color: colors.ink500 },
  actions: { flexDirection: "row", gap: spacing.sm },
  accept: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  acceptLabel: {
    color: colors.cream50,
    fontWeight: "700",
    fontSize: type.small,
  },
  decline: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  declineLabel: { color: colors.ink500, fontWeight: "600", fontSize: type.small },
  waiting: { fontSize: type.small, color: colors.ink500 },
  playing: { flexDirection: "row", alignItems: "center", gap: 6 },
  playingLabel: {
    fontSize: type.small,
    fontWeight: "700",
    color: colors.green700,
  },
  error: {
    fontSize: type.small,
    color: colors.red600,
    backgroundColor: colors.red100,
    borderRadius: radii.md,
    padding: spacing.md,
  },
});
