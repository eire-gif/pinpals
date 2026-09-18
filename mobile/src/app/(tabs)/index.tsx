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

type Invite = {
  id: number;
  club_name: string | null;
  play_date: string;
  time_from: string | null;
  time_to: string | null;
  exact_tee_time: string | null;
  spaces_available: number;
  has_tee_time_booked: boolean;
  handicap_limit: number | null;
  notes: string | null;
  county: string | null;
  ladies_only: boolean;
  host: { first_name: string | null; last_name: string | null } | null;
};

/** "14:30:00" → "2:30pm". Times are stored without a zone, as wall-clock. */
const clockTime = (value: string | null): string | null => {
  if (!value) return null;
  const [h, m] = value.split(":");
  const hour = Number.parseInt(h, 10);
  if (!Number.isFinite(hour)) return null;
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return m === "00" ? `${twelve}${suffix}` : `${twelve}:${m}${suffix}`;
};

const whenLabel = (invite: Invite): string => {
  const exact = clockTime(invite.exact_tee_time);
  if (exact) return exact;
  const from = clockTime(invite.time_from);
  const to = clockTime(invite.time_to);
  if (from && to) return `${from} – ${to}`;
  return from ?? "Time flexible";
};

const dateLabel = (iso: string): string => {
  // Parsed as local midnight rather than UTC: `new Date("2026-09-20")` is UTC
  // midnight, which in Ireland during BST renders as the 19th.
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

export default function TeeTimesScreen() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // RLS does the visibility work. `invite_is_visible_row` (migrations 0065,
    // 0066, 0078) already decides whether a connections-only or ladies-only
    // invite may be seen by this member, so this query deliberately does NOT
    // re-implement any of those rules — it would only ever drift from them.
    const { data, error: queryError } = await supabase
      .from("tee_time_invites")
      .select(
        `id, club_name, play_date, time_from, time_to, exact_tee_time,
         spaces_available, has_tee_time_booked, handicap_limit, notes,
         county, ladies_only,
         host:profiles!tee_time_invites_member_id_fkey (first_name, last_name)`
      )
      .eq("status", "open")
      .gte("play_date", iso)
      .gt("spaces_available", 0)
      .order("play_date", { ascending: true })
      .order("time_from", { ascending: true, nullsFirst: false })
      .limit(50)
      .overrideTypes<Invite[]>();

    if (queryError) {
      setError("Couldn't load tee times.");
    } else {
      setError(null);
      setInvites(data ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-fetch whenever the tab comes back into view. This is the whole of the
  // freshness story for v1 — see §4.1 of the build spec. A tee time filled on
  // the website is gone from this list the next time the member looks at it,
  // without a websocket per screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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
      data={invites}
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
          <Ionicons name="golf-outline" size={44} color={colors.ink500} />
          <Text style={styles.emptyTitle}>
            {error ?? "No tee times going just now"}
          </Text>
          <Text style={styles.emptyBody}>
            {error
              ? "Pull down to try again."
              : "Post one of your own and your connections will hear about it."}
          </Text>
          <Pressable
            style={styles.primary}
            onPress={() =>
              void Linking.openURL(`${SITE_URL}/dashboard/availability/new`)
            }
          >
            <Text style={styles.primaryLabel}>Post a tee time</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => {
        const host = [item.host?.first_name, item.host?.last_name]
          .filter(Boolean)
          .join(" ");

        return (
          <Pressable
            style={styles.card}
            onPress={() => void Linking.openURL(`${SITE_URL}/tee-times`)}
          >
            <View style={styles.cardTop}>
              <Text style={styles.club} numberOfLines={1}>
                {item.club_name ?? "Course to be confirmed"}
              </Text>
              <View style={styles.spaces}>
                <Text style={styles.spacesText}>
                  {item.spaces_available}{" "}
                  {item.spaces_available === 1 ? "space" : "spaces"}
                </Text>
              </View>
            </View>

            <Text style={styles.when}>
              {dateLabel(item.play_date)} · {whenLabel(item)}
            </Text>

            <View style={styles.tags}>
              {item.has_tee_time_booked && (
                <Tag icon="checkmark-circle-outline" label="Tee time booked" />
              )}
              {item.ladies_only && <Tag icon="female-outline" label="Ladies only" />}
              {item.handicap_limit !== null && (
                <Tag
                  icon="stats-chart-outline"
                  label={`Handicap ${item.handicap_limit} or better`}
                />
              )}
              {item.county && <Tag icon="location-outline" label={item.county} />}
            </View>

            {host.length > 0 && <Text style={styles.host}>Posted by {host}</Text>}
          </Pressable>
        );
      }}
    />
  );
}

function Tag({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.tag}>
      <Ionicons name={icon} size={13} color={colors.green800} />
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream50,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: 6,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  club: { flex: 1, fontSize: type.heading, fontWeight: "700", color: colors.ink900 },
  spaces: {
    backgroundColor: colors.green100,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  spacesText: { fontSize: 12.5, fontWeight: "700", color: colors.green800 },
  when: { fontSize: type.body, color: colors.ink900 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: { fontSize: 12, color: colors.green800, fontWeight: "600" },
  host: { fontSize: type.small, color: colors.ink500, marginTop: 2 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: { fontSize: type.heading, fontWeight: "700", color: colors.ink900 },
  emptyBody: { fontSize: type.body, color: colors.ink500, textAlign: "center" },
  primary: {
    marginTop: spacing.md,
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  primaryLabel: { color: colors.cream50, fontWeight: "700", fontSize: type.body },
});
