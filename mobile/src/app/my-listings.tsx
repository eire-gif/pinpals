import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
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

/**
 * Everything you have for sale, and what state it is in.
 *
 * Read-only, on purpose. Publishing a draft needs the service-role client
 * and a check that the seller can actually take money — RLS forbids a seller
 * moving draft → active themselves — and editing reaches into auctions and
 * Storage. Both stay on the website, so a row opens there. What the app adds
 * is the answer to "where are my listings up to", which until now needed a
 * laptop.
 *
 * Draft is the first tab because a draft is the only status waiting on the
 * seller: it is finished, it is just not for sale yet.
 */
export default function MyListingsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

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

  // What is earning, rather than what exists. Drafts and sold items both sit
  // in this list and neither is a thing a seller is waiting on.
  const onSale = listings.filter((entry) => entry.status === "active").length;
  const subtitle =
    listings.length === 0
      ? "Nothing listed yet"
      : onSale === 0
        ? "None on sale right now"
        : onSale === 1
          ? "1 on sale"
          : `${onSale} on sale`;

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          // The band below carries the name; printing it here too just
          // says it twice.
          headerTitle: "",
          headerBackTitle: "Back",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/new-listing")}
              hitSlop={12}
              style={{ paddingHorizontal: spacing.md }}
              accessibilityLabel="List an item"
            >
              <Ionicons name="add-circle" size={26} color={colors.green700} />
            </Pressable>
          ),
        }}
      />

      {/* Outside the loading branch on purpose: the screen's name is known
          before the query comes back, and a screen that shows its own title
          while it loads reads as working rather than as stuck. */}
      <ScreenHeader scene="lakeSunset" title="My listings" subtitle={subtitle} />

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <View style={styles.fill}>
          {/* styles.tabStrip is load-bearing. A horizontal ScrollView is a
              flex child like any other, so next to the list it was splitting
              the screen with it and growing to about a third of the height —
              and because a content container defaults to alignItems:
              "stretch", every pill stretched to fill that, which is how five
              status filters came to be rendered as enormous ovals. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabStrip}
            contentContainerStyle={styles.tabs}
          >
            {LISTING_TABS.map((entry) => {
              const count = listingsInTab(listings, entry.key).length;
              const active = tab === entry.key;
              return (
                <Pressable
                  key={entry.key}
                  onPress={() => setTab(entry.key)}
                  style={[styles.tab, active && styles.tabOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.tabLabel, active && styles.tabLabelOn]}>
                    {entry.label}
                    {count > 0 ? ` ${count}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

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
            ListEmptyComponent={<Empty tab={tab} anyAtAll={listings.length > 0} />}
            renderItem={({ item }) => (
              <Pressable
                style={styles.card}
                accessibilityRole="button"
                // The native listing screen, which carries a "Manage this
                // listing" button through to the website for the seller —
                // publishing and editing still live there.
                onPress={() => router.push(`/listing/${item.id}`)}
              >
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbNone]}>
                    <Ionicons name="image-outline" size={22} color={colors.ink500} />
                  </View>
                )}

                <View style={styles.cardBody}>
                  <Text style={styles.title} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[priceLabel(item.priceEur), item.category].filter(Boolean).join(" · ")}
                  </Text>
                  <View style={[styles.status, STATUS_STYLE[item.status]]}>
                    <Text style={[styles.statusLabel, STATUS_LABEL_STYLE[item.status]]}>
                      {LISTING_STATUS_LABELS[item.status]}
                    </Text>
                  </View>
                </View>

                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              </Pressable>
            )}
          />
        </View>
      )}
    </View>
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
  draft: { backgroundColor: colors.surfaceTint },
  pending_review: { backgroundColor: colors.surfaceTint },
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

  // flexGrow 0 so the strip is only as tall as a pill, and alignItems so the
  // pills size to their own text rather than to the strip.
  tabStrip: { flexGrow: 0, flexShrink: 0 },
  tabs: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: 6,
  },
  tab: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  tabOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  tabLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  tabLabelOn: { color: colors.cream50 },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  thumb: {
    width: 62,
    height: 62,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceTint,
  },
  thumbNone: { alignItems: "center", justifyContent: "center" },

  cardBody: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  status: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  statusLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5 },

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
