import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AdBanner } from "@/components/ad-banner";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { coursePhoto } from "@/components/course-photos";
import { GearCard } from "@/components/gear-card";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { MarketplaceFilters } from "@/components/marketplace-filters";
import { useAuth } from "@/lib/auth";
import { CATEGORY_TILES } from "@/lib/listing-icons";
import { loadSmartBrands } from "@/lib/listing-posts";
import { CATEGORY_PHOTOS, CATEGORY_SHORT } from "@/lib/marketplace-smart";
import { parseSearch, type SmartSearch } from "@/lib/smart-search";
import { useAgeAccess } from "@/lib/age";
import { useCurrentLocation, type Coords } from "@/lib/location";
import { EMPTY_FILTERS, activeFilterCount, searchListings, setFavourite, type Card, type Cursor, type Filters } from "@/lib/marketplace";
import {
  loadAffiliates,
  loadBanner,
  loadShopListings,
  loadStores,
  openAffiliate,
  openBanner,
  type AffiliateProduct,
  type Banner,
  type Store,
} from "@/lib/new-gear";
import { loadMyProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { coursesNear } from "@/lib/courses";
import { decorateCards, kmLabel, loadAtClubs, loadFeatured, loadFresh, shortClub } from "@/lib/used-gear";
import { useCashMarketplace } from "@/lib/marketplace-cash";

/**
 * The marketplace's Browse tab (Oct 2026 redesign, approved mock-ups 1 and 2).
 * The marketplace has its own bottom menu — see ./_layout.tsx.
 *
 * New Gear | Used Gear at the top, over a photograph.
 *
 * USED GEAR — members' own clubs. Chips first: Near me, At my club, Under
 * €100, Left-handed. With nothing searched, the page is a shop window:
 * category circles, Featured (paid), "Collect at <your club>", Fresh today,
 * then everything. Searching or filtering turns it into one grid. Every card
 * says where it's collected and how far, because members meet at the club
 * (Buyer Protection, 0114).
 *
 * NEW GEAR — the sponsored launch banner, pro shops near you, shop stock,
 * and retailer deals (0115).
 *
 * The full search is still the SAME database function the website uses
 * (search_marketplace_listings), which lists used gear only since 0116.
 */

const RAIL_CARD = 158;
const NEAR_KM = 25;

type Mode = "used" | "new";
type Chip = "near" | "club" | "under100" | "left";

export default function MarketplaceScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const location = useCurrentLocation();
  const cash = useCashMarketplace();

  const [mode, setMode] = useState<Mode>("used");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<Set<Chip>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Smart search (mock-up 2): the search screen hands back the words; they're
  // read here into filters, so a search typed on Browse and one typed there
  // behave the same.
  const params = useLocalSearchParams<{ search?: string; at?: string }>();
  const [understood, setUnderstood] = useState<SmartSearch | null>(null);
  const [searchWords, setSearchWords] = useState("");
  const insets = useSafeAreaInsets();
  const { allows } = useAgeAccess();
  const canSell = allows("sell");

  useEffect(() => {
    const words = (params.search ?? "").trim();
    if (!words) return;
    let live = true;
    void loadSmartBrands().then((brands) => {
      if (!live) return;
      const s = parseSearch(words, brands);
      setMode("used");
      setSearchWords(words);
      setUnderstood(s);
      setFilters((prev) => ({
        ...EMPTY_FILTERS,
        sort: prev.sort,
        category: s.category,
        subcategory: s.subcategory,
        brands: [...s.brands].sort(),
        county: s.nearMe ? "" : s.county,
        condition: s.condition,
        minPriceCents: s.minPriceCents,
        maxPriceCents: s.maxPriceCents,
      }));
      setQuery(s.text);
      setChips(new Set<Chip>([...(s.nearMe ? (["near"] as Chip[]) : []), ...(s.leftHanded ? (["left"] as Chip[]) : [])]));
    });
    return () => {
      live = false;
    };
  }, [params.search, params.at]);

  function clearSearch() {
    setSearchWords("");
    setUnderstood(null);
    setQuery("");
    setFilters(EMPTY_FILTERS);
    setChips(new Set());
    router.setParams({ search: undefined, at: undefined });
  }

  // Where "near" is: the member's position if shared, else their club.
  const [me, setMe] = useState<{ clubId: number | null; clubName: string | null; at: Coords | null }>({ clubId: null, clubName: null, at: null });
  const here = location.state.status === "ready" ? location.state.coords : me.at;

  // Used gear
  const [cards, setCards] = useState<Card[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [featured, setFeatured] = useState<Card[]>([]);
  const [atClub, setAtClub] = useState<Card[]>([]);
  const [fresh, setFresh] = useState<Card[]>([]);
  // New gear
  const [banner, setBanner] = useState<Banner | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [shopItems, setShopItems] = useState<Card[]>([]);
  const [deals, setDeals] = useState<AffiliateProduct[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  useEffect(() => {
    if (!userId) return;
    void loadMyProfile(userId).then(async (p) => {
      if (!p?.homeClubId) return;
      const { data } = await supabase.from("clubs").select("name, latitude, longitude").eq("id", p.homeClubId).maybeSingle<{ name: string; latitude: number | null; longitude: number | null }>();
      setMe({
        clubId: p.homeClubId,
        clubName: data?.name ? shortClub(data.name) : p.homeClub,
        at: data?.latitude != null && data.longitude != null ? { lat: data.latitude, lng: data.longitude } : null,
      });
    });
  }, [userId]);

  const effective = useMemo<Filters>(
    () => ({ ...filters, q: query, maxPriceCents: chips.has("under100") ? Math.min(filters.maxPriceCents ?? 10000, 10000) : filters.maxPriceCents }),
    [filters, query, chips]
  );
  const browsing = query.trim() === "" && activeFilterCount(filters) === 0 && chips.size === 0;

  const load = useCallback(async () => {
    const mine = ++token.current;
    setError(null);
    try {
      if (mode === "new") {
        const [b, s, items, a] = await Promise.all([loadBanner("new_gear"), loadStores(here), loadShopListings(userId), loadAffiliates()]);
        if (mine !== token.current) return;
        setBanner(b);
        setStores(s);
        setShopItems(items);
        setDeals(a);
        return;
      }

      // "Near me" / "At my club": members' listings from those clubs.
      if (chips.has("near") || chips.has("club")) {
        let clubIds: number[] = [];
        if (chips.has("club") && me.clubId) clubIds = [me.clubId];
        if (chips.has("near")) {
          const at = here ?? (await location.request());
          if (at) clubIds = [...new Set([...clubIds, ...(await coursesNear(at.lat, at.lng, NEAR_KM, 200)).clubs.map((c) => c.id)])];
        }
        let list = await loadAtClubs(clubIds, userId, 60);
        if (chips.has("under100")) list = list.filter((c) => (c.priceCents ?? 0) <= 10000);
        if (chips.has("left")) list = list.filter((c) => c.dexterity === "Left-handed");
        list = await decorateCards(list, here);
        if (chips.has("near")) list.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
        if (mine !== token.current) return;
        setCards(list);
        setCursor(null);
        return;
      }

      const [page, f, c, fr, ub] = await Promise.all([
        searchListings(effective, null, userId),
        browsing ? loadFeatured(userId) : Promise.resolve([]),
        browsing && me.clubId ? loadAtClubs([me.clubId], userId, 10) : Promise.resolve([]),
        browsing ? loadFresh(userId) : Promise.resolve([]),
        browsing ? loadBanner("used_gear") : Promise.resolve(null),
      ]);
      const pageCards = chips.has("left") ? page.cards.filter((x) => x.dexterity === "Left-handed") : page.cards;
      const [grid, featuredD, clubD, freshD] = await Promise.all([decorateCards(pageCards, here), decorateCards(f, here), decorateCards(c, here), decorateCards(fr, here)]);
      if (mine !== token.current) return;
      setCards(grid);
      setCursor(page.cursor);
      setFeatured(featuredD);
      setAtClub(clubD);
      setFresh(freshD);
      setBanner(ub);
    } catch (err) {
      if (mine === token.current) setError(err instanceof Error ? err.message : "Couldn't load the marketplace.");
    } finally {
      if (mine === token.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // location.request is stable; `here` covers the position itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, effective, chips, browsing, userId, me.clubId, here]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function loadMore() {
    if (mode !== "used" || !cursor || loadingMore) return;
    setLoadingMore(true);
    const mine = token.current;
    try {
      const page = await searchListings(effective, cursor, userId);
      if (mine !== token.current) return;
      const more = await decorateCards(chips.has("left") ? page.cards.filter((x) => x.dexterity === "Left-handed") : page.cards, here);
      setCards((prev) => [...prev, ...more]);
      setCursor(page.cursor);
    } catch {
      // The list already shown is still good.
    } finally {
      setLoadingMore(false);
    }
  }

  async function favourite(card: Card) {
    if (!userId) return;
    const next = !card.isFavourited;
    const flip = (list: Card[]) => list.map((c) => (c.id === card.id ? { ...c, isFavourited: next } : c));
    setCards(flip);
    setFeatured(flip);
    setAtClub(flip);
    setFresh(flip);
    setShopItems(flip);
    await setFavourite(card.id, userId, next);
  }

  const toggleChip = (c: Chip) =>
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      if (c === "near" && next.has("near") && !here) void location.request();
      return next;
    });

  const open = (card: Card) => router.push(`/listing/${card.id}`);
  const activeCount = activeFilterCount(filters);

  // Sponsored banner (0115): New Gear's own, or Used Gear's while browsing.
  const bannerCard = banner ? (
            <Pressable onPress={() => void openBanner(banner.id)} style={styles.bannerOuter} accessibilityRole="link" accessibilityLabel={`${banner.title}. Sponsored by ${banner.sponsor}`}>
              <View style={styles.banner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerEyebrow}>{banner.eyebrow ? `${banner.eyebrow.toUpperCase()} · ` : ""}SPONSORED BY {banner.sponsor.toUpperCase()}</Text>
                  <Text style={styles.bannerTitle}>{banner.title}</Text>
                  {banner.subtitle ? <Text style={styles.bannerSub}>{banner.subtitle}</Text> : null}
                </View>
                {banner.imageUrl ? <Image source={{ uri: banner.imageUrl }} style={styles.bannerImage} /> : <MaterialCommunityIcons name="golf" size={54} color={colors.gold400} />}
              </View>
            </Pressable>
          ) : null;

  const header = (
    <View>
      <View style={[styles.head, { paddingTop: insets.top > 0 ? 6 : spacing.md }]}>
        <View style={styles.headTitleRow}>
          <Text style={styles.headTitle}>Marketplace</Text>
          <Text style={styles.headEyebrow}>Golfer to golfer</Text>
        </View>

        {mode === "used" ? (
          <View style={styles.searchRow}>
            <Pressable
              onPress={() => router.push("/marketplace-search")}
              style={styles.searchPill}
              accessibilityRole="search"
              accessibilityLabel={searchWords ? `Search: ${searchWords}. Tap to change.` : "Search the marketplace"}
            >
              <Ionicons name="search" size={19} color={colors.navy900} />
              <Text style={[styles.searchPillText, searchWords ? styles.searchPillTyped : null]} numberOfLines={1}>
                {searchWords || "Try “Qi10 driver under €300”"}
              </Text>
              {searchWords ? (
                <Pressable onPress={clearSearch} hitSlop={10} style={styles.searchClear} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Ionicons name="close" size={15} color={colors.navy900} />
                </Pressable>
              ) : null}
            </Pressable>
            <Pressable onPress={() => setFiltersOpen(true)} style={styles.filterButton} accessibilityRole="button" accessibilityLabel={activeCount ? `Filters, ${activeCount} applied` : "Filters"}>
              <Ionicons name="options-outline" size={21} color={colors.cream50} />
              {activeCount ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : null}

        <View style={styles.switch} accessibilityRole="tablist">
          {(["used", "new"] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                if (m === mode) return;
                setLoading(true);
                setMode(m);
              }}
              style={[styles.switchItem, mode === m && styles.switchOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
            >
              <Text style={[styles.switchText, mode === m && styles.switchTextOn]}>{m === "new" ? "New from shops" : "Used"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {mode === "used" && understood && (understood.chips.length > 0 || understood.corrections.length > 0) ? (
        <View style={styles.understood}>
          <Ionicons name="sparkles" size={14} color="#8a6a1f" />
          <Text style={styles.understoodText} numberOfLines={2}>
            {understood.chips.map((c) => c.value).join(" · ")}
            {understood.corrections.length ? `  (${understood.corrections.map((c) => `${c.from} → ${c.to}`).join(", ")})` : ""}
          </Text>
        </View>
      ) : null}

      {mode === "used" ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <ChipButton label={here ? `Near me · ${NEAR_KM} km` : "Near me"} on={chips.has("near")} onPress={() => toggleChip("near")} />
            {me.clubId ? <ChipButton label="At my club" on={chips.has("club")} onPress={() => toggleChip("club")} /> : null}
            <ChipButton label="Under €100" on={chips.has("under100")} onPress={() => toggleChip("under100")} />
            <ChipButton label="Left-handed" on={chips.has("left")} onPress={() => toggleChip("left")} />
          </ScrollView>

          {browsing ? (
            <>
              {bannerCard}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
                {CATEGORY_TILES.map((t) => (
                  <Pressable key={t.key} onPress={() => setFilters({ ...EMPTY_FILTERS, category: t.key })} style={styles.cat} accessibilityRole="button" accessibilityLabel={t.label}>
                    <View style={styles.catPhotoWrap}>
                      {CATEGORY_PHOTOS[t.key] ? (
                        <Image source={CATEGORY_PHOTOS[t.key]} style={styles.catPhoto} />
                      ) : (
                        <MaterialCommunityIcons name={t.icon} size={26} color={colors.navy900} />
                      )}
                    </View>
                    <Text style={styles.catLabel} numberOfLines={1}>
                      {CATEGORY_SHORT[t.key] ?? t.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {canSell ? (
                <Pressable onPress={() => router.push("/new-listing")} style={styles.sellCard} accessibilityRole="button" accessibilityLabel="Sell your old clubs. List in 60 seconds">
                  <ImageBackground source={require("../../../../assets/images/scenes/links-sunset.jpg")} style={styles.sellPhoto} imageStyle={{ borderRadius: 18 }}>
                    <View style={styles.sellScrim} />
                    <Text style={styles.sellTitle}>Your old clubs, someone&apos;s new favourites</Text>
                    <View style={styles.sellButton}>
                      <Text style={styles.sellButtonText}>List in 60 seconds</Text>
                    </View>
                  </ImageBackground>
                </Pressable>
              ) : null}

              <Rail title="Featured" cards={featured} onOpen={open} onFavourite={userId ? favourite : undefined} />
              <Rail title={me.clubName ? `Collect at ${me.clubName}` : "At your club"} cards={atClub} onOpen={open} onFavourite={userId ? favourite : undefined} onSeeAll={() => toggleChip("club")} />
              <Rail title="Fresh today" cards={fresh} onOpen={open} onFavourite={userId ? favourite : undefined} />
              <SectionHead title="All used gear" />
            </>
          ) : (
            <SectionHead title={chips.has("near") ? `Within ${NEAR_KM} km` : chips.has("club") ? `Collect at ${me.clubName ?? "your club"}` : "Results"} />
          )}
        </>
      ) : (
        <>
          {bannerCard}

          <SectionHead title="Pro shops near you" />
          {stores.length === 0 ? (
            <Text style={styles.muted}>No pro shops on PinPals yet — yours could be the first.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
              {stores.map((s) => (
                <Pressable key={s.id} onPress={() => router.push({ pathname: "/store/[id]", params: { id: s.slug } })} style={styles.store} accessibilityRole="button" accessibilityLabel={s.name}>
                  <Image source={s.coverUrl ? { uri: s.coverUrl } : coursePhoto(s.clubId, s.clubName)} style={styles.storeCover} />
                  <View style={styles.storeBody}>
                    <Text style={styles.storeName} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.storeMeta} numberOfLines={1}>
                      {[s.clubName ? shortClub(s.clubName) : null, kmLabel(s.distanceKm)].filter(Boolean).join(" · ")}
                    </Text>
                    <Text style={styles.storeGold}>{s.offersFittings ? "Click & collect · Fittings" : "Click & collect"}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <SectionHead title="From the pro shops" />
        </>
      )}
    </View>
  );

  const footer =
    mode === "new" ? (
      <View style={{ paddingBottom: spacing.xl }}>
        {deals.length > 0 ? (
          <>
            <SectionHead title="Top deals from retailers" />
            <View style={styles.dealGrid}>
              {deals.map((d) => (
                <Pressable key={d.id} onPress={() => void openAffiliate(d.id)} style={styles.deal} accessibilityRole="link" accessibilityLabel={`${d.title} at ${d.retailer}`}>
                  <View style={styles.dealPhoto}>
                    {d.imageUrl ? <Image source={{ uri: d.imageUrl }} style={styles.dealImage} resizeMode="contain" /> : <MaterialCommunityIcons name="shopping-outline" size={40} color={colors.ink500} />}
                    {d.wasPriceEur && d.priceEur && d.wasPriceEur > d.priceEur ? (
                      <View style={styles.sale}>
                        <Text style={styles.saleText}>−{Math.round((1 - d.priceEur / d.wasPriceEur) * 100)}%</Text>
                      </View>
                    ) : null}
                  </View>
                  {d.priceEur != null ? <Text style={styles.dealPrice}>€{d.priceEur.toFixed(2).replace(/\.00$/, "")}</Text> : null}
                  <Text style={styles.dealTitle} numberOfLines={2}>
                    {d.title}
                  </Text>
                  <Text style={styles.dealMeta} numberOfLines={1}>
                    {d.retailer} ↗
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        <Pressable onPress={() => router.push({ pathname: "/web", params: { path: "/shops/apply", title: "Your pro shop on PinPals" } })} style={styles.applyOuter} accessibilityRole="button">
          <View style={styles.apply}>
            <Ionicons name="storefront-outline" size={22} color={colors.gold400} />
            <View style={{ flex: 1 }}>
              <Text style={styles.applyTitle}>Run a pro shop?</Text>
              <Text style={styles.applyBody}>
                {cash
                  ? "Show your stock to the golfers near you. Free to join — buyers call, message or visit you."
                  : "Sell new stock to the golfers at your club. Click & collect, paid securely."}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.gold400} />
          </View>
        </Pressable>
      </View>
    ) : loadingMore ? (
      <ActivityIndicator color={colors.green700} style={{ paddingVertical: spacing.md }} />
    ) : (
      <View style={{ height: spacing.xl }} />
    );

  const data = mode === "new" ? shopItems : cards;

  return (
    <View style={styles.fill}>
      <FlatList
        keyboardDismissMode={KEYBOARD_DISMISS_MODE}
        keyboardShouldPersistTaps="handled"
        data={loading ? [] : data}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
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
          loading ? (
            <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name={error ? "cloud-offline-outline" : "pricetags-outline"} size={40} color={colors.ink500} />
              <Text style={styles.emptyTitle}>
                {error ? "Couldn't load the marketplace" : mode === "new" ? "No shop stock yet" : browsing ? "Nothing for sale yet" : "Nothing matched"}
              </Text>
              <Text style={styles.emptyBody}>
                {error ? "Pull down to try again." : mode === "new" ? "Pro shops are joining — check the retailer deals below." : browsing ? "When members list their old clubs, they'll show up here." : "Try fewer filters, or a shorter search."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <GearCard card={item} onPress={() => open(item)} onFavourite={userId ? () => void favourite(item) : undefined} />}
      />

      {/* Slide-up advert (0139), above the tab bar: nothing unless advertising is on. */}
      <AdBanner screen="marketplace" />

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

function SectionHead({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={8} accessibilityRole="button">
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Rail({ title, cards, onOpen, onFavourite, onSeeAll }: { title: string; cards: Card[]; onOpen: (c: Card) => void; onFavourite?: (c: Card) => void; onSeeAll?: () => void }) {
  if (cards.length === 0) return null;
  return (
    <View>
      <SectionHead title={title} onSeeAll={onSeeAll} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {cards.map((c) => (
          <GearCard key={c.id} card={c} width={RAIL_CARD} onPress={() => onOpen(c)} onFavourite={onFavourite ? () => onFavourite(c) : undefined} />
        ))}
      </ScrollView>
    </View>
  );
}

function ChipButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const LIP = "#9c7a2c";

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  list: { paddingBottom: spacing.lg, gap: spacing.md },
  column: { gap: 12, paddingHorizontal: spacing.md },

  head: { backgroundColor: colors.navy900, paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: 12 },
  headTitleRow: { alignItems: "center", gap: 2 },
  headTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50 },
  headEyebrow: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.6, textTransform: "uppercase", color: colors.gold400 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchPill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: 50, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.cream50 },
  searchPillText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink500 },
  searchPillTyped: { fontFamily: fonts.bodySemi, color: colors.ink900 },
  searchClear: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  filterButton: { width: 50, height: 50, borderRadius: 14, borderWidth: 1, borderColor: "rgba(247,243,234,0.3)", alignItems: "center", justifyContent: "center" },
  filterBadge: { position: "absolute", top: 6, right: 6, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  filterBadgeText: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.navy900 },
  switch: { flexDirection: "row", padding: 4, borderRadius: radii.pill, backgroundColor: "rgba(247,243,234,0.1)" },
  switchItem: { flex: 1, minHeight: 38, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
  switchOn: { backgroundColor: colors.gold500 },
  switchText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.cream50 },
  switchTextOn: { fontFamily: fonts.bodyBold, color: colors.navy900 },
  understood: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.md, marginTop: spacing.md, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  understoodText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green800 },

  sellCard: { marginHorizontal: spacing.md, marginTop: spacing.lg, borderRadius: 18, overflow: "hidden", backgroundColor: colors.navy900 },
  sellPhoto: { height: 150, justifyContent: "center", paddingHorizontal: 20, gap: 12 },
  sellScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 18, backgroundColor: "rgba(12,32,56,0.62)" },
  sellTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: colors.cream50, maxWidth: 240 },
  sellButton: { alignSelf: "flex-start", backgroundColor: colors.gold500, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9 },
  sellButtonText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },

  chips: { gap: 8, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },

  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: 10 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.navy900 },
  seeAll: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500, paddingHorizontal: spacing.md },

  cats: { gap: 10, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 4 },
  cat: { width: 86, gap: 6 },
  catPhotoWrap: { width: 86, height: 86, borderRadius: 18, overflow: "hidden", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", shadowColor: colors.navy900, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  catPhoto: { width: 86, height: 86 },
  catLabel: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.ink900, textAlign: "center" },

  rail: { gap: 12, paddingHorizontal: spacing.md },

  bannerOuter: { marginHorizontal: spacing.md, marginTop: spacing.md, borderRadius: 20, backgroundColor: LIP, paddingBottom: 3, shadowColor: colors.navy900, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 5 } },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 20, borderWidth: 1.5, borderColor: colors.gold500, backgroundColor: colors.navy900, padding: spacing.md },
  bannerEyebrow: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.4, color: colors.gold400 },
  bannerTitle: { fontFamily: fonts.display, fontSize: 21, lineHeight: 25, color: colors.cream50, marginTop: 3 },
  bannerSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.cream100, marginTop: 3 },
  bannerImage: { width: 86, height: 86, borderRadius: radii.md },

  store: { width: 250, borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.navy900, borderWidth: 1, borderColor: colors.gold500 },
  storeCover: { width: "100%", height: 84 },
  storeBody: { padding: 12, gap: 1 },
  storeName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  storeMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.cream100 },
  storeGold: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.gold400, marginTop: 4 },

  dealGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: spacing.md },
  deal: { width: "47%", flexGrow: 1 },
  dealPhoto: { aspectRatio: 1, borderRadius: radii.lg, backgroundColor: "#eef0ee", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  dealImage: { width: "86%", height: "86%" },
  sale: { position: "absolute", top: 8, left: 8, backgroundColor: colors.red600, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
  saleText: { fontFamily: fonts.bodyBold, fontSize: 11, color: "#fff" },
  dealPrice: { fontSize: 18, fontWeight: "800", color: colors.navy900, marginTop: 7 },
  dealTitle: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 18, color: colors.ink900 },
  dealMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 2 },

  applyOuter: { marginHorizontal: spacing.md, marginTop: spacing.lg, borderRadius: 20, backgroundColor: LIP, paddingBottom: 3 },
  apply: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, borderWidth: 1.5, borderColor: colors.gold500, backgroundColor: colors.navy900, padding: spacing.md },
  applyTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  applyBody: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.cream100, marginTop: 2 },

  empty: { alignItems: "center", gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
