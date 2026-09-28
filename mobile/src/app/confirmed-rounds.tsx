import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import { listConfirmedRounds, type ConfirmedRound } from "@/lib/rounds";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The rounds you are actually playing in.
 *
 * Two lists in one, because "what have I got coming up" and "what have I
 * played" are different questions and only the first one is urgent. Past
 * rounds are kept rather than dropped: they are the record of who you have
 * played with, which is the whole point of a golf community.
 *
 * Each card names the other players. That is the bit the website's version
 * gets right and the reason this screen exists at all — a confirmed round
 * with no names on it is just a date.
 */
export default function ConfirmedRoundsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [upcoming, setUpcoming] = useState<ConfirmedRound[]>([]);
  const [past, setPast] = useState<ConfirmedRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const rounds = await listConfirmedRounds(userId);
      setUpcoming(rounds.upcoming);
      setPast(rounds.past);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // On focus rather than on mount alone: confirming a place happens on
  // another screen, and coming back here should show the round you just
  // joined.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const sections = [
    { title: "Coming up", data: upcoming },
    { title: "Played", data: past },
  ].filter((section) => section.data.length > 0);

  return (
    <>
      <Stack.Screen options={{ title: "Confirmed rounds", headerBackTitle: "Back" }} />

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <SectionList
          style={styles.fill}
          contentContainerStyle={styles.list}
          sections={sections}
          keyExtractor={(item) => String(item.inviteId)}
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
          renderItem={({ item }) => (
            <RoundCard
              round={item}
              onPress={() => router.push(`/invite/${item.inviteId}`)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="golf-outline" size={44} color={colors.ink500} />
              <Text style={styles.emptyTitle}>No confirmed rounds yet</Text>
              <Text style={styles.emptyBody}>
                Once you post a tee time and somebody confirms, or you confirm a
                place you&apos;ve been offered, the round shows up here with
                everyone who&apos;s playing.
              </Text>
              <Pressable
                style={styles.cta}
                onPress={() => router.push("/tee-times")}
                accessibilityRole="button"
              >
                <Text style={styles.ctaLabel}>Find a round</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </>
  );
}

function RoundCard({ round, onPress }: { round: ConfirmedRound; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View style={styles.cardTop}>
        <View style={styles.cardHead}>
          <Text style={styles.club} numberOfLines={1}>
            {round.club}
          </Text>
          <Text style={styles.when}>
            {dateLabel(round.playDate, true)} · {round.when}
          </Text>
        </View>

        <View style={[styles.role, round.role === "hosting" && styles.roleHost]}>
          <Text style={[styles.roleLabel, round.role === "hosting" && styles.roleLabelHost]}>
            {round.role === "hosting" ? "You're hosting" : "You're playing"}
          </Text>
        </View>
      </View>

      <View style={styles.players}>
        {round.players.length === 0 ? (
          <Text style={styles.playersNone}>
            {round.role === "hosting"
              ? "Nobody has confirmed a place yet."
              : "Just you so far."}
          </Text>
        ) : (
          round.players.map((player, index) => (
            <View key={`${player.name}-${index}`} style={styles.player}>
              <Ionicons name="person-circle-outline" size={17} color={colors.green700} />
              <Text style={styles.playerName} numberOfLines={1}>
                {player.name}
                {player.homeClub ? (
                  <Text style={styles.playerClub}> · {player.homeClub}</Text>
                ) : null}
              </Text>
            </View>
          ))
        )}
      </View>
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
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  cardHead: { flex: 1, gap: 2 },
  club: { fontFamily: fonts.display, fontSize: 18, color: colors.ink900 },
  when: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  role: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
  },
  roleHost: { backgroundColor: colors.gold400 },
  roleLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, color: colors.green700 },
  roleLabelHost: { color: colors.ink900 },

  players: {
    gap: 5,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  player: { flexDirection: "row", alignItems: "center", gap: 6 },
  playerName: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: type.small,
    color: colors.ink900,
  },
  playerClub: { fontFamily: fonts.body, color: colors.ink500 },
  playersNone: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

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
