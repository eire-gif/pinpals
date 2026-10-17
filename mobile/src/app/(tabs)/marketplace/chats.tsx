import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { listMarketplaceChats } from "@/lib/marketplace-chats";
import type { InboxRow } from "@/lib/messages";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Marketplace chats (mock-up 8's menu): every thread that's about a listing,
 * newest first, with the item named on the row. The same threads are in the
 * Inbox too — this is the marketplace's view of them, so buyers and sellers
 * don't dig through tee-time and society chats to find "is this still for sale?"
 */
export default function MarketplaceChatsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      setRows(await listMarketplaceChats(userId));
      setFailed(false);
    } catch {
      setFailed(true);
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

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={rows.length === 0 ? styles.emptyWrap : styles.list}
      data={rows}
      keyExtractor={(row) => String(row.id)}
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
        <View style={styles.empty}>
          <Ionicons name={failed ? "cloud-offline-outline" : "chatbubbles-outline"} size={40} color={colors.ink500} />
          <Text style={styles.emptyTitle}>{failed ? "Couldn't load your chats" : "No marketplace chats yet"}</Text>
          <Text style={styles.emptyBody}>
            {failed ? "Pull down to try again." : "Message a seller from any listing and the chat lands here."}
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const unread = item.unreadCount > 0;
        const preview = item.lastMessage
          ? item.lastMessage.deleted
            ? "Message deleted"
            : item.lastMessage.photo
              ? "Photo"
              : `${item.lastMessage.mine ? "You: " : ""}${item.lastMessage.body}`
          : "Say hello";
        return (
          <Pressable
            onPress={() => router.push(`/conversation/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`${item.otherName} about ${item.listingTitle}${unread ? `, ${item.unreadCount} unread` : ""}`}
          >
            <Avatar url={item.otherAvatarUrl} color={item.otherAvatarColor} name={item.otherName} size={48} />
            <View style={styles.body}>
              <View style={styles.top}>
                <Text style={[styles.name, unread && styles.bold]} numberOfLines={1}>
                  {item.otherName}
                </Text>
                {item.lastMessageAt ? <Text style={styles.when}>{ago(item.lastMessageAt)}</Text> : null}
              </View>
              <View style={styles.item}>
                <Ionicons name="pricetag" size={12} color={colors.gold500} />
                <Text style={styles.itemText} numberOfLines={1}>
                  {item.listingTitle}
                </Text>
              </View>
              <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                {preview}
              </Text>
            </View>
            {unread ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, gap: 10 },
  emptyWrap: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  body: { flex: 1, gap: 2 },
  top: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  bold: { fontFamily: fonts.bodyBold },
  when: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  item: { flexDirection: "row", alignItems: "center", gap: 5 },
  itemText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },
  preview: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  previewUnread: { color: colors.ink900 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.red600, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.cream50 },
  empty: { alignItems: "center", gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
