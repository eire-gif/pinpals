import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";

import { Avatar } from "@/components/avatar";
import { listBlocked, unblockMember, type BlockedMember } from "@/lib/blocking";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Everyone you have blocked, with Unblock beside each. The only place a
 * member can see the whole list — and the place the block confirm points
 * them to, so it has to exist before blocking can be offered.
 */
export default function BlockedMembersScreen() {
  const [members, setMembers] = useState<BlockedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMembers(await listBlocked());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your blocked members.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unblock(member: BlockedMember) {
    setBusyId(member.id);
    try {
      await unblockMember(member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      Alert.alert("Couldn't unblock that member", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Blocked members", headerBackTitle: "Back" }} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.green700} />
      ) : (
        <FlatList
          style={styles.fill}
          data={members}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
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
          ListHeaderComponent={
            <Text style={styles.intro}>
              Blocked members can&apos;t see your posts or comments or message you, and you don&apos;t see theirs. They
              aren&apos;t told.
            </Text>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>{error ?? "You haven't blocked anyone."}</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.who}
                onPress={() => router.push({ pathname: "/member/[id]", params: { id: item.id } })}
                accessibilityRole="link"
              >
                <Avatar url={item.avatarUrl} color={item.avatarColor} name={item.name} size={40} />
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void unblock(item)}
                disabled={busyId === item.id}
                style={styles.unblock}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.name}`}
              >
                {busyId === item.id ? (
                  <ActivityIndicator color={colors.green700} />
                ) : (
                  <Text style={styles.unblockLabel}>Unblock</Text>
                )}
              </Pressable>
            </View>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500, marginBottom: spacing.md },
  empty: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", marginTop: spacing.lg },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  who: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, minWidth: 0 },
  name: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  unblock: {
    minWidth: 92,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.green700,
  },
  unblockLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
