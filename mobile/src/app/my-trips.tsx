import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { listMyTrips, type MyTrip } from "@/lib/itinerary";
import { countdownLabel, tripBadge, tripRangeLabel } from "@/lib/itinerary-rules";
import { irishToday } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Profile › My trips (0126): the overnight and abroad trips you're on,
 * across your societies — upcoming first, or past. Each opens its itinerary.
 */
export default function MyTripsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [past, setPast] = useState(false);
  const [trips, setTrips] = useState<MyTrip[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setTrips(await listMyTrips(userId, irishToday(), { past }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [userId, past]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const today = irishToday();

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "My trips", headerBackTitle: "Back" }} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.tabs} accessibilityRole="tablist">
          {[false, true].map((p) => (
            <Pressable
              key={String(p)}
              style={[styles.tab, past === p && styles.tabOn]}
              onPress={() => {
                setTrips(null);
                setPast(p);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: past === p }}
            >
              <Text style={[styles.tabText, past === p && styles.tabTextOn]}>{p ? "Past" : "Upcoming"}</Text>
            </Pressable>
          ))}
        </View>

        {failed && !trips ? (
          <LoadError onRetry={() => void load()} what="your trips" />
        ) : trips === null ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
        ) : trips.length === 0 ? (
          <StateMessage
            icon="airplane-outline"
            title={past ? "No past trips" : "No trips coming up"}
            body={past ? undefined : "When your society's captain sets up an overnight or abroad trip and you join it, it shows here with the full itinerary."}
          />
        ) : (
          trips.map((t) => (
            <Pressable
              key={t.outingId}
              style={styles.card}
              onPress={() => router.push({ pathname: "/group/[id]/itinerary/[outingId]", params: { id: String(t.groupId), outingId: String(t.outingId) } })}
              accessibilityRole="button"
              accessibilityLabel={`${t.title}, ${tripRangeLabel(t.playsOn, t.endsOn)}`}
            >
              <View style={styles.cardTop}>
                <Text style={styles.badge}>{tripBadge(t.kind, t.playsOn, t.endsOn)}</Text>
                {t.organiser ? <Text style={styles.organiser}>You&apos;re organising</Text> : null}
              </View>
              <Text style={styles.title}>{t.title}</Text>
              <Text style={styles.meta}>{[tripRangeLabel(t.playsOn, t.endsOn), t.location].filter(Boolean).join(" · ")}</Text>
              <View style={styles.cardFoot}>
                <Text style={styles.meta}>{t.groupName ?? ""}</Text>
                <View style={styles.open}>
                  <Text style={styles.openText}>{past ? "Itinerary" : countdownLabel(t.playsOn, t.endsOn, today)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.gold400} />
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  tabs: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xs },
  tab: { paddingHorizontal: 16, height: 36, borderRadius: radii.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  tabText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  tabTextOn: { color: colors.cream50 },
  card: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.navy900, backgroundColor: colors.gold400, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  organiser: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50, marginTop: 4 },
  meta: { fontFamily: fonts.body, fontSize: 13.5, color: colors.cream100 },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  open: { flexDirection: "row", alignItems: "center", gap: 2 },
  openText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.gold400 },
});
