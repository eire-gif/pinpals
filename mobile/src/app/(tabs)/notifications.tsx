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
import { useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";

import { supabase } from "@/lib/supabase";
import { SITE_URL } from "@/lib/config";
import { colors, radii, spacing, type } from "@/lib/theme";

type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: { href?: string } | null;
  read_at: string | null;
  created_at: string;
};

const ago = (iso: string): string => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
  });
};

const iconFor = (type: string): keyof typeof Ionicons.glyphMap => {
  if (type.startsWith("tee_time")) return "golf-outline";
  if (type.startsWith("offer") || type.startsWith("bid")) return "pricetag-outline";
  if (type.startsWith("message")) return "chatbubble-outline";
  if (type.startsWith("order") || type.startsWith("payment")) return "card-outline";
  if (type.startsWith("review")) return "star-outline";
  return "notifications-outline";
};

export default function NotificationsScreen() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, data, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .overrideTypes<Notification[]>();

    setItems(data ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const open = async (item: Notification) => {
    // Optimistic: the row is marked read locally before the update lands, so
    // the tap feels instant. If the update fails the next refresh puts the dot
    // back, which is the right way round — a notification wrongly shown as
    // unread is a much smaller problem than one wrongly shown as read.
    if (!item.read_at) {
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n
        )
      );
      void supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", item.id);
    }

    const href = item.data?.href;
    if (href) {
      await Linking.openURL(
        href.startsWith("http") ? href : `${SITE_URL}${href}`
      );
    }
  };

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.green700} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.list}
      data={items}
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
        <View style={styles.empty}>
          <Ionicons name="notifications-off-outline" size={44} color={colors.ink500} />
          <Text style={styles.emptyTitle}>Nothing yet</Text>
          <Text style={styles.emptyBody}>
            Offers, messages and tee-time replies will land here.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={[styles.row, !item.read_at && styles.rowUnread]}
          onPress={() => void open(item)}
        >
          <Ionicons
            name={iconFor(item.type)}
            size={20}
            color={item.read_at ? colors.ink500 : colors.green700}
            style={styles.rowIcon}
          />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            {item.body && <Text style={styles.rowText}>{item.body}</Text>}
            <Text style={styles.rowTime}>{ago(item.created_at)}</Text>
          </View>
          {!item.read_at && <View style={styles.dot} />}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream50,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  rowUnread: { backgroundColor: colors.surfaceTint, borderColor: colors.green100 },
  rowIcon: { marginTop: 2 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: type.body, fontWeight: "700", color: colors.ink900 },
  rowText: { fontSize: type.small, color: colors.ink900 },
  rowTime: { fontSize: 12.5, color: colors.ink500, marginTop: 2 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.green600,
    marginTop: 6,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: { fontSize: type.heading, fontWeight: "700", color: colors.ink900 },
  emptyBody: { fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
