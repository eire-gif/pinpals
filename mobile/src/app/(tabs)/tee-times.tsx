import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { router as appRouter, useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";

import { TeeTimeCard } from "@/components/tee-time-card";
import { useCollapsingHeader } from "@/components/screen-header";
import { useCurrentLocation } from "@/lib/location";
import {
  DEFAULT_TEE_TIME_FILTERS,
  activeTeeTimeFilterCount,
  applyTeeTimeFilters,
  type TeeTimeFilters,
} from "@/lib/tee-time-filters";
import {
  confirmedPlayersFor,
  listInvites,
  listInvitesNear,
  type CardPlayer,
  type Invite,
} from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

type Scope = "all" | "near";

const RADIUS_KM = 50;

/** iOS navigation bar height; the bar is transparent over the photograph
 *  on this tab (see (tabs)/_layout.tsx). */
const NAV_BAR = 44;
/** Room under the title for the control bar to overlap the photograph. */
const OVERLAP = 28;
const TITLE_BLOCK = 92;
const TITLE_ONLY = 56;

const HERO = require("../../../assets/images/tee-times/hero.jpg");

/**
 * Tee times — redesigned October 2026.
 *
 * A full-bleed photograph behind the status bar and the menu, the title on
 * it, and a white control bar (All / Near me / Filters) that overlaps its
 * bottom edge. The photograph shrinks to a title strip as the list scrolls,
 * as the other tabs' headers do, and opens again at the top.
 *
 * Cards: TeeTimeCard. The faces on each card are the members already
 * confirmed — one query for the whole list (confirmedPlayersFor), so a page
 * of rounds is still two round trips, not one per card.
 *
 * Filters are applied to the rounds already loaded; the list is at most a
 * page of upcoming rounds, and filtering it here means toggling one is
 * instant rather than another trip to the server.
 */
export default function TeeTimesScreen() {
  const { scrollY, resetY, scrollProps } = useCollapsingHeader();
  const router = useRouter();
  const location = useCurrentLocation();
  const insets = useSafeAreaInsets();

  const [scope, setScope] = useState<Scope>("all");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [players, setPlayers] = useState<Map<number, CardPlayer[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TeeTimeFilters>(DEFAULT_TEE_TIME_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (loading) resetY.setValue(0);
  }, [loading, resetY]);

  const load = useCallback(
    async (next: Scope) => {
      setError(null);
      try {
        let rows: Invite[];
        if (next === "near") {
          const coords = location.state.status === "ready" ? location.state.coords : await location.request();
          rows = coords ? await listInvitesNear(coords.lat, coords.lng, RADIUS_KM) : [];
        } else {
          rows = await listInvites();
        }
        setInvites(rows);
        // Faces are a nicety: a failure leaves the cards without them.
        try {
          setPlayers(await confirmedPlayersFor(rows.map((r) => r.id)));
        } catch {
          setPlayers(new Map());
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
    // Keyed on scope alone: `load` changes identity with the location hook's
    // state, which would re-fetch on every permission transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Fresh every time the tab comes back into view, and a light status bar
  // only while this tab — the one with a photograph behind it — is showing.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load(scope);
      return () => setFocused(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope])
  );

  const switchTo = (next: Scope) => {
    if (next === scope) return;
    setLoading(true);
    setScope(next);
  };

  const shown = useMemo(() => applyTeeTimeFilters(invites, filters), [invites, filters]);
  const filterCount = activeTeeTimeFilterCount(filters);

  const subtitle = loading
    ? "Looking for rounds"
    : shown.length === 0
      ? filterCount > 0
        ? "Nothing matches your filters"
        : scope === "near"
          ? "Nothing within reach today"
          : "No rounds posted yet"
      : shown.length === 1
        ? "1 round looking for players"
        : `${shown.length} rounds looking for players`;

  // ---- the photograph, shrinking with the list ----
  const top = insets.top + NAV_BAR;
  const expanded = top + TITLE_BLOCK + OVERLAP;
  const collapsed = top + TITLE_ONLY + OVERLAP;
  const travel = expanded - collapsed;
  const height = scrollY
    ? scrollY.interpolate({ inputRange: [0, travel], outputRange: [expanded, collapsed], extrapolate: "clamp" })
    : expanded;
  const fade = scrollY
    ? scrollY.interpolate({ inputRange: [0, travel * 0.6], outputRange: [1, 0], extrapolate: "clamp" })
    : 1;
  const drop = scrollY
    ? scrollY.interpolate({ inputRange: [0, travel], outputRange: [0, 30], extrapolate: "clamp" })
    : 0;

  return (
    <View style={styles.fill}>
      {focused ? <StatusBar style="light" /> : null}

      <Animated.View style={[styles.hero, { height }]}>
        <Image source={HERO} style={[styles.heroImage, { height: expanded + 40 }]} />
        <Animated.View style={[styles.heroText, { paddingBottom: OVERLAP + 14, transform: [{ translateY: drop }] }]}>
          <Text style={styles.heroTitle} accessibilityRole="header">
            Tee times
          </Text>
          <Animated.Text style={[styles.heroSub, { opacity: fade }]} numberOfLines={1}>
            {subtitle}
          </Animated.Text>
        </Animated.View>
      </Animated.View>

      <View style={styles.controls}>
        <Segment label="All tee times" icon="golf-outline" active={scope === "all"} onPress={() => switchTo("all")} />
        <Segment label="Near me" icon="navigate-outline" active={scope === "near"} onPress={() => switchTo("near")} />
        <View style={{ flex: 1, minWidth: 0 }} />
        <Pressable
          style={[styles.filterButton, filterCount > 0 && styles.filterButtonOn]}
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} on` : "Filters"}
        >
          <Ionicons name="options-outline" size={17} color={filterCount > 0 ? colors.cream50 : colors.ink900} />
          <Text style={[styles.filterLabel, filterCount > 0 && styles.filterLabelOn]}>
            {filterCount > 0 ? `Filters · ${filterCount}` : "Filters"}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      ) : (
        <FlatList
          {...scrollProps}
          style={styles.fill}
          contentContainerStyle={styles.list}
          data={shown}
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
              <Text style={styles.radiusNote}>Within {RADIUS_KM} km of you</Text>
            ) : null
          }
          ListEmptyComponent={
            filterCount > 0 && invites.length > 0 ? (
              <Empty
                icon="options-outline"
                title="Nothing matches your filters"
                body={`${invites.length} ${invites.length === 1 ? "round is" : "rounds are"} hidden by them.`}
                action={{ label: "Clear filters", onPress: () => setFilters(DEFAULT_TEE_TIME_FILTERS) }}
              />
            ) : (
              <EmptyState
                scope={scope}
                error={error}
                locationStatus={location.state.status}
                onRetryLocation={() => void load("near")}
              />
            )
          }
          renderItem={({ item }) => (
            <TeeTimeCard
              invite={item}
              players={players.get(item.id) ?? []}
              onPress={() => router.push(`/invite/${item.id}`)}
            />
          )}
        />
      )}

      <FilterSheet
        visible={filtersOpen}
        value={filters}
        rounds={invites}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
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
  icon: keyof typeof Ionicons.glyphMap;
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
      <Ionicons name={icon} size={15} color={active ? colors.cream50 : colors.ink500} />
      <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const WHEN_OPTIONS: { value: TeeTimeFilters["when"]; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "week", label: "This week" },
  { value: "weekend", label: "This weekend" },
];

const SPACES_OPTIONS: { value: TeeTimeFilters["minSpaces"]; label: string }[] = [
  { value: 1, label: "Any" },
  { value: 2, label: "2 or more" },
  { value: 3, label: "3" },
];

function FilterSheet({
  visible,
  value,
  rounds,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: TeeTimeFilters;
  rounds: Invite[];
  onApply: (next: TeeTimeFilters) => void;
  onClose: () => void;
}) {
  // A draft, applied on the button — the same as the marketplace's sheet.
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close filters" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <Pressable onPress={() => setDraft(DEFAULT_TEE_TIME_FILTERS)} accessibilityRole="button">
              <Text style={styles.reset}>Reset</Text>
            </Pressable>
          </View>

          <Text style={styles.sheetLabel}>When</Text>
          <View style={styles.chips}>
            {WHEN_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} on={draft.when === o.value} onPress={() => setDraft({ ...draft, when: o.value })} />
            ))}
          </View>

          <Text style={styles.sheetLabel}>Spaces left</Text>
          <View style={styles.chips}>
            {SPACES_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                on={draft.minSpaces === o.value}
                onPress={() => setDraft({ ...draft, minSpaces: o.value })}
              />
            ))}
          </View>

          <ToggleRow
            label="Tee time already booked"
            value={draft.bookedOnly}
            onChange={(v) => setDraft({ ...draft, bookedOnly: v })}
          />
          <ToggleRow label="Ladies only" value={draft.ladiesOnly} onChange={(v) => setDraft({ ...draft, ladiesOnly: v })} />

          <Pressable style={styles.apply} onPress={() => onApply(draft)} accessibilityRole="button">
            <Text style={styles.applyLabel}>
              {(() => {
                const n = applyTeeTimeFilters(rounds, draft).length;
                return n === 0 ? "No rounds match" : n === 1 ? "Show 1 round" : `Show ${n} rounds`;
              })()}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.green600, false: colors.line }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

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
    return <Empty icon="cloud-offline-outline" title={error} body="Pull down to try again." />;
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
      title={scope === "near" ? `Nothing within ${RADIUS_KM} km` : "No tee times going just now"}
      body={
        scope === "near"
          ? "Try All tee times — someone might be playing further afield."
          : "Post one of your own and your connections will hear about it."
      }
      action={{ label: "Post a tee time", onPress: () => appRouter.push("/post-tee-time") }}
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

  hero: { width: "100%", overflow: "hidden", justifyContent: "flex-end", backgroundColor: colors.navy900 },
  heroImage: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%" },
  heroText: { paddingHorizontal: spacing.lg },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 38,
    lineHeight: 44,
    color: "#ffffff",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  heroSub: {
    fontFamily: fonts.body,
    fontSize: 17,
    color: "rgba(255,255,255,0.95)",
    marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -OVERLAP,
    marginHorizontal: 12,
    padding: 7,
    borderRadius: 30,
    backgroundColor: colors.surface,
    shadowColor: "#0c2038",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  segmentActive: { backgroundColor: colors.green700, borderColor: colors.green700 },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink500 },
  segmentTextActive: { color: colors.cream50 },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  filterButtonOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  filterLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  filterLabelOn: { color: colors.cream50 },

  list: { padding: spacing.md, paddingTop: spacing.md, gap: spacing.md, flexGrow: 1 },
  radiusNote: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginBottom: 2 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center" },
  primary: {
    marginTop: spacing.md,
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  primaryLabel: { fontFamily: fonts.bodyBold, color: colors.cream50, fontSize: type.body },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(12,32,56,0.45)" },
  sheet: {
    backgroundColor: colors.cream50,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    gap: spacing.sm,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 4 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  reset: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  sheetLabel: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.ink900, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.green700, backgroundColor: colors.green100 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  chipTextOn: { color: colors.green800 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  toggleLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  apply: {
    marginTop: spacing.md,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  applyLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
