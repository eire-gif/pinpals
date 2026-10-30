import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ProCard, proStyles } from "@/components/pro-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadMyProfile } from "@/lib/profile";
import type { ServiceKind } from "@/lib/pro-rules";
import { loadPros, type Pro } from "@/lib/pros";
import { colors, fonts, radii, spacing } from "@/lib/theme";

const FILTERS: { key: ServiceKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "lesson", label: "Lessons" },
  { key: "playing", label: "Playing lessons" },
  { key: "fitting", label: "Club fitting" },
];

/**
 * Book a pro (0204): Find a pro. PGA pros, teaching pros and club fitters
 * PinPals has approved — your county first — searchable by name, club or
 * county, filtered by what they offer.
 */
export default function FindAProScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [pros, setPros] = useState<Pro[] | null>(null);
  const [myCounty, setMyCounty] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ServiceKind | "all">("all");

  const load = useCallback(async () => {
    try {
      const [list, profile] = await Promise.all([loadPros(), me ? loadMyProfile(me).catch(() => null) : Promise.resolve(null)]);
      setPros(list);
      setMyCounty(profile?.county ?? null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [me]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (pros ?? [])
      .filter((p) => p.memberId !== me)
      .filter((p) => filter === "all" || p.services.some((s) => s.kind === filter))
      .filter((p) => !needle || [p.name, p.club, p.county ?? ""].some((x) => x.toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.county === myCounty) - Number(a.county === myCounty));
  }, [pros, q, filter, myCounty, me]);

  if (!isOn("bookAPro")) return <StateMessage size="screen" icon="school-outline" title="Book a pro is on its way" />;
  if (failed && pros === null) return <LoadError size="screen" onRetry={() => void load()} what="the pros" />;

  return (
    <View style={proStyles.screen}>
      <Stack.Screen options={{ title: "Book a pro" }} />
      <FlatList
        data={pros === null ? [] : shown}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}
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
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <Text style={styles.kicker}>BOOK A PRO</Text>
              <Text style={styles.title}>Find a pro</Text>
              <View style={styles.search}>
                <Ionicons name="search" size={18} color="#c9d1dc" />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Pro, club or county"
                  placeholderTextColor="#9fb0c4"
                  style={styles.searchInput}
                  accessibilityLabel="Search pros"
                  returnKeyType="search"
                />
              </View>
              <View style={styles.filters}>
                {FILTERS.map((f) => {
                  const on = filter === f.key;
                  return (
                    <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filter, on && styles.filterOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[styles.filterText, on && { color: colors.ink900 }]}>{f.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.links}>
              <Pressable style={styles.link} onPress={() => router.push("/lessons")} accessibilityRole="button">
                <Ionicons name="calendar-outline" size={18} color={colors.green700} />
                <Text style={styles.linkText}>My lessons</Text>
              </Pressable>
              <Pressable style={styles.link} onPress={() => router.push("/teach")} accessibilityRole="button">
                <Ionicons name="school-outline" size={18} color={colors.green700} />
                <Text style={styles.linkText}>Teach on PinPals</Text>
              </Pressable>
            </View>
            {pros === null ? <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
            <ProCard pro={item} onPress={() => router.push({ pathname: "/pros/[id]", params: { id: String(item.id) } })} />
          </View>
        )}
        ListEmptyComponent={
          pros === null ? null : (
            <StateMessage
              icon="school-outline"
              title={pros.length ? "No pros match that" : "No pros listed yet"}
              body={pros.length ? "Try another search or filter." : "Pros are joining PinPals now. If you teach, tap Teach on PinPals above."}
            />
          )
        }
        ListFooterComponent={
          shown.length ? <Text style={[proStyles.hint, { textAlign: "center", paddingHorizontal: spacing.lg }]}>Every pro is checked by PinPals: PGA members by their PGA number, teaching pros and fitters by their qualification.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.navy900, padding: spacing.lg, paddingTop: spacing.md, gap: 12 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.cream50 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.navy800, borderRadius: radii.md, paddingHorizontal: 12, minHeight: 46 },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.cream50, paddingVertical: 10 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: "#3a5579", justifyContent: "center" },
  filterOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  filterText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  links: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  link: { flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  linkText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },
});
