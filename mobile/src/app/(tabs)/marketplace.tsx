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
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { coursePhoto } from "@/components/course-photos";
import { GearCard } from "@/components/gear-card";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { MarketplaceFilters } from "@/components/marketplace-filters";
import { useAuth } from "@/lib/auth";
import { CATEGORY_TILES } from "@/lib/listing-icons";
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

/**
 * The marketplace (Oct 2026 redesign, approved mock-ups 1 and 2).
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

  const [mode, setMode] = useState<Mode>("used");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<Set<Chip>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);

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

      const [page, f, c, fr] = await Promise.all([
        searchListings(effective, null, userId),
        browsing ? loadFeatured(userId) : Promise.resolve([]),
        browsing && me.clubId ? loadAtClubs([me.clubId], userId, 10) : Promise.resolve([]),
        browsing ? loadFresh(userId) : Promise.resolve([]),
      ]);
      const pageCards = chips.has("left") ? page.cards.filter((x) => x.dexterity === "Left-handed") : page.cards;
      const [grid, featuredD, clubD, freshD] = await Promise.all([decorateCards(pageCards, here), decorateCards(f, here), decorateCards(c, here), decorateCards(fr, here)]);
      if (mine !== token.current) return;
      setCards(grid);
      setCursor(page.cursor);
      setFeatured(featuredD);
      setAtClub(clubD);
      setFresh(freshD);
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

  const header = (
    <View>
      <ImageBackground source={mode === "new" ? require("../../../assets/images/scenes/dunes-gold.jpg") : require("../../../assets/images/scenes/links-sunset.jpg")} style={styles.hero}>
        <View style={styles.scrimTop} />
        <View style={styles.scrimBottom} />
        <View style={styles.eyebrowRow}>
          <View style={styles.rule} />
          <Text style={styles.eyebrow}>Marketplace</Text>
        </View>
        <Text style={styles.heroTitle}>{mode === "new" ? "New Gear" : "Used Gear"}</Text>
        <Text style={styles.heroSub}>{mode === "new" ? "From Irish pro shops & trusted retailers" : "Pre-loved clubs from golfers near you"}</Text>

        <View style={styles.switch} accessibilityRole="tablist">
          {(["new", "used"] as const).map((m) => (
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
              <Text style={[styles.switchText, mode === m && styles.switchTextOn]}>{m === "new" ? "New Gear" : "Used Gear"}</Text>
            </Pressable>
          ))}
        </View>

        {mode === "used" ? (
          <View style={styles.search}>
            <Ionicons name="search" size={17} color={colors.ink500} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search drivers, putters, bags…"
              placeholderTextColor={colors.ink500}
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <Pressable onPress={() => setFiltersOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={activeCount ? `Filters, ${activeCount} applied` : "Filters"}>
              <Text style={styles.filtersLink}>{activeCount ? `Filters · ${activeCount}` : "Filters"}</Text>
            </Pressable>
          </View>
        ) : null}
      </ImageBackground>

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
              <SectionHead title="Shop by category" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
                {CATEGORY_TILES.map((t) => (
                  <Pressable key={t.key} onPress={() => setFilters({ ...EMPTY_FILTERS, category: t.key })} style={styles.cat} accessibilityRole="button" accessibilityLabel={t.label}>
                    <View style={styles.catCircle}>
                      <MaterialCommunityIcons name={t.icon} size={26} color={colors.navy900} />
                    </View>
                    <Text style={styles.catLabel} numberOfLines={2}>
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

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
          {banner ? (
            <Pressable onPress={() => void openBanner(banner.id)} style={styles.bannerOuter} accessibilityRole="link" accessibilityLabel={`${banner.title}. Sponsored by ${banner.sponsor}`}>
              <View style={styles.banner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerEyebrow}>{(banner.eyebrow ?? "New season").toUpperCase()} · SPONSORED</Text>
                  <Text style={styles.bannerTitle}>{banner.title}</Text>
                  {banner.subtitle ? <Text style={styles.bannerSub}>{banner.subtitle}</Text> : null}
                </View>
                {banner.imageUrl ? <Image source={{ uri: banner.imageUrl }} style={styles.bannerImage} /> : <MaterialCommunityIcons name="golf" size={54} color={colors.gold400} />}
              </View>
            </Pressable>
          ) : null}

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
              <Text style={styles.applyBody}>Sell new stock to the golfers at your club. Click & collect, paid securely.</Text>
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

  hero: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md + 2, gap: 4 },
  scrimTop: { position: "absolute", left: 0, right: 0, top: 0, height: "100%", backgroundColor: "rgba(12,32,56,0.38)" },
  scrimBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", backgroundColor: "rgba(12,32,56,0.38)" },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rule: { width: 18, height: 2, backgroundColor: colors.gold400 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.8, textTransform: "uppercase", color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.cream50 },
  heroSub: { fontFamily: fonts.body, fontSize: 14, color: colors.cream100 },
  switch: { flexDirection: "row", marginTop: spacing.sm + 2, padding: 4, borderRadius: radii.pill, backgroundColor: "rgba(12,32,56,0.55)", borderWidth: 1, borderColor: "rgba(232,196,107,0.5)" },
  switchItem: { flex: 1, minHeight: 40, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
  switchOn: { backgroundColor: colors.gold400 },
  switchText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.cream50 },
  switchTextOn: { color: colors.navy900 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: spacing.sm + 2, height: 48, paddingHorizontal: 14, borderRadius: radii.lg, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  filtersLink: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.navy900 },

  chips: { gap: 8, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },

  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: 10 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.navy900 },
  seeAll: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  muted: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500, paddingHorizontal: spacing.md },

  cats: { gap: 12, paddingHorizontal: spacing.md },
  cat: { width: 70, alignItems: "center" },
  catCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  catLabel: { fontFamily: fonts.bodySemi, fontSize: 11.5, lineHeight: 14, color: colors.ink900, textAlign: "center", marginTop: 5 },

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
