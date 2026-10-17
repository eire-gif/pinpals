import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  FINDER_CATEGORIES,
  brandTiles,
  countFor,
  finderStep,
  modelTiles,
  priceRange,
  totalForSale,
  type FinderCount,
  type FinderModel,
} from "@/lib/finder";
import { categoryBrandOrder, loadFinderBrands, loadFinderCounts, loadFinderModels, type FinderBrand } from "@/lib/gear-finder";
import { CATEGORY_PHOTOS } from "@/lib/marketplace-smart";
import type { Filters } from "@/lib/marketplace";
import { colors, fonts, spacing } from "@/lib/theme";

/**
 * Find by club, brand and model (approved mock-up "Flow · App", 0163).
 *
 * Three steps along the top — Club, Brand, Model — and the choices for the
 * step that's waiting underneath. Each pick narrows the listings below
 * straight away (they're always showing), and any step can be skipped.
 * Tapping a finished step goes back to it.
 */
export function GearFinder({
  filters,
  onPick,
  refreshKey,
}: {
  filters: Filters;
  onPick: (patch: Pick<Filters, "category" | "brands" | "model"> & { subcategory?: string }) => void;
  /** Changes when the list is pulled to refresh, so the counts do too. */
  refreshKey?: number;
}) {
  const brand = filters.brands.length === 1 ? filters.brands[0] : "";
  const step = finderStep({ category: filters.category, brand, model: filters.model });

  const [brands, setBrands] = useState<Map<string, FinderBrand>>(new Map());
  const [counts, setCounts] = useState<FinderCount[]>([]);
  const [order, setOrder] = useState<{ category: string; ids: string[] }>({ category: "", ids: [] });
  const [models, setModels] = useState<{ key: string; list: FinderModel[] }>({ key: "", list: [] });
  const [everyModel, setEveryModel] = useState(false);

  useEffect(() => {
    void loadFinderBrands().then(setBrands);
  }, []);

  useEffect(() => {
    let live = true;
    void loadFinderCounts(filters.category, brand).then((c) => live && setCounts(c));
    return () => {
      live = false;
    };
  }, [filters.category, brand, refreshKey]);

  useEffect(() => {
    if (!filters.category) return;
    let live = true;
    void categoryBrandOrder(filters.category).then((ids) => live && setOrder({ category: filters.category, ids }));
    return () => {
      live = false;
    };
  }, [filters.category]);

  const modelKey = brand && filters.category ? `${brand}|${filters.category}` : "";
  useEffect(() => {
    if (!modelKey) return;
    let live = true;
    const [b, c] = modelKey.split("|");
    void loadFinderModels(b, c).then((list) => live && setModels({ key: modelKey, list }));
    return () => {
      live = false;
    };
  }, [modelKey]);

  const brandList = useMemo(
    () => (order.category === filters.category ? brandTiles(order.ids, counts).filter((t) => brands.has(t.id)) : []),
    [order, filters.category, counts, brands]
  );
  const modelList = models.key === modelKey ? models.list : [];
  const tiles = modelTiles(modelList, counts);
  const picked = filters.model ? modelList.find((m) => m.id === filters.model) : undefined;
  const label = (id: string) => brands.get(id)?.label ?? id;

  const steps = [
    { key: "category" as const, n: "1 Club", value: filters.category ? (FINDER_CATEGORIES.find((c) => c.key === filters.category)?.short ?? filters.category) : "", go: () => onPick({ category: "", brands: brand && !filters.category ? [brand] : [], model: "", subcategory: "" }) },
    { key: "brand" as const, n: "2 Brand", value: brand ? label(brand) : filters.brands.length > 1 ? `${filters.brands.length} brands` : "", go: () => onPick({ category: filters.category, brands: [], model: "" }) },
    { key: "model" as const, n: "3 Model", value: picked?.family ?? "", go: () => onPick({ category: filters.category, brands: filters.brands, model: "" }) },
  ];

  const matching = filters.model
    ? countFor(counts, "model", filters.model)?.count
    : brand && filters.category
      ? countFor(counts, "brand", brand)?.count
      : filters.category
        ? countFor(counts, "category", filters.category)?.count
        : brand
          ? undefined
          : totalForSale(counts);

  return (
    <View style={styles.wrap}>
      <View style={styles.steps}>
        {steps.map((s) => {
          const on = step === s.key;
          const reachable = s.key === "category" || (s.key === "brand" && !!filters.category) || (s.key === "model" && !!brand && !!filters.category);
          return (
            <Pressable
              key={s.key}
              onPress={reachable ? s.go : undefined}
              style={[styles.step, on ? styles.stepOn : s.value ? styles.stepDone : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: !reachable }}
              accessibilityLabel={`${s.n}: ${s.value || (on ? "choose" : "any")}`}
            >
              <Text style={[styles.stepN, on && styles.stepTextOn]}>{s.n.toUpperCase()}</Text>
              <Text style={[styles.stepV, on && styles.stepTextOn]} numberOfLines={1}>
                {s.value || (on ? "Choose" : "Any")}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.prompt}>
        {step === "category"
          ? brand
            ? `What ${label(brand)} are you after?`
            : "What are you looking for?"
          : step === "brand"
            ? `Which brand of ${filters.category.toLowerCase()}?`
            : step === "model"
              ? `Which ${label(brand)} model?`
              : `${label(brand)} ${picked?.family ?? ""}`}
      </Text>

      {step === "category" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {FINDER_CATEGORIES.map((c) => {
            const n = countFor(counts, "category", c.key)?.count ?? 0;
            return (
              <Pressable
                key={c.key}
                onPress={() => onPick({ category: c.key, brands: brand ? [brand] : [], model: "", subcategory: "" })}
                style={styles.cat}
                accessibilityRole="button"
                accessibilityLabel={`${c.short}, ${n} for sale`}
              >
                <Image source={CATEGORY_PHOTOS[c.key]} style={styles.catPhoto} />
                <Text style={styles.catLabel} numberOfLines={1}>
                  {c.short}
                </Text>
                <Text style={styles.catCount}>{n ? `${n}` : "—"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : step === "brand" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {brandList.map((t) => {
            const b = brands.get(t.id)!;
            return (
              <Pressable
                key={t.id}
                onPress={() => onPick({ category: filters.category, brands: [t.id], model: "" })}
                style={styles.brand}
                accessibilityRole="button"
                accessibilityLabel={`${b.label}, ${t.count} for sale`}
              >
                <View style={styles.logoBox}>
                  {b.logoUrl ? (
                    <Image source={{ uri: b.logoUrl }} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
                  ) : (
                    <Text style={[styles.logoText, b.label.length > 9 && { fontSize: 12 }]} numberOfLines={2}>
                      {b.label}
                    </Text>
                  )}
                </View>
                <Text style={styles.brandCount}>{t.count ? `${t.count} for sale` : "None now"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : step === "model" ? (
        modelList.length === 0 ? (
          <Text style={styles.muted}>Every {label(brand)} for sale is below.</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {[...tiles.forSale, ...(everyModel || tiles.forSale.length === 0 ? tiles.older : [])].map((m) => {
                const c = countFor(counts, "model", m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => onPick({ category: filters.category, brands: filters.brands, model: m.id })}
                    style={styles.model}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.family}${m.year ? `, ${m.year}` : ""}, ${m.count} for sale`}
                  >
                    <Text style={styles.modelName} numberOfLines={1}>
                      {m.family}
                    </Text>
                    <Text style={styles.modelMeta} numberOfLines={1}>
                      {[m.year, m.count ? `${m.count} for sale` : "none now", c ? priceRange(c.minPriceCents, c.maxPriceCents) : ""].filter(Boolean).join(" · ")}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {tiles.forSale.length > 0 && tiles.older.length > 0 ? (
              <Pressable onPress={() => setEveryModel((v) => !v)} hitSlop={8} accessibilityRole="button" style={styles.moreRow}>
                <Text style={styles.more}>{everyModel ? "Only models for sale now" : `Every ${label(brand)} model (${tiles.older.length} more)`}</Text>
              </Pressable>
            ) : null}
          </>
        )
      ) : picked ? (
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {[picked.year, picked.versions.slice(0, 3).join(" · ")].filter(Boolean).join("  ·  ")}
          </Text>
          {countFor(counts, "model", picked.id) ? (
            <Text style={styles.summaryPrice}>
              Asking {priceRange(countFor(counts, "model", picked.id)?.minPriceCents, countFor(counts, "model", picked.id)?.maxPriceCents)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {matching != null ? (
        <Text style={styles.caption}>
          {matching} for sale — {step === "done" ? "all below" : "all below. Pick to narrow them, or keep scrolling."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 12, gap: 8 },
  steps: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.md },
  step: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  stepOn: { backgroundColor: colors.gold500 },
  stepDone: { backgroundColor: colors.navy900 },
  stepN: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 0.6, color: colors.ink500 },
  stepV: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },
  stepTextOn: { color: colors.navy900 },
  prompt: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900, paddingHorizontal: spacing.md, marginTop: 2 },
  row: { gap: 8, paddingHorizontal: spacing.md },
  cat: { width: 92, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: "hidden", backgroundColor: colors.surface },
  catPhoto: { width: 92, height: 62 },
  catLabel: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.ink900, paddingHorizontal: 7, paddingTop: 5 },
  catCount: { fontFamily: fonts.body, fontSize: 11, color: colors.ink500, paddingHorizontal: 7, paddingBottom: 6 },
  brand: { width: 104, gap: 4 },
  logoBox: { height: 58, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 8, overflow: "hidden" },
  logo: { width: "88%", height: 40 },
  logoText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900, textAlign: "center" },
  brandCount: { fontFamily: fonts.body, fontSize: 11, color: colors.ink500, textAlign: "center" },
  model: { minHeight: 52, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center", maxWidth: 220 },
  modelName: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
  modelMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.ink500, marginTop: 1 },
  moreRow: { paddingHorizontal: spacing.md },
  more: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.green700 },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, paddingHorizontal: spacing.md },
  summary: { paddingHorizontal: spacing.md, gap: 2 },
  summaryText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  summaryPrice: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green800 },
  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, paddingHorizontal: spacing.md },
});

