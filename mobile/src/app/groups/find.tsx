import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GroupRow, membersLabel } from "@/components/group-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { searchSocieties, type Group } from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Find a society (0120). Societies are the one kind anyone can find: the
 * list is every society by name, and typing narrows it. Tapping one opens
 * its front page, where you can ask to join.
 */
export default function FindSocietyScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const token = useRef(0);

  useEffect(() => {
    const t = ++token.current;
    const timer = setTimeout(() => {
      searchSocieties(query)
        .then((groups) => {
          if (t !== token.current) return;
          setResults(groups);
          setFailed(false);
        })
        .catch(() => {
          if (t === token.current) setFailed(true);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, attempt]);

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Find a society", headerBackTitle: "Back" }} />
      <View style={styles.head}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={17} color={colors.ink500} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search societies by name"
            placeholderTextColor={colors.ink500}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search societies"
          />
        </View>
      </View>

      {failed ? (
        <LoadError onRetry={() => setAttempt((n) => n + 1)} what="societies" />
      ) : results === null ? (
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(g) => String(g.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <StateMessage
              icon="trophy-outline"
              title={query.trim() ? "No society by that name" : "No societies yet"}
              body="Is yours not on PinPals? Start it — it takes a minute, and you can invite your members with one link."
              action={{ label: "Start a society", onPress: () => router.replace("/groups/new") }}
            />
          }
          renderItem={({ item }) => (
            <GroupRow
              kind={item.kind}
              name={item.name}
              detail={[membersLabel(item.memberCount), item.clubName].filter(Boolean).join(" · ")}
              onPress={() => router.push({ pathname: "/group/[id]", params: { id: String(item.id) } })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  head: { padding: spacing.md, paddingBottom: spacing.sm },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  search: { flex: 1, height: 44, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  spinner: { marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl, flexGrow: 1 },
});
