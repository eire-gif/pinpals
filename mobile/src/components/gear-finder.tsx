import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

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
 * Three steps along the top — Club, Brand, Model. Each pick narrows the
 * listings below straight away (they're always showing), and any step can be
 * skipped. Tapping a finished step goes back to it.
 *
 * Oct 31 2026 (approved mock-up "Marketplace simplified"): the choices are
 * folded away until asked for, so the adverts start higher up. Tap a step
 * and its choices drop open underneath as an even grid — three across for
 * clubs and brands, two for models; pick and the next step opens in its
 * place; pick a model, or tap the open step again, and it folds away.
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
  const [expanded, setExpanded] = useState(false);

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
              onPress={
                reachable
                  ? () => {
                      if (on && expanded) {
                        setExpanded(false);
                        return;
                      }
                      if (!on) s.go();
                      setExpanded(true);
                    }
                  : undefined
              }
              style={[styles.step, on ? styles.stepOn : s.value ? styles.stepDone : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: !reachable, expanded: on ? expanded : undefined }}
              accessibilityLabel={`${s.n}: ${s.value || (on ? "choose" : "any")}`}
            >
              <Text style={[styles.stepN, on ? styles.stepTextOn : s.value ? styles.stepNDone : null]}>{s.n.toUpperCase()}</Text>
              <View style={styles.stepVRow}>
                <Text style={[styles.stepV, on ? styles.stepTextOn : s.value ? styles.stepVDone : null]} numberOfLines={1}>
                  {s.value || (on ? "Choose" : "Any")}
                </Text>
                {on ? <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.navy900} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {expanded ? (
      <>
      <View style={styles.promptRow}>
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
        <Pressable onPress={() => setExpanded(false)} hitSlop={6} style={styles.fold} accessibilityRole="button" accessibilityLabel="Hide choices">
          <Ionicons name="close" size={18} color={colors.navy900} />
        </Pressable>
      </View>

      {step === "category" ? (
        <View style={styles.grid}>
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
                <Text style={styles.catLabel} numberOfLines={2}>
                  {c.short}
                </Text>
                <Text style={styles.catCount}>{n ? `${n} for sale` : "—"}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : step === "brand" ? (
        <View style={styles.grid}>
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
        </View>
      ) : step === "model" ? (
        modelList.length === 0 ? (
          <Text style={styles.muted}>Every {label(brand)} for sale is below.</Text>
        ) : (
          <>
            <View style={styles.grid}>
              {[...tiles.forSale, ...(everyModel || tiles.forSale.length === 0 ? tiles.older : [])].map((m) => {
                const c = countFor(counts, "model", m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      onPick({ category: filters.category, brands: filters.brands, model: m.id });
                      setExpanded(false);
                    }}
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
            </View>
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
      </>
      ) : null}

      {matching != null ? (
        <Text style={styles.caption}>
          {matching} for sale — {step === "done" || !expanded ? "all below" : "all below. Pick to narrow them, or keep scrolling."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, paddingVertical: 4, gap: 10 },
  steps: { flexDirection: "row", gap: 10, paddingHorizontal: spacing.md },
  step: { flex: 1, minHeight: 72, borderRadius: 16, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, gap: 2 },
  stepOn: { backgroundColor: colors.gold500 },
  stepDone: { backgroundColor: colors.navy900 },
  stepN: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.ink500 },
  stepNDone: { color: colors.gold400 },
  stepVRow: { flexDirection: "row", alignItems: "center", gap: 3, maxWidth: "100%" },
  stepV: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.navy900, flexShrink: 1 },
  stepVDone: { color: colors.cream50 },
  stepTextOn: { color: colors.navy900 },
  promptRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, marginTop: 6 },
  prompt: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 19, color: colors.navy900 },
  fold: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: spacing.md },
  cat: { width: "31%", flexGrow: 1, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: "hidden", backgroundColor: colors.surface },
  catPhoto: { width: "100%", height: 72 },
  catLabel: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 17, minHeight: 34, color: colors.ink900, paddingHorizontal: 8, paddingTop: 6, textAlign: "center" },
  catCount: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, paddingHorizontal: 8, paddingBottom: 8, textAlign: "center" },
  brand: { width: "31%", flexGrow: 1, gap: 4 },
  logoBox: { height: 64, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", paddingHorizontal: 8, overflow: "hidden" },
  logo: { width: "88%", height: 42 },
  logoText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900, textAlign: "center" },
  brandCount: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, textAlign: "center" },
  model: { width: "47%", flexGrow: 1, minHeight: 60, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  modelName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  modelMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 2 },
  moreRow: { paddingHorizontal: spacing.md, minHeight: 44, justifyContent: "center" },
  more: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },
  muted: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500, paddingHorizontal: spacing.md },
  summary: { paddingHorizontal: spacing.md, gap: 2 },
  summaryText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
  summaryPrice: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green800 },
  caption: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, paddingHorizontal: spacing.md },
});
