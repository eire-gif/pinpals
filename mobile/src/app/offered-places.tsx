import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { listOfferedPlaces, type OfferedPlace } from "@/lib/rounds";
import { confirmPlace } from "@/lib/tee-time-interest";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing } from "@/lib/theme";

type Answer = "confirmed" | "declined" | "error";

/**
 * Places offered to you — just those, with the answer one tap away.
 *
 * Home's "You've been offered 3 places — confirm them" used to open the whole
 * Tee Times list, leaving the member to find which three rounds it meant.
 * This screen is only those rounds, soonest first, each with Confirm and
 * Can't make it. Answered cards stay in place showing the answer, rather than
 * vanishing — a card that disappears under your finger reads as "did that
 * work?". When everything is answered the screen says so and offers the way
 * back.
 */
export default function OfferedPlacesScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [places, setPlaces] = useState<OfferedPlace[]>([]);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setPlaces(await listOfferedPlaces(userId));
      setAnswers({});
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

  const answerOne = async (place: OfferedPlace, attending: boolean): Promise<Answer> => {
    try {
      const result = await confirmPlace(place.interestId, attending);
      return result.status === "confirmed" ? "confirmed" : "declined";
    } catch {
      return "error";
    }
  };

  const confirm = async (place: OfferedPlace) => {
    setBusy(place.interestId);
    const a = await answerOne(place, true);
    setAnswers((prev) => ({ ...prev, [place.interestId]: a }));
    setBusy(null);
  };

  const decline = (place: OfferedPlace) =>
    Alert.alert(
      "Can't make it?",
      `${place.club}, ${dateLabel(place.playDate, true)}. ${place.host?.name ?? "The host"} will be told so they can offer the place to someone else.`,
      [
        { text: "Keep my place", style: "cancel" },
        {
          text: "Give it back",
          style: "destructive",
          onPress: async () => {
            setBusy(place.interestId);
            const a = await answerOne(place, false);
            setAnswers((prev) => ({ ...prev, [place.interestId]: a }));
            setBusy(null);
          },
        },
      ]
    );

  const open = places.filter((p) => !answers[p.interestId] || answers[p.interestId] === "error");

  const confirmAll = async () => {
    setBusy("all");
    const results: Record<number, Answer> = {};
    // One at a time, not in parallel: each confirm notifies a host, and a
    // failure part-way should leave the rest clearly answered or not.
    for (const p of open) results[p.interestId] = await answerOne(p, true);
    setAnswers((prev) => ({ ...prev, ...results }));
    setBusy(null);
  };

  if (loading) {
    return <ActivityIndicator color={colors.green700} style={styles.spinner} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: "Places offered to you", headerBackTitle: "Back" }} />
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
        {places.length === 0 ? (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={56} color={colors.green700} />
            <Text style={styles.doneTitle}>Nothing waiting on you</Text>
            <Text style={styles.doneBody}>When a host offers you a place, it shows up here to confirm.</Text>
            <Pressable style={styles.secondaryWide} onPress={() => router.push("/tee-times")} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>Find a game</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.intro}>
              {open.length === 0
                ? "All answered — the hosts have been told."
                : open.length === 1
                  ? "A host has saved you a place. Confirm it so they know the round is set."
                  : `Hosts have saved you ${open.length} places. Confirm them so they know the rounds are set.`}
            </Text>

            {open.length > 1 ? (
              <Pressable
                style={[styles.primaryWide, busy !== null && styles.off]}
                onPress={() => void confirmAll()}
                disabled={busy !== null}
                accessibilityRole="button"
              >
                {busy === "all" ? (
                  <ActivityIndicator color={colors.cream50} />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={20} color={colors.cream50} />
                    <Text style={styles.primaryLabel}>Confirm all {open.length}</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {places.map((p) => (
              <PlaceCard
                key={p.interestId}
                place={p}
                answer={answers[p.interestId]}
                busy={busy === p.interestId || busy === "all"}
                onConfirm={() => void confirm(p)}
                onDecline={() => decline(p)}
              />
            ))}

            {open.length === 0 ? (
              <Pressable style={styles.secondaryWide} onPress={() => router.back()} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>Done</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

function PlaceCard({
  place,
  answer,
  busy,
  onConfirm,
  onDecline,
}: {
  place: OfferedPlace;
  answer?: Answer;
  busy: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const answered = answer === "confirmed" || answer === "declined";

  return (
    <View style={[styles.card, answer === "confirmed" && styles.cardYes, answer === "declined" && styles.cardNo]}>
      <Pressable onPress={() => router.push(`/invite/${place.inviteId}`)} accessibilityRole="button" style={styles.cardTop}>
        <View style={styles.datePill}>
          <Text style={styles.dateText}>{dateLabel(place.playDate).toUpperCase()}</Text>
        </View>
        <Text style={styles.club} numberOfLines={2}>
          {place.club}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={16} color={colors.ink500} />
          <Text style={styles.meta}>{place.when}</Text>
          {place.teeTimeBooked ? (
            <View style={styles.tag}>
              <Ionicons name="checkmark-circle-outline" size={13} color={colors.green800} />
              <Text style={styles.tagText}>Tee time booked</Text>
            </View>
          ) : null}
        </View>
        {place.host ? (
          <View style={styles.hostRow}>
            <Avatar url={place.host.avatarUrl} color={place.host.avatarColor} name={place.host.name} size={34} />
            <Text style={styles.host} numberOfLines={1}>
              Hosted by <Text style={styles.hostName}>{place.host.name}</Text>
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.ink500} />
          </View>
        ) : null}
      </Pressable>

      {answered ? (
        <View style={styles.answerRow}>
          <Ionicons
            name={answer === "confirmed" ? "checkmark-circle" : "close-circle"}
            size={22}
            color={answer === "confirmed" ? colors.green700 : colors.ink500}
          />
          <Text style={[styles.answerText, answer === "declined" && styles.answerMuted]}>
            {answer === "confirmed" ? "You're in — see you on the tee" : "Place given back"}
          </Text>
        </View>
      ) : (
        <>
          {answer === "error" ? (
            <Text style={styles.error}>That didn&apos;t go through — the host may have changed the round. Try again.</Text>
          ) : null}
          <View style={styles.buttons}>
            <Pressable
              style={[styles.yes, busy && styles.off]}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Confirm my place at ${place.club}`}
            >
              {busy ? (
                <ActivityIndicator color={colors.cream50} />
              ) : (
                <Text style={styles.yesLabel}>Confirm my place</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.no, busy && styles.off]}
              onPress={onDecline}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={styles.noLabel}>Can&apos;t make it</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: 14 },
  spinner: { marginTop: spacing.xl },
  intro: { fontFamily: fonts.body, fontSize: 15.5, lineHeight: 22, color: "#3d4757" },

  primaryWide: {
    flexDirection: "row",
    gap: 8,
    minHeight: 52,
    borderRadius: radii.md,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  secondaryWide: {
    minHeight: 50,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  off: { opacity: 0.6 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: 16,
    gap: 14,
  },
  cardYes: { borderColor: colors.green600, backgroundColor: "#f5faf4" },
  cardNo: { opacity: 0.75 },
  cardTop: { gap: 8 },
  datePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dateText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: colors.green800 },
  club: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: colors.ink900 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  meta: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900, marginRight: 6 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.green800 },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  host: { flex: 1, fontFamily: fonts.body, fontSize: 14.5, color: "#4c5667" },
  hostName: { fontFamily: fonts.bodyBold, color: colors.ink900 },

  buttons: { flexDirection: "row", gap: 10 },
  yes: {
    flex: 1.4,
    minHeight: 50,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  yesLabel: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.cream50 },
  no: {
    flex: 1,
    minHeight: 50,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  noLabel: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  answerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  answerText: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.green800 },
  answerMuted: { color: colors.ink500 },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.red600 },

  done: { alignItems: "center", gap: 10, paddingTop: 40 },
  doneTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  doneBody: { fontFamily: fonts.body, fontSize: 15.5, color: "#4c5667", textAlign: "center", marginBottom: 10 },
});
