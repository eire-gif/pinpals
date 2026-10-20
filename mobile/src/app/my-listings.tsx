import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import { ago } from "@/lib/feed-rules";
import {
  LISTING_STATUS_LABELS,
  LISTING_TABS,
  listMyListings,
  listingsInTab,
  priceLabel,
  type ListingTab,
  type MyListing,
} from "@/lib/listings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { TONES } from "@/components/live-scoring-card";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";

/** The Marketplace bar's colour, so My listings reads as part of it. */
const BAR = TONES.bronze.card;

/**
 * Everything you have for sale, and what state it is in.
 *
 * Read-only, on purpose. Publishing a draft needs the service-role client
 * and a check that the seller can actually take money — RLS forbids a seller
 * moving draft → active themselves — and editing reaches into auctions and
 * Storage. Both stay on the website, so a row opens the listing, which
 * carries "Manage this listing" through to it.
 *
 * Oct 2026 redesign: the name sits in the coloured top bar as on
 * Marketplace (no photo band), a short summary strip runs on from the bar,
 * the five status filters are one segmented control that fits the width
 * (Removed used to fall off the edge), and cards carry the category, a
 * clear price and how long the item has been up.
 *
 * Draft is the first tab because a draft is the only status waiting on the
 * seller: it is finished, it is just not for sale yet.
 */
