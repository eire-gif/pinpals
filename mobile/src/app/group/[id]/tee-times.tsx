import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { clock, irishToday, isOutingDay, outingDateLabel } from "@/lib/outing-rules";
import { loadMyTeeTimes, type MyTeeTime } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Your tee times in this society (0125): one card per outing you're in
 * whose draw the captain or secretary has published — the time, your group
 * and who you're playing with. On the day, once the round has started, the
 * card opens the leaderboard and your scorecard.
 */
export default function SocietyTeeTimesScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [times, setTimes] = useState<MyTeeTime[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setTimes(await loadMyTeeTimes(groupId, userId, irishToday()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Your tee times", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body}>
        {failed && !times ? (
          <LoadError onRetry={() => void load()} what="your tee times" />
        ) : times === null ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
        ) : times.length === 0 ? (
          <StateMessage
            icon="golf-outline"
            title="No tee times yet"
            body="Join an outing under Events. When the captain or secretary publishes the draw, your tee time shows here."
            action={{ label: "See events", onPress: () => router.replace({ pathname: "/group/[id]/events", params: { id: String(groupId) } }) }}
          />
        ) : (
          times.map((t) => {
            const live = t.matchDayId != null;
            return (
              <Pressable
                key={t.outingId}
                style={[styles.card, isOutingDay(t.playsOn) && styles.cardToday]}
                onPress={() =>
                  live
                    ? router.push({ pathname: "/live/day/[id]", params: { id: String(t.matchDayId) } })
                    : router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(t.outingId) } })
                }
                accessibilityRole="button"
                accessibilityLabel={`${t.title}, ${outingDateLabel(t.playsOn)}, ${clock(t.teeTime) ?? `group ${t.teeGroup}`}`}
              >
                <View style={styles.time}>
                  <Text style={styles.timeValue}>{clock(t.teeTime) ?? "—"}</Text>
                  <Text style={styles.timeGroup}>{`GROUP ${t.teeGroup}`}</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.when}>{isOutingDay(t.playsOn) ? "TODAY" : outingDateLabel(t.playsOn).toUpperCase()}</Text>
                  <Text style={styles.title} numberOfLines={1}>
                    {t.title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {t.courseName}
                  </Text>
                  <Text style={styles.with} numberOfLines={2}>
                    {t.partners.length > 0 ? `With ${t.partners.join(", ")}` : "On your own so far"}
                  </Text>
                  {live ? (
                    <View style={styles.live}>
                      <Ionicons name="radio-button-on" size={12} color={colors.red600} />
                      <Text style={styles.liveText}>Round under way · your card</Text>
                    </View>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: 12, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardToday: { borderColor: colors.green600, backgroundColor: colors.green100 },
  time: { width: 76, alignItems: "center", paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.navy900 },
  timeValue: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  timeGroup: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1, color: colors.gold400 },
  cardBody: { flex: 1, gap: 2 },
  when: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1, color: colors.green700 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  with: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  live: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  liveText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.red600 },
});
