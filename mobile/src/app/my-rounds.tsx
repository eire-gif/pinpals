import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  STATUS_LABELS,
  deleteRound,
  isPast,
  listHostedRounds,
  setRoundStatus,
  type HostedRound,
} from "@/lib/hosting";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Rounds I've posted — the last piece of the website's dashboard that had no
 * home in the app.
 *
 * Three things a host does here: see who is waiting, stop the round filling
 * up, or call it off. Answering an individual request happens on the
 * Interested screen, which this links to — that is a per-person decision and
 * belongs next to the person.
 *
 * Cancelling and deleting go through the server, not the table. Both tell
 * everyone who asked, was offered a place, or confirmed one, and that notice
 * is built with the admin client. A round called off silently is somebody
 * driving to a tee time that isn't happening.
 */
export default function MyRoundsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [rounds, setRounds] = useState<HostedRound[]>([]);
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
      setRounds(await listHostedRounds(userId));
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

  async function run(id: number, work: () => Promise<void>) {
    setBusyId(id);
    try {
      await work();
      await load();
    } catch (err) {
      Alert.alert(
        "That didn't go through",
        err instanceof ApiError
          ? err.message
          : "Check your signal and try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  function confirmCancel(round: HostedRound) {
    const waiting = round.pending + round.confirmed;
    Alert.alert(
      "Cancel this round?",
      waiting > 0
        ? `${waiting} ${waiting === 1 ? "golfer" : "golfers"} will be told it's off.`
        : "Nobody has asked to join yet.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel round",
          style: "destructive",
          onPress: () => void run(round.id, () => setRoundStatus(round.id, "cancelled")),
        },
      ]
    );
  }

  function confirmDelete(round: HostedRound) {
    Alert.alert(
      "Delete this round?",
      "It disappears for good. Anyone who asked to join is told it's off, the same as cancelling.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void run(round.id, () => deleteRound(round.id)),
        },
      ]
    );
  }

  const upcoming = rounds.filter((round) => !isPast(round));
  const past = rounds.filter(isPast);
  const sections = [
    { title: "Coming up", data: upcoming },
    { title: "Past", data: past },
  ].filter((section) => section.data.length > 0);

  const waiting = upcoming.reduce((total, round) => total + round.pending, 0);

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          headerTitle: "",
          headerBackTitle: "Back",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/post-tee-time")}
              hitSlop={12}
              style={{ paddingHorizontal: spacing.md }}
              accessibilityLabel="Post a tee time"
            >
              <Ionicons name="add-circle" size={26} color={colors.green700} />
            </Pressable>
          ),
        }}
      />

      <ScreenHeader
        scene="linksDusk"
        title="Rounds I've posted"
        subtitle={
          loading
            ? "Loading"
            : waiting > 0
              ? waiting === 1
                ? "1 golfer waiting on you"
                : `${waiting} golfers waiting on you`
              : upcoming.length === 0
                ? "Nothing posted"
                : upcoming.length === 1
                  ? "1 round coming up"
                  : `${upcoming.length} rounds coming up`
        }
      />

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <SectionList
          style={styles.fill}
          contentContainerStyle={styles.list}
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          stickySectionHeadersEnabled={false}
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
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="golf-outline" size={44} color={colors.ink500} />
              <Text style={styles.emptyTitle}>You haven&apos;t posted a round</Text>
              <Text style={styles.emptyBody}>
                Offer a tee time and other members can ask to join you. You choose who plays.
              </Text>
              <Pressable
                style={styles.cta}
                onPress={() => router.push("/post-tee-time")}
                accessibilityRole="button"
              >
                <Text style={styles.ctaLabel}>Post a tee time</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <RoundCard
              round={item}
              busy={busyId === item.id}
              onOpen={() => router.push(`/invite/${item.id}`)}
              onInterested={() => router.push("/tee-time-requests")}
              onToggleFull={() =>
                void run(item.id, () =>
                  setRoundStatus(item.id, item.status === "full" ? "open" : "full")
                )
              }
              onCancel={() => confirmCancel(item)}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function RoundCard({
  round,
  busy,
  onOpen,
  onInterested,
  onToggleFull,
  onCancel,
  onDelete,
}: {
  round: HostedRound;
  busy: boolean;
  onOpen: () => void;
  onInterested: () => void;
  onToggleFull: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const over = isPast(round);
  const dead = round.status === "cancelled" || round.status === "completed";

  return (
    <View style={[styles.card, dead && styles.cardDim]}>
      <Pressable onPress={onOpen} accessibilityRole="button">
        <View style={styles.cardHead}>
          <Text style={styles.club} numberOfLines={1}>
            {round.club}
          </Text>
          <View style={[styles.badge, round.status === "open" && styles.badgeOpen]}>
            <Text style={[styles.badgeLabel, round.status === "open" && styles.badgeLabelOpen]}>
              {STATUS_LABELS[round.status]}
            </Text>
          </View>
        </View>

        <Text style={styles.when}>
          {dateLabel(round.playDate, true)}
          {round.exactTeeTime ? ` · ${round.exactTeeTime.slice(0, 5)}` : ""}
          {!round.exactTeeTime && round.timeFrom
            ? ` · ${round.timeFrom.slice(0, 5)}–${(round.timeTo ?? "").slice(0, 5)}`
            : ""}
        </Text>

        <Text style={styles.meta}>
          {round.spacesAvailable} {round.spacesAvailable === 1 ? "space" : "spaces"}
          {round.confirmed > 0 ? ` · ${round.confirmed} confirmed` : ""}
          {round.ladiesOnly ? " · Ladies only" : ""}
        </Text>
      </Pressable>

      {/* The one row that is an actual call on the host's time. It only
          appears when somebody is actually waiting. */}
      {round.pending > 0 ? (
        <Pressable style={styles.waiting} onPress={onInterested} accessibilityRole="button">
          <Ionicons name="people" size={16} color={colors.ink900} />
          <Text style={styles.waitingLabel}>
            {round.pending === 1
              ? "1 golfer is waiting on your answer"
              : `${round.pending} golfers are waiting on your answer`}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.ink900} />
        </Pressable>
      ) : null}

      {/* Nothing to do with a round that is over or already called off, so
          the buttons go rather than sitting there disabled. */}
      {!over && !dead ? (
        <View style={styles.actions}>
          <Action
            label={round.status === "full" ? "Re-open" : "Mark full"}
            icon={round.status === "full" ? "lock-open-outline" : "lock-closed-outline"}
            busy={busy}
            onPress={onToggleFull}
          />
          <Action label="Cancel" icon="close-circle-outline" busy={busy} danger onPress={onCancel} />
          <Action label="Delete" icon="trash-outline" busy={busy} danger onPress={onDelete} />
        </View>
      ) : dead ? (
        <View style={styles.actions}>
          <Action label="Delete" icon="trash-outline" busy={busy} danger onPress={onDelete} />
        </View>
      ) : null}
    </View>
  );
}

function Action({
  label,
  icon,
  busy,
  danger,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  busy: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.action, busy && styles.actionOff]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={15} color={danger ? colors.red600 : colors.green700} />
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
    paddingTop: spacing.sm,
    paddingBottom: 2,
  },

  card: {
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardDim: { opacity: 0.62 },

  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  club: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },

  badge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.cream100,
  },
  badgeOpen: { backgroundColor: colors.green100 },
  badgeLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, color: colors.ink500 },
  badgeLabelOpen: { color: colors.green700 },

  when: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, marginTop: 3 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginTop: 1 },

  waiting: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.gold400,
  },
  waitingLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },

  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  actionOff: { opacity: 0.45 },
  actionLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  actionLabelDanger: { color: colors.red600 },

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