function MyListingsScreenInner() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const focused = useIsFocused();

  const [listings, setListings] = useState<MyListing[]>([]);
  const [tab, setTab] = useState<ListingTab>("draft");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setListings(await listMyListings(userId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // Posting a listing happens on another screen and lands the member back
  // here; the new draft should be on it.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const visible = listingsInTab(listings, tab);

  const active = listings.filter((entry) => entry.status === "active");
  const soldCount = listingsInTab(listings, "sold").length;
  const askingTotal = active.reduce((sum, entry) => sum + (entry.priceEur ?? 0), 0);

  const subtitle =
    listings.length === 0
      ? "Nothing listed yet"
      : [
          active.length === 0 ? "None on sale" : `${active.length} on sale`,
          soldCount > 0 ? `${soldCount} sold` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: BAR },
          headerTintColor: colors.cream50,
          headerShadowVisible: false,
          headerBackTitle: "Back",
          headerBackButtonDisplayMode: "minimal",
          headerTitleAlign: "left",
          headerTitle: () => (
            <View accessibilityRole="header">
              <Text style={styles.barTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                My listings
              </Text>
              <Text style={styles.barSubtitle} numberOfLines={1}>
                {loading ? " " : subtitle}
              </Text>
            </View>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/new-listing")}
              hitSlop={8}
              style={({ pressed }) => [styles.sell, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel="List an item"
            >
              <Ionicons name="add" size={18} color={colors.navy900} />
              <Text style={styles.sellLabel}>Sell</Text>
            </Pressable>
          ),
        }}
      />
      {focused ? <StatusBar style="light" /> : null}

      {/* Runs on from the bar, so the name and the numbers read as one band. */}
      <View style={styles.band}>
        <Stat value={priceLabel(askingTotal) || "€0"} label="Asking total" />
        <Stat value={String(active.length)} label="On sale" />
        <Stat value={String(soldCount)} label="Sold" gold />
      </View>

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <View style={styles.fill}>
          {/* All five filters fit the width as one control — no sideways
              scroll, so "Removed" is never cut off at the edge. */}
          <View style={styles.segWrap}>
            <View style={styles.seg} accessibilityRole="tablist">
              {LISTING_TABS.map((entry) => {
                const count = listingsInTab(listings, entry.key).length;
                const on = tab === entry.key;
                return (
                  <Pressable
                    key={entry.key}
                    onPress={() => setTab(entry.key)}
                    style={[styles.segItem, on && styles.segItemOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${entry.label}, ${count}`}
                  >
                    <Text style={[styles.segCount, on && styles.segTextOn]}>{count}</Text>
                    <Text style={[styles.segLabel, on && styles.segTextOn]} numberOfLines={1}>
                      {entry.key === "draft" ? "Drafts" : entry.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <FlatList
            style={styles.fill}
            contentContainerStyle={styles.list}
            data={visible}
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
            ListHeaderComponent={
              tab === "draft" && visible.length > 0 ? (
                <Text style={styles.hint}>Only you can see drafts. Add photos and publish to go live.</Text>
              ) : null
            }
            ListEmptyComponent={<Empty tab={tab} anyAtAll={listings.length > 0} />}
            renderItem={({ item }) => <ListingCard item={item} />}
          />
        </View>
      )}
    </View>
  );
}

function Stat({ value, label, gold }: { value: string; label: string; gold?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, gold && { color: colors.gold400 }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function ListingCard({ item }: { item: MyListing }) {
  const isDraft = item.status === "draft" || item.status === "pending_review";
  // The native listing screen, which carries a "Manage this listing" button
  // through to the website — publishing and editing still live there.
  const open = () => router.push(`/listing/${item.id}`);
  // ago() gives "just now", "3h", "2d" or "14 Sep"; the short forms read
  // better with "ago" after them.
  const since = ago(item.createdAt);
  const when = `${isDraft ? "Started" : "Listed"} ${since}${/^\d+[mhd]$/.test(since) ? " ago" : ""}`;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      onPress={open}
    >
      <View style={styles.cardRow}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
        ) : isDraft ? (
          <View style={[styles.thumb, styles.thumbAdd]}>
            <Ionicons name="camera-outline" size={22} color="#8a6a22" />
            <Text style={styles.thumbAddLabel}>Add photos</Text>
          </View>
        ) : (
          <View style={[styles.thumb, styles.thumbNone]}>
            <Ionicons name="image-outline" size={22} color={colors.ink500} />
          </View>
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={styles.category} numberOfLines={1}>
              {item.category}
            </Text>
            <View style={[styles.status, STATUS_STYLE[item.status]]}>
              <Text style={[styles.statusLabel, STATUS_LABEL_STYLE[item.status]]}>
                {LISTING_STATUS_LABELS[item.status]}
              </Text>
            </View>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          {item.priceEur !== null ? <Text style={styles.price}>{priceLabel(item.priceEur)}</Text> : null}
          <Text style={styles.meta}>{when}</Text>
        </View>

        {isDraft ? null : <Ionicons name="chevron-forward" size={18} color={colors.ink500} />}
      </View>

      {isDraft ? (
        <Pressable
          onPress={open}
          style={({ pressed }) => [styles.finish, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`Finish listing ${item.title}`}
        >
          <Text style={styles.finishLabel}>Finish listing</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.cream50} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function Empty({ tab, anyAtAll }: { tab: ListingTab; anyAtAll: boolean }) {
  if (!anyAtAll) {
    return (
      <View style={styles.empty}>
        <Ionicons name="pricetags-outline" size={44} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Nothing listed yet</Text>
        <Text style={styles.emptyBody}>
          Photograph a club, price it, post it. It saves as a draft first, so
          nothing goes on sale until you say so.
        </Text>
        <Pressable
          style={styles.cta}
          onPress={() => router.push("/new-listing")}
          accessibilityRole="button"
        >
          <Text style={styles.ctaLabel}>List an item</Text>
        </Pressable>
      </View>
    );
  }

  const label = LISTING_TABS.find((entry) => entry.key === tab)?.label ?? tab;
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyBody}>Nothing {label.toLowerCase()}.</Text>
    </View>
  );
}

const STATUS_STYLE: Record<MyListing["status"], { backgroundColor: string }> = {
  draft: { backgroundColor: colors.cream100 },
  pending_review: { backgroundColor: colors.cream100 },
  active: { backgroundColor: colors.green100 },
  reserved: { backgroundColor: colors.gold400 },
  sold: { backgroundColor: colors.navy900 },
  removed: { backgroundColor: colors.red100 },
  expired: { backgroundColor: colors.red100 },
};

const STATUS_LABEL_STYLE: Record<MyListing["status"], { color: string }> = {
  draft: { color: colors.ink500 },
  pending_review: { color: colors.ink500 },
  active: { color: colors.green700 },
  reserved: { color: colors.ink900 },
  sold: { color: colors.cream50 },
  removed: { color: colors.red600 },
  expired: { color: colors.red600 },
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },

  // Bigger and plainer than other bars' Playfair titles — regular Public
  // Sans, as asked (Oct 2026).
  barTitle: { fontFamily: fonts.body, fontSize: 30, lineHeight: 34, letterSpacing: -0.3, color: colors.cream50 },
  barSubtitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.gold400,
  },
  sell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 36,
    paddingLeft: 10,
    paddingRight: 14,
    marginRight: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.gold500,
  },
  sellLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },

  band: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
    backgroundColor: BAR,
  },
  stat: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "rgba(247,243,234,0.14)",
    backgroundColor: "rgba(247,243,234,0.07)",
  },
  statValue: { fontFamily: fonts.display, fontSize: 19, color: colors.cream50 },
  statLabel: { fontFamily: fonts.body, fontSize: 11, color: "#d9cfbb", marginTop: 2 },

  segWrap: { paddingHorizontal: spacing.md, paddingTop: 14, paddingBottom: 4 },
  seg: {
    flexDirection: "row",
    gap: 2,
    padding: 4,
    borderRadius: radii.lg,
    backgroundColor: colors.cream100,
  },
  segItem: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  segItemOn: {
    backgroundColor: colors.surface,
    shadowColor: colors.navy900,
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segCount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink500 },
  segLabel: { fontFamily: fonts.bodySemi, fontSize: 10.5, color: colors.ink500 },
  segTextOn: { color: colors.navy900 },

  list: { padding: spacing.md, paddingTop: 10, gap: 12, flexGrow: 1 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginBottom: 2 },

  card: {
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    shadowColor: colors.navy900,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  thumb: { width: 84, height: 84, borderRadius: 14, backgroundColor: colors.surfaceTint },
  thumbNone: { alignItems: "center", justifyContent: "center" },
  thumbAdd: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#c9b68a",
  },
  thumbAddLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: "#8a6a22" },

  cardBody: { flex: 1, gap: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  category: {
    flexShrink: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#6b5a33",
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  price: { fontFamily: fonts.display, fontSize: 20, color: colors.navy900 },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },

  status: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radii.pill },
  statusLabel: { fontFamily: fonts.bodyBold, fontSize: 11 },

  finish: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.navy900,
  },
  finishLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.cream50 },

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
    color: colors.ink900,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
  cta: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});

/** Junior members (0159): selling aren't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function MyListingsScreen() {
  const gate = useAgeGate("sell");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="sell" title="Selling" />;
  return <MyListingsScreenInner />;
}
