import { useEffect, useState, type ReactNode } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { TileGrid } from "@/components/form-bits";
import { CATEGORY_TILES } from "@/lib/listing-icons";

import {
  CATEGORIES,
  CONDITIONS,
  DELIVERY_OPTIONS,
  brandsFor,
  type Brand,
} from "@/lib/listings";
import {
  FILTER_SALE_TYPES,
  MARKETPLACE_SORTS,
  MARKETPLACE_SORT_LABELS,
  activeFilterCount,
  type Filters,
} from "@/lib/marketplace";
import { COUNTRY_NAMES, regionsFor } from "@/lib/tee-time-post";
import { SUBCATEGORIES } from "@/lib/listings";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";

/**
 * The filter sheet.
 *
 * Edits a DRAFT and hands it back on Apply, rather than firing a query per
 * tap. Ten filters changed one at a time would be ten searches, and the
 * member has not finished deciding until they say so — which is also why
 * Clear all and Apply are both at the bottom, where a thumb is.
 *
 * Brands are fetched per category, never bundled: `listings.brand` is a
 * foreign key into `marketplace_brands`, so a stale list inside the app would
 * offer something the database no longer knows.
 *
 * Oct 2026 look: a photograph band at the top; each group in its own card;
 * categories as picture tiles; condition, selling and delivery as icon cards
 * with a word of explanation; quick price bands; brands searchable once a
 * category has them.
 */

const BAND = require("../../assets/images/scenes/dunes-gold.jpg");

const CONDITION_INFO: Record<string, { icon: keyof typeof Ionicons.glyphMap; hint: string }> = {
  "New / unused": { icon: "sparkles-outline", hint: "Never hit" },
  Excellent: { icon: "star-outline", hint: "Barely a mark" },
  Good: { icon: "thumbs-up-outline", hint: "Normal wear" },
  Fair: { icon: "construct-outline", hint: "Well used, works" },
};

const SALE_INFO: Record<string, { icon: keyof typeof Ionicons.glyphMap; hint: string }> = {
  fixed_price: { icon: "pricetag-outline", hint: "Buy it now" },
  offers_allowed: { icon: "chatbubbles-outline", hint: "Make an offer" },
  auction: { icon: "hammer-outline", hint: "Bid on it" },
  auction_with_buy_now: { icon: "flash-outline", hint: "Bid or buy" },
};

const DELIVERY_INFO: Record<string, { icon: keyof typeof Ionicons.glyphMap; hint: string }> = {
  post: { icon: "cube-outline", hint: "Sent to you" },
  collection: { icon: "location-outline", hint: "Pick it up" },
};

/** Quick price bands, in cents. */
const PRICE_BANDS: { label: string; min: number | null; max: number | null }[] = [
  { label: "Under €50", min: null, max: 5000 },
  { label: "€50–150", min: 5000, max: 15000 },
  { label: "€150–300", min: 15000, max: 30000 },
  { label: "€300+", min: 30000, max: null },
];

