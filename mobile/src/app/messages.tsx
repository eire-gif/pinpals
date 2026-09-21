import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { inboxTime, listInbox, type InboxRow } from "@/lib/messages";
import { subscribeToInbox } from "@/lib/realtime";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The inbox.
 *
 * Three things keep it current, in descending order of how much they matter:
 *
 *   1. A refetch on focus. This is the one that always works — it needs no
 *      socket and no push, and it covers the case where the app was closed.
 *   2. The inbox broadcast channel, for a message that lands while the
 *      member is looking at this screen.
 *   3. Pull to refresh, for when someone doesn't believe the other two.
 *
 * Archived threads don't appear — filtered in listInbox(), matching the
 * website, where archiving is a filed-away action rather than a label.
 */
export default function MessagesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setRows(await listInbox(userId));
      setError(null);
    } catch {
      setError("Couldn't load your messages.");
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

  useEffect(() => {
    if (!userId) return;
    return subscribeToInbox(userId, () => void load());
  }, [userId, load]);

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Messages", headerBackTitle: "Back" }} />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={rows}
          keyExtractor={(item) => String(item.id)}
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
            error ? (
              <Empty
                icon="cloud-offline-outline"
                title={error}
                body="Pull down to try again."
              />
            ) : (
              <Empty
                icon="chatbubbles-outline"
                title="No messages yet"
                body="Conversations start from a marketplace listing, a connection, or a tee time you've been accepted for."
              />
            )
          }
          renderItem={({ item }) => (
            <Row
              row={item}
              onPress={() => router.push(`/conversation/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function Row({ row, onPress }: { row: InboxRow; onPress: () => void }) {
  const unread = row.unreadCount > 0;

  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <Avatar
        url={row.otherAvatarUrl}
        color={row.otherAvatarColor}
        name={row.otherName}
        size={44}
      />

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {row.otherName}
          </Text>
          <Text style={styles.time}>{inboxTime(row.lastMessageAt)}</Text>
        </View>

        {/* The listing, not the last message. A preview would mean either a
            second query per row or denormalising message bodies onto the
            conversation — and "about: TaylorMade Stealth driver" is the more
            useful line anyway, because it says which of two threads with the
            same person this is. */}
        <Text style={styles.context} numberOfLines={1}>
          {row.listingTitle ?? "Direct message"}
        </Text>
      </View>

      {unread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>
            {row.unreadCount > 99 ? "99+" : row.unreadCount}
          </Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      )}
    </Pressable>
  );
}

function Empty({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.ink500} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  name: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink900,
  },
  time: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },
  context: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
  },

  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.cream50,
  },

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
    lineHeight: 27,
    color: colors.ink900,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
});
