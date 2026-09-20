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
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";

import { InviteCard } from "@/components/invite-card";
import { SITE_URL } from "@/lib/config";
import { useCurrentLocation } from "@/lib/location";
import { listInvites, listInvitesNear, type Invite } from "@/lib/tee-times";
import { colors, radii, spacing, type } from "@/lib/theme";

type Scope = "all" | "near";

const RADIUS_KM = 50;

export default function TeeTimesScreen() {
  const router = useRouter();
  const location = useCurrentLocation();

  const [scope, setScope] = useState<Scope>("all");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (next: Scope) => {
      setError(null);
      try {
        if (next === "near") {
          // Reuse a fix we already have rather than waking the GPS on every
          // tab focus.
          const coords =
            location.state.status === "ready"
              ? location.state.coords
              : await location.request();

          if (!coords) {
            setInvites([]);
            return;
          }
          setInvites(await listInvitesNear(coords.lat, coords.lng, RADIUS_KM));
        } else {
          setInvites(await listInvites());
        }
      } catch {
        setError("Couldn't load tee times.");
        setInvites([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [location]
  );

  useEffect(() => {
    void load(scope);
    // Intentionally keyed on scope alone: `load` changes identity whenever the
    // location hook's state does, which would re-fetch on every permission
    // transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Re-fetch when the tab comes back into view. This is the whole freshness
  // story — a tee time filled on the website is gone from this list next time
  // the member looks, with no websocket per screen. See §4.1 of the spec.
  useFocusEffect(
    useCallback(() => {
      void load(scope);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope])
  );

  const switchTo = (next: Scope) => {
    if (next === scope) return;
    setLoading(true);
    setScope(next);
  };

  return (
    <View style={styles.fill}>
      <View style={styles.segments}>
        <Segment
          label="All tee times"
          active={scope === "all"}
          onPress={() => switchTo("all")}
        />
        <Segment
          label={`Near me`}
          icon="navigate-outline"
          active={scope === "near"}
          onPress={() => switchTo("near")}
        />
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={invites}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(scope);
              }}
              tintColor={colors.green700}
            />
          }
          ListHeaderComponent={
            scope === "near" && location.state.status === "ready" ? (
              <Text style={styles.radiusNote}>
                Within {RADIUS_KM} km of you
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              scope={scope}
              error={error}
              locationStatus={location.state.status}
              onRetryLocation={() => void load("near")}
            />
          }
          renderItem={({ item }) => (
            <InviteCard
              invite={item}
              onPress={() => router.push(`/invite/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function Segment({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.segment, active && styles.segmentActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={15}
          color={active ? colors.cream50 : colors.ink500}
        />
      )}
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function EmptyState({
  scope,
  error,
  locationStatus,
  onRetryLocation,
}: {
  scope: Scope;
  error: string | null;
  locationStatus: string;
  onRetryLocation: () => void;
}) {
  if (error) {
    return (
      <Empty icon="cloud-offline-outline" title={error} body="Pull down to try again." />
    );
  }

  if (scope === "near" && locationStatus === "denied") {
    return (
      <Empty
        icon="location-outline"
        title="Location is off"
        body="PinPals needs location to find tee times near you. Turn it on in Settings → PinPals → Location."
        action={{ label: "Open Settings", onPress: () => void Linking.openSettings() }}
      />
    );
  }

  if (scope === "near" && locationStatus === "failed") {
    return (
      <Empty
        icon="navigate-circle-outline"
        title="Couldn't find you"
        body="Sometimes it just needs another go, especially indoors."
        action={{ label: "Try again", onPress: onRetryLocation }}
      />
    );
  }

  return (
    <Empty
      icon="golf-outline"
      title={
        scope === "near"
          ? `Nothing within ${RADIUS_KM} km`
          : "No tee times going just now"
      }
      body={
        scope === "near"
          ? "Try All tee times — someone might be playing further afield."
          : "Post one of your own and your connections will hear about it."
      }
      action={{
        label: "Post a tee time",
        onPress: () =>
          void Linking.openURL(`${SITE_URL}/dashboard/availability/new`),
      }}
    />
  );
}

function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.ink500} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action && (
        <Pressable style={styles.primary} onPress={action.onPress}>
          <Text style={styles.primaryLabel}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  segments: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    minHeight: 36,
  },
  segmentActive: {
    backgroundColor: colors.green700,
    borderColor: colors.green700,
  },
  segmentText: { fontSize: type.small, fontWeight: "700", color: colors.ink500 },
  segmentTextActive: { color: colors.cream50 },
  list: { padding: spacing.md, gap: spacing.md, flexGrow: 1 },
  radiusNote: {
    fontSize: type.small,
    color: colors.ink500,
    marginBottom: 2,
  },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    fontSize: type.heading,
    fontWeight: "700",
    color: colors.ink900,
    textAlign: "center",
  },
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