const BRANDS_SEARCH_FROM = 10;
const COUNTIES_SHOWN = 12;
export function MarketplaceFilters({
  open,
  filters,
  onClose,
  onApply,
}: {
  open: boolean;
  filters: Filters;
  onClose: () => void;
  onApply: (next: Filters) => void;
}) {
  const [draft, setDraft] = useState<Filters>(filters);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [country, setCountry] = useState("ireland");
  const [counties, setCounties] = useState<string[]>([]);
  const [brandQuery, setBrandQuery] = useState("");
  const [allCounties, setAllCounties] = useState(false);
  // Remounts the price boxes when a quick band fills them in.
  const [priceKey, setPriceKey] = useState(0);
  const insets = useSafeAreaInsets();

  // Re-seed each time it opens: a sheet that remembers a draft the member
  // abandoned is a sheet that lies about the list behind it.
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void brandsFor(draft.category, draft.subcategory || null).then((list) => {
      if (live) setBrands(list);
    });
    return () => {
      live = false;
    };
  }, [open, draft.category, draft.subcategory]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void regionsFor(country).then((list) => {
      if (live) setCounties(list);
    });
    return () => {
      live = false;
    };
  }, [open, country]);

  const set = (patch: Partial<Filters>) => setDraft((prev) => ({ ...prev, ...patch }));

  /** Choosing a category invalidates the subcategory and the brands under it
   *  — Motocaddy is a trolley brand, not a wedge brand. Same rule the
   *  website's own picker follows. */
  const chooseCategory = (value: string) =>
    set({
      category: draft.category === value ? "" : value,
      subcategory: "",
      brands: [],
    });

  const toggleBrand = (id: string) =>
    set({
      brands: draft.brands.includes(id)
        ? draft.brands.filter((entry) => entry !== id)
        : [...draft.brands, id],
    });

  const subcategories = draft.category
    ? SUBCATEGORIES[draft.category as keyof typeof SUBCATEGORIES] ?? []
    : [];

  const count = activeFilterCount(draft);

  const shownBrands = brandQuery.trim()
    ? brands.filter((b) => b.label.toLowerCase().includes(brandQuery.trim().toLowerCase()) || draft.brands.includes(b.id))
    : brands;
  const shownCounties = allCounties ? counties : counties.slice(0, COUNTIES_SHOWN);

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={["bottom"]}>
        <View style={[styles.band, { paddingTop: insets.top + 10 }]}>
          <Image source={BAND} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={styles.bandShade} />
          <View style={styles.bandTop}>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close filters">
              <Ionicons name="close" size={22} color={colors.cream50} />
            </Pressable>
          </View>
          <Text style={styles.bandTitle}>Find your gear</Text>
          <Text style={styles.bandSub}>{count > 0 ? `${count} ${count === 1 ? "filter" : "filters"} on` : "Narrow it down — or leave it wide open"}</Text>
        </View>

        <ScrollView keyboardDismissMode={KEYBOARD_DISMISS_MODE} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Card icon="swap-vertical" title="Sort by">
            <View style={styles.segments}>
              {MARKETPLACE_SORTS.map((value) => {
                const on = draft.sort === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => set({ sort: value })}
                    style={[styles.segment, on && styles.segmentOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                      {MARKETPLACE_SORT_LABELS[value].replace("Price: ", "")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card icon="grid-outline" title="Category" onClear={draft.category ? () => chooseCategory(draft.category) : undefined}>
            <TileGrid tiles={CATEGORY_TILES} selected={draft.category || null} onPick={chooseCategory} inset={spacing.md * 2} />
          </Card>

          {subcategories.length > 0 && (
            <Card icon="options-outline" title="Type">
              <View style={styles.chips}>
                {subcategories.map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    on={draft.subcategory === value}
                    onPress={() => set({ subcategory: draft.subcategory === value ? "" : value, brands: [] })}
                  />
                ))}
              </View>
            </Card>
          )}

          <Card icon="ribbon-outline" title="Brand" onClear={draft.brands.length ? () => set({ brands: [] }) : undefined}>
            {!draft.category ? (
              <Text style={styles.hint}>Pick a category to see its brands.</Text>
            ) : (
              <>
                {brands.length >= BRANDS_SEARCH_FROM ? (
                  <View style={styles.search}>
                    <Ionicons name="search" size={16} color={colors.ink500} />
                    <TextInput
                      style={styles.searchInput}
                      value={brandQuery}
                      onChangeText={setBrandQuery}
                      placeholder="Search brands"
                      placeholderTextColor={colors.ink500}
                      autoCorrect={false}
                    />
                  </View>
                ) : null}
                <View style={styles.chips}>
                  {shownBrands.map((brand) => (
                    <Chip key={brand.id} label={brand.label} on={draft.brands.includes(brand.id)} tick onPress={() => toggleBrand(brand.id)} />
                  ))}
                </View>
              </>
            )}
          </Card>

          <Card icon="shield-checkmark-outline" title="Condition">
            <View style={styles.options}>
              {CONDITIONS.map((value) => (
                <OptionCard
                  key={value}
                  icon={CONDITION_INFO[value]?.icon ?? "ellipse-outline"}
                  label={value}
                  hint={CONDITION_INFO[value]?.hint}
                  on={draft.condition === value}
                  onPress={() => set({ condition: draft.condition === value ? "" : value })}
                />
              ))}
            </View>
          </Card>

          <Card icon="pricetags-outline" title="Selling as">
            <View style={styles.options}>
              {FILTER_SALE_TYPES.map((entry) => (
                <OptionCard
                  key={entry.value}
                  icon={SALE_INFO[entry.value]?.icon ?? "pricetag-outline"}
                  label={entry.label}
                  hint={SALE_INFO[entry.value]?.hint}
                  on={draft.saleType === entry.value}
                  onPress={() => set({ saleType: draft.saleType === entry.value ? "" : entry.value })}
                />
              ))}
            </View>
          </Card>

          <Card icon="car-outline" title="Delivery">
            <View style={styles.options}>
              {DELIVERY_OPTIONS.map((entry) => (
                <OptionCard
                  key={entry.value}
                  icon={DELIVERY_INFO[entry.value]?.icon ?? "cube-outline"}
                  label={entry.label}
                  hint={DELIVERY_INFO[entry.value]?.hint}
                  on={draft.delivery === entry.value}
                  onPress={() => set({ delivery: draft.delivery === entry.value ? "" : entry.value })}
                />
              ))}
            </View>
          </Card>

          <Card
            icon="cash-outline"
            title="Price"
            onClear={
              draft.minPriceCents !== null || draft.maxPriceCents !== null
                ? () => {
                    set({ minPriceCents: null, maxPriceCents: null });
                    setPriceKey((k) => k + 1);
                  }
                : undefined
            }
          >
            <View style={styles.chips}>
              {PRICE_BANDS.map((band) => (
                <Chip
                  key={band.label}
                  label={band.label}
                  on={draft.minPriceCents === band.min && draft.maxPriceCents === band.max}
                  onPress={() => {
                    const on = draft.minPriceCents === band.min && draft.maxPriceCents === band.max;
                    set(on ? { minPriceCents: null, maxPriceCents: null } : { minPriceCents: band.min, maxPriceCents: band.max });
                    setPriceKey((k) => k + 1);
                  }}
                />
              ))}
            </View>
            <View style={styles.prices} key={priceKey}>
              <PriceBox label="From" cents={draft.minPriceCents} onChange={(cents) => set({ minPriceCents: cents })} />
              <Text style={styles.priceDash}>–</Text>
              <PriceBox label="To" cents={draft.maxPriceCents} onChange={(cents) => set({ maxPriceCents: cents })} />
            </View>
          </Card>

          <Card icon="location-outline" title="Where" onClear={draft.county ? () => set({ county: "" }) : undefined}>
            <View style={styles.chips}>
              {Object.entries(COUNTRY_NAMES).map(([code, label]) => (
                <Chip
                  key={code}
                  label={label}
                  on={country === code}
                  onPress={() => {
                    setCountry(code);
                    setAllCounties(false);
                    set({ county: "" });
                  }}
                />
              ))}
            </View>
            {counties.length > 0 ? (
              <>
                <View style={styles.divider} />
                <View style={styles.chips}>
                  {shownCounties.map((value) => (
                    <Chip key={value} label={value} small on={draft.county === value} onPress={() => set({ county: draft.county === value ? "" : value })} />
                  ))}
                </View>
                {counties.length > COUNTIES_SHOWN ? (
                  <Pressable onPress={() => setAllCounties(!allCounties)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.more}>{allCounties ? "Show fewer" : `Show all ${counties.length}`}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </Card>
        </ScrollView>

        <View style={styles.foot}>
          <Pressable
            style={({ pressed }) => [styles.clear, pressed && { opacity: 0.8 }]}
            onPress={() => {
              setDraft({ ...draft, ...CLEARED });
              setPriceKey((k) => k + 1);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.clearLabel}>Clear all</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.apply, pressed && { opacity: 0.9 }]} onPress={() => onApply(draft)} accessibilityRole="button">
            <Ionicons name="search" size={18} color={colors.cream50} />
            <Text style={styles.applyLabel}>Show results</Text>
            {count > 0 ? (
              <View style={styles.applyBadge}>
                <Text style={styles.applyBadgeText}>{count}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** Everything except the search term and the sort. Clearing the search from
 *  inside the filter sheet would wipe something typed on the screen behind
 *  it, and a sort is never "off". */
const CLEARED = {
  category: "",
  subcategory: "",
  brands: [] as string[],
  county: "",
  condition: "",
  saleType: "",
  delivery: "",
  minPriceCents: null,
  maxPriceCents: null,
};

function Card({ icon, title, onClear, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; onClear?: () => void; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={15} color={colors.green700} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        {onClear ? (
          <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${title}`}>
            <Text style={styles.cardClear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, on, onPress, tick = false, small = false }: { label: string; on: boolean; onPress: () => void; tick?: boolean; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, small && styles.chipSmall, on && styles.chipOn, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      {tick && on ? <Ionicons name="checkmark" size={14} color={colors.cream50} /> : null}
      <Text style={[styles.chipLabel, small && styles.chipLabelSmall, on && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

/** A choice with a picture and a word of explanation, two to a row. */
function OptionCard({ icon, label, hint, on, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; hint?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.88 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
    >
      <View style={[styles.optionIcon, on && styles.optionIconOn]}>
        <Ionicons name={icon} size={18} color={on ? colors.green700 : colors.green700} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.optionLabel, on && styles.optionLabelOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {label}
        </Text>
        {hint ? <Text style={[styles.optionHint, on && styles.optionHintOn]} numberOfLines={1}>{hint}</Text> : null}
      </View>
      {on ? <Ionicons name="checkmark-circle" size={18} color={colors.gold400} /> : null}
    </Pressable>
  );
}

/** Euros in, cents out. The database stores cents and the member types
 *  euros; doing the conversion here means no screen has to remember. */
function PriceBox({
  label,
  cents,
  onChange,
}: {
  label: string;
  cents: number | null;
  onChange: (cents: number | null) => void;
}) {
  const [text, setText] = useState(cents === null ? "" : String(Math.round(cents / 100)));

  return (
    <View style={styles.priceBox}>
      <Text style={styles.priceLabel}>{label}</Text>
      <View style={styles.priceField}>
        <Text style={styles.priceEuro}>€</Text>
        <TextInput
          style={styles.priceInput}
          value={text}
          onChangeText={(next) => {
            const digits = next.replace(/[^0-9]/g, "");
            setText(digits);
            onChange(digits === "" ? null : Number(digits) * 100);
          }}
          keyboardType="number-pad"
          placeholder="Any"
          placeholderTextColor={colors.ink500}
        />
      </View>
    </View>
  );
}

const CARD_SHADOW = { shadowColor: colors.navy900, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } } as const;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },

  band: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, backgroundColor: colors.navy900, overflow: "hidden" },
  bandShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(12,32,56,0.45)" },
  bandTop: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(12,32,56,0.55)", borderWidth: 1, borderColor: creamAlpha(0.35) },
  bandTitle: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: "#ffffff" },
  bandSub: { fontFamily: fonts.body, fontSize: 15.5, color: "rgba(255,255,255,0.92)", marginTop: 2 },

  body: { padding: spacing.md, gap: spacing.sm + 4, paddingBottom: spacing.xl },

  card: { gap: spacing.sm + 2, padding: spacing.md, borderRadius: radii.lg + 4, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, ...CARD_SHADOW },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  cardTitle: { flex: 1, fontFamily: fonts.display, fontSize: 18, color: colors.ink900 },
  cardClear: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  segments: { flexDirection: "row", padding: 4, borderRadius: radii.pill, backgroundColor: colors.cream100 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 9, paddingHorizontal: 6, borderRadius: radii.pill },
  segmentOn: { backgroundColor: colors.surface, ...CARD_SHADOW, shadowOpacity: 0.12 },
  segmentText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink500 },
  segmentTextOn: { fontFamily: fonts.bodyBold, color: colors.green700 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 13, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  chipSmall: { paddingHorizontal: 11, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  chipLabelSmall: { fontSize: 13.5 },
  chipLabelOn: { color: colors.cream50 },

  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 42, borderRadius: radii.pill, backgroundColor: colors.cream50 },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },

  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: { width: "48.5%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radii.md + 2, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  optionOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  optionIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  optionIconOn: { backgroundColor: colors.cream50 },
  optionLabel: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink900 },
  optionLabelOn: { color: colors.cream50 },
  optionHint: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 1 },
  optionHintOn: { color: creamAlpha(0.8) },

  prices: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  priceDash: { fontFamily: fonts.bodySemi, fontSize: 18, color: colors.ink500, paddingBottom: 12 },
  priceBox: { flex: 1, gap: 5 },
  priceLabel: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500 },
  priceField: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 13, height: 46, borderRadius: radii.md, backgroundColor: colors.cream50 },
  priceEuro: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink500 },
  priceInput: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  more: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },

  foot: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.surface },
  clear: { paddingHorizontal: spacing.lg, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line },
  clearLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink500 },
  apply: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingVertical: 15, borderRadius: radii.pill, backgroundColor: colors.green700 },
  applyLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  applyBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  applyBadgeText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.navy900 },
});
