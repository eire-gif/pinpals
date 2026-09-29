import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { MarketplaceFilters } from "@/components/marketplace-filters";
import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  isAuction,
  priceLine,
  searchListings,
  setFavourite,
  type Card,
  type Cursor,
  type Filters,
} from "@/lib/marketplace";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The marketplace, native.
 *
 * It was a web view, and for a long time that was the right call: it is the
 * largest surface, it changes most often, and buying runs through Stripe
 * Checkout, which has to be a browser. What it cost was that the thing
 * members spend most of their time doing — scrolling and filtering — felt
 * like a website with an app around it.
 *
 * So browsing is native and the money is not. Buy, offer and bid still open
 * the site, from the listing screen, signed in.
 *
 * The search runs the SAME database function the website's does
 * (search_marketplace_listings, 0060) rather than a second implementation of
 * the filters. Two search behaviours that drift apart is how a member finds
 * something on their laptop that the app swears does not exist.
 */
export default function MarketplaceScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // A slow first page must never land on top of a fast second one. Same guard
  // as the courses screen.
  const token = useRef(0);

  const load = useCallback(async () => {
    const mine = ++token.current;
    setError(null);
    try {
      const page = await searchListings({ ...filters, q: query }, null, userId);
      if (mine !== token.current) return;
      setCards(page.cards);
      setCursor(page.cursor);
    } catch (err) {
      if (mine === token.current) {
        setError(err instanceof Error ? err.message : "Couldn't load the marketplace.");
      }
    } finally {
      if (mine === token.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filters, query, userId]);

  // Debounced while typing, immediate when a filter changes.
  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  // Coming back from a listing should show a favourite toggled there.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const mine = token.current;
    try {
      const page = await searchListings({ ...filters, q: query }, cursor, userId);
      // A filter changed while this was in flight — the page belongs to a
      // search nobody is looking at any more.
      if (mine !== token.current) return;
      setCards((prev) => [...prev, ...page.cards]);
      setCursor(page.cursor);
    } catch {
      // Silent: the list a member already has is still good, and an error
      // banner for a page they did not ask for is noise.
    } finally {
      setLoadingMore(false);
    }
  }

  async function favourite(card: Card) {
    if (!userId) return;
    const next = !card.isFavourited;
    // Optimistic. A heart that waits for a round trip feels broken, and the
    // worst case is a heart that flips back on the next refresh.
    setCards((prev) =>
      prev.map((entry) => (entry.id === card.id ? { ...entry, isFavourited: next } : entry))
    );
    await setFavourite(card.id, userId, next);
  }

  const activeCount = activeFilterCount(filters);

  return (
    <View style={styles.fill}>
      {/* Parkland rather than another links photograph: this tab is the one
          part of the app that is not about a round, and it should not look
          like the tee times tab at a glance. */}
      <ScreenHeader
        scene="parkland"
        title="Marketplace"
        subtitle="Clubs and kit from other members"
      />

      <View style={styles.controls}>
        <View style={styles.search}>
          <Ionicons name="search" size={17} color={colors.ink500} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Driver, putter, Titleist…"
            placeholderTextColor={colors.ink500}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <Pressable
          style={[styles.filterButton, activeCount > 0 && styles.filterButtonOn]}
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            activeCount > 0 ? `Filters, ${activeCount} applied` : "Filters"
          }
        >
          <Ionicons
            name="options-outline"
            size={19}
            color={activeCount > 0 ? colors.cream50 : colors.green700}
          />
          {activeCount > 0 && <Text style={styles.filterCount}>{activeCount}</Text>}
        </Pressable>
      </View>

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => String(item.id)}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.grid}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
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
            <Empty error={error} filtered={activeCount > 0 || query.trim() !== ""} />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.green700} style={styles.more} />
            ) : null
          }
          renderItem={({ item }) => (
            <ListingCard
              card={item}
              onPress={() => router.push(`/listing/${item.id}`)}
              onFavourite={() => void favourite(item)}
              canFavourite={Boolean(userId)}
            />
          )}
        />
      )}

      <MarketplaceFilters
        open={filtersOpen}
        filters={filters}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
      />
    </View>
  );
}

function ListingCard({
  card,
  onPress,
  onFavourite,
  canFavourite,
}: {
  card: Card;
  onPress: () => void;
  onFavourite: () => void;
  canFavourite: boolean;
}) {
  const price = priceLine(card);

  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View style={styles.thumbWrap}>
        {card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbNone]}>
            <Ionicons name="image-outline" size={24} color={colors.ink500} />
          </View>
        )}

        {isAuction(card.saleType) && (
          <View style={styles.auctionTag}>
            <Text style={styles.auctionTagLabel}>Auction</Text>
          </View>
        )}

        {canFavourite && (
          <Pressable
            style={styles.heart}
            onPress={onFavourite}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={card.isFavourited ? "Remove from saved" : "Save this listing"}
          >
            <Ionicons
              name={card.isFavourited ? "heart" : "heart-outline"}
              size={17}
              color={card.isFavourited ? colors.red600 : colors.ink900}
            />
          </Pressable>
        )}
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {card.title}
        </Text>
        {price.label ? <Text style={styles.priceLabel}>{price.label}</Text> : null}
        <Text style={styles.price}>{price.value || "—"}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[card.condition, card.county].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </Pressable>
  );
}

function Empty({ error, filtered }: { error: string | null; filtered: boolean }) {
  return (
    <View style={styles.empty}>
      <Ionicons
        name={error ? "cloud-offline-outline" : "pricetags-outline"}
        size={44}
        color={colors.ink500}
      />
      <Text style={styles.emptyTitle}>
        {error ? "Couldn't load the marketplace" : filtered ? "Nothing matched" : "Nothing for sale yet"}
      </Text>
      <Text style={styles.emptyBody}>
        {error
          ? "Pull down to try again."
          : filtered
            ? "Try fewer filters, or a shorter search."
            : "When members list their old clubs, they'll show up here."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },

  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.green600,
    backgroundColor: colors.surface,
  },
  filterButtonOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  filterCount: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },

  grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  column: { gap: spacing.sm },

  card: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  thumbWrap: { width: "100%", aspectRatio: 1, backgroundColor: colors.surfaceTint },
  thumb: { width: "100%", height: "100%" },
  thumbNone: { alignItems: "center", justifyContent: "center" },

  // Gold with ink on it, never white — the palette note in theme.ts.
  auctionTag: {
    position: "absolute",
    top: 7,
    left: 7,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold400,
  },
  auctionTagLabel: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.ink900 },

  heart: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.88)",
  },

  cardBody: { padding: 10, gap: 2 },
  cardTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: type.small,
    lineHeight: 18,
    color: colors.ink900,
  },
  priceLabel: { fontFamily: fonts.body, fontSize: 10.5, color: colors.ink500 },
  price: { fontFamily: fonts.display, fontSize: 18, color: colors.green700 },
  meta: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },

  more: { paddingVertical: spacing.md },

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
});
