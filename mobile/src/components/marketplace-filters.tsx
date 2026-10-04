import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";

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
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
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
 */
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

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
        <View style={styles.head}>
          <Text style={styles.title}>Filter</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close filters">
            <Ionicons name="close" size={25} color={colors.ink900} />
          </Pressable>
        </View>

        <ScrollView keyboardDismissMode={KEYBOARD_DISMISS_MODE} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Group title="Sort by">
            {MARKETPLACE_SORTS.map((value) => (
              <Chip
                key={value}
                label={MARKETPLACE_SORT_LABELS[value]}
                on={draft.sort === value}
                onPress={() => set({ sort: value })}
              />
            ))}
          </Group>

          <Group title="Category">
            {CATEGORIES.map((value) => (
              <Chip
                key={value}
                label={value}
                on={draft.category === value}
                onPress={() => chooseCategory(value)}
              />
            ))}
          </Group>

          {subcategories.length > 0 && (
            <Group title="Type">
              {subcategories.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  on={draft.subcategory === value}
                  onPress={() =>
                    set({ subcategory: draft.subcategory === value ? "" : value, brands: [] })
                  }
                />
              ))}
            </Group>
          )}

          {brands.length > 0 && (
            <Group title="Brand">
              {brands.map((brand) => (
                <Chip
                  key={brand.id}
                  label={brand.label}
                  on={draft.brands.includes(brand.id)}
                  onPress={() => toggleBrand(brand.id)}
                />
              ))}
            </Group>
          )}

          <Group title="Condition">
            {CONDITIONS.map((value) => (
              <Chip
                key={value}
                label={value}
                on={draft.condition === value}
                onPress={() => set({ condition: draft.condition === value ? "" : value })}
              />
            ))}
          </Group>

          <Group title="Selling as">
            {FILTER_SALE_TYPES.map((entry) => (
              <Chip
                key={entry.value}
                label={entry.label}
                on={draft.saleType === entry.value}
                onPress={() =>
                  set({ saleType: draft.saleType === entry.value ? "" : entry.value })
                }
              />
            ))}
          </Group>

          <Group title="Delivery">
            {DELIVERY_OPTIONS.map((entry) => (
              <Chip
                key={entry.value}
                label={entry.label}
                on={draft.delivery === entry.value}
                onPress={() =>
                  set({ delivery: draft.delivery === entry.value ? "" : entry.value })
                }
              />
            ))}
          </Group>

          <View style={styles.group}>
            <Text style={styles.groupTitle}>Price</Text>
            <View style={styles.prices}>
              <PriceBox
                label="From"
                cents={draft.minPriceCents}
                onChange={(cents) => set({ minPriceCents: cents })}
              />
              <PriceBox
                label="To"
                cents={draft.maxPriceCents}
                onChange={(cents) => set({ maxPriceCents: cents })}
              />
            </View>
          </View>

          <Group title="Where">
            {Object.entries(COUNTRY_NAMES).map(([code, label]) => (
              <Chip
                key={code}
                label={label}
                on={country === code}
                onPress={() => {
                  setCountry(code);
                  set({ county: "" });
                }}
              />
            ))}
          </Group>

          {counties.length > 0 && (
            <Group title="County">
              {counties.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  on={draft.county === value}
                  onPress={() => set({ county: draft.county === value ? "" : value })}
                />
              ))}
            </Group>
          )}
        </ScrollView>

        <View style={styles.foot}>
          <Pressable
            style={styles.clear}
            onPress={() =>
              setDraft({ ...draft, ...CLEARED })
            }
            accessibilityRole="button"
          >
            <Text style={styles.clearLabel}>Clear all</Text>
          </Pressable>
          <Pressable
            style={styles.apply}
            onPress={() => onApply(draft)}
            accessibilityRole="button"
          >
            <Text style={styles.applyLabel}>
              {count > 0 ? `Show results (${count})` : "Show results"}
            </Text>
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
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

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },

  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },

  body: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },

  group: { gap: spacing.sm },
  groupTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },

  prices: { flexDirection: "row", gap: spacing.sm },
  priceBox: { flex: 1, gap: 5 },
  priceLabel: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  priceField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    height: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  priceEuro: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink500 },
  priceInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },

  foot: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  clear: {
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  clearLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink500 },
  apply: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  applyLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
