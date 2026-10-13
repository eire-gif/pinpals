import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ResultCard } from "@/components/group-past-results";
import { LoadError, StateMessage } from "@/components/state-message";
import { isOn } from "@/lib/features";
import { loadGroupResults, type GroupResult } from "@/lib/competition-data";
import { colors, fonts, spacing } from "@/lib/theme";

/**
 * A group's results (Oct 2026): every competition published to it, newest
 * first and grouped by year — the full history behind the folded "Past
 * results" row on the group's page. Any member can open it; the rows are
 * the same published copies the group page reads (0138 RLS).
 */
export default function GroupResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(id);
  const [list, setList] = useState<GroupResult[] | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await loadGroupResults(groupId));
    } catch {
      setList(null);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const header = <Stack.Screen options={{ title: "Results", headerBackTitle: "Back" }} />;
  if (!isOn("liveScoring")) return <StateMessage size="screen" icon="podium-outline" title="Results are on their way" />;
  if (list === undefined) {
    return (
      <>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </>
    );
  }
  if (list === null) {
    return (
      <>
        {header}
        <LoadError size="screen" what="the results" onRetry={() => void load()} />
      </>
    );
  }
  if (list.length === 0) {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="trophy-outline" title="No results yet" body="Once an organiser publishes a competition to this group, it's kept here for everyone." />
      </>
    );
  }

  const years = new Map<string, GroupResult[]>();
  for (const r of list) {
    const y = r.playedOn?.slice(0, 4) || "Earlier";
    years.set(y, [...(years.get(y) ?? []), r]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.cream50 }}
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.green700}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {header}
      <Text style={styles.intro}>{`${list.length} ${list.length === 1 ? "competition" : "competitions"}, newest first. Tap one for the full table and any countbacks.`}</Text>
      {[...years.entries()].map(([year, rows]) => (
        <View key={year} style={{ gap: spacing.sm }}>
          <Text style={styles.year}>{year}</Text>
          {rows.map((r) => (
            <ResultCard key={r.dayId} result={r} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink500 },
  year: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.green700, marginTop: spacing.xs },
});
