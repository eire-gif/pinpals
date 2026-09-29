import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import {
  REQUEST_STATUS_LABELS,
  listMyRequests,
  type MyRequest,
  type RequestStatus,
} from "@/lib/rounds";
import { confirmPlace } from "@/lib/tee-time-interest";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Rounds you have asked to join, and what came of each.
 *
 * Declined requests stay in the list. A request that quietly disappears
 * reads as a bug, and "they said no" is an answer worth being able to see.
 *
 * The ones that matter are `accepted`: a place has been offered and is
 * holding a space in somebody's fourball until it is confirmed or given
 * back. Those sort to the top and carry the two buttons.
 */
export default function MyRequestsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setRequests(await listMyRequests(userId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function answer(request: MyRequest, attending: boolean) {
    setBusyId(request.interestId);
    try {
      const result = await confirmPlace(request.interestId, attending);
      // Patch in place rather than re-fetching: the row the member is looking
      // at should change under their finger, not after a round trip.
      setRequests((prev) =>
        prev.map((entry) =>
          entry.interestId === request.interestId
            ? { ...entry, status: result.status as RequestStatus }
            : entry
        )
      );
    } catch (err) {
      Alert.alert(
        "Couldn't save that",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  function confirmDecline(request: MyRequest) {
    // Giving a place back frees a space in someone's fourball and cannot be
    // undone without asking again, so it asks first.
    Alert.alert(
      "Give up your place?",
      `${request.club} on ${dateLabel(request.playDate, true)}. The host will be told and the space goes back.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Give it up",
          style: "destructive",
          onPress: () => void answer(request, false),
        },
      ]
    );
  }

  // Waiting is the only state the member can do nothing about, so it is the
  // one worth surfacing before they read a single row.
  const waiting = requests.filter((entry) => entry.status === "pending").length;
  const subtitle =
    requests.length === 0
      ? "Nothing asked for yet"
      : waiting === 0
        ? "All answered"
        : waiting === 1
          ? "1 waiting on a host"
          : `${waiting} waiting on a host`;

  return (
    <>
      {/* The band carries the screen's name, so the bar above it
          does not need to carry it too. */}
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />

      <ScreenHeader scene="linksSunset" title="My requests" subtitle={subtitle} />

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <FlatList
          style={styles.fill}
          contentContainerStyle={styles.list}
          data={requests}
          keyExtractor={(item) => String(item.interestId)}
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
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="hand-right-outline" size={44} color={colors.ink500} />
              <Text style={styles.emptyTitle}>You haven&apos;t asked to join anything yet</Text>
              <Text style={styles.emptyBody}>
                Find a round that suits and ask the host for a place. Every
                request you send shows up here with its answer.
              </Text>
              <Pressable
                style={styles.cta}
                onPress={() => router.push("/tee-times")}
                accessibilityRole="button"
              >
                <Text style={styles.ctaLabel}>Browse tee times</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.card, item.status === "accepted" && styles.cardAction]}>
              <Pressable
                onPress={() => router.push(`/invite/${item.inviteId}`)}
                accessibilityRole="button"
              >
                <Text style={styles.club} numberOfLines={1}>
                  {item.club}
                </Text>
                <Text style={styles.when}>
                  {dateLabel(item.playDate, true)} · {item.when}
                </Text>
              </Pressable>

              <View style={[styles.status, STATUS_STYLE[item.status]]}>
                <Text style={[styles.statusLabel, STATUS_LABEL_STYLE[item.status]]}>
                  {REQUEST_STATUS_LABELS[item.status]}
                </Text>
              </View>

              {item.status === "accepted" ? (
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.button, styles.buttonYes]}
                    disabled={busyId === item.interestId}
                    onPress={() => void answer(item, true)}
                    accessibilityRole="button"
                  >
                    {busyId === item.interestId ? (
                      <ActivityIndicator color={colors.cream50} size="small" />
                    ) : (
                      <Text style={styles.buttonYesLabel}>Confirm my place</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={styles.button}
                    disabled={busyId === item.interestId}
                    onPress={() => confirmDecline(item)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.buttonLabel}>I can&apos;t make it</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </>
  );
}

const STATUS_STYLE: Record<RequestStatus, { backgroundColor: string }> = {
  pending: { backgroundColor: colors.surfaceTint },
  accepted: { backgroundColor: colors.gold400 },
  confirmed: { backgroundColor: colors.green100 },
  declined: { backgroundColor: colors.red100 },
};

const STATUS_LABEL_STYLE: Record<RequestStatus, { color: string }> = {
  pending: { color: colors.ink500 },
  accepted: { color: colors.ink900 },
  confirmed: { color: colors.green700 },
  declined: { color: colors.red600 },
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  card: {
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "flex-start",
  },
  cardAction: { borderColor: colors.gold500, borderWidth: 1.5 },

  club: { fontFamily: fonts.display, fontSize: 18, color: colors.ink900 },
  when: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
    marginTop: 2,
  },

  status: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  statusLabel: { fontFamily: fonts.bodyBold, fontSize: 11 },

  actions: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  buttonLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  buttonYes: { backgroundColor: colors.green700, borderColor: colors.green700 },
  buttonYesLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 21,
    color: colors.ink900,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
