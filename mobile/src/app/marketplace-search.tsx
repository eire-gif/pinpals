import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { useAuth } from "@/lib/auth";
import { loadSmartBrands } from "@/lib/listing-posts";
import { searchListings, type Card } from "@/lib/marketplace";
import { POPULAR_SEARCHES, clearRecentSearches, filtersFromSmart, recentSearches, rememberSearch } from "@/lib/marketplace-smart";
import { completeSearch, parseSearch, understoodSomething, type SmartBrand } from "@/lib/smart-search";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Smart search (approved mock-up 2). Type it how you'd say it —
 * "tm qi10 drvier under 300 near me" — and it shows what it understood
 * (brand, category, price, place, condition, left-handed), fixes the
 * spelling, finishes the word you're typing, and lists matches as you go.
 * Search hands the words to Browse (../(tabs)/marketplace/index.tsx), which
 * reads them the same way.
 */
export default function MarketplaceSearchScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [q, setQ] = useState("");
  const [brands, setBrands] = useState<SmartBrand[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [hits, setHits] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const token = useRef(0);

  useEffect(() => {
    void loadSmartBrands().then(setBrands);
    void recentSearches().then(setRecent);
  }, []);

  const parsed = useMemo(() => parseSearch(q, brands), [q, brands]);
  const completions = useMemo(() => completeSearch(q, brands, 4), [q, brands]);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const mine = ++token.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchListings(filtersFromSmart(parsed), null, userId, 4)
        .then((page) => {
          if (mine === token.current) setHits(page.cards);
        })
        .catch(() => {
          if (mine === token.current) setHits([]);
        })
        .finally(() => {
          if (mine === token.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, parsed, userId]);

  function go(query: string) {
    const text = query.trim();
    if (!text) return;
    void rememberSearch(text);
    router.navigate({ pathname: "/marketplace", params: { search: text, at: String(Date.now()) } });
  }

  const typed = q.trim().length > 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.fill}>
        <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.cream50} />
          </Pressable>
          <View style={styles.box}>
            <Ionicons name="search" size={19} color={colors.navy900} />
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => go(q)}
              placeholder="Brand, model, price, place…"
              placeholderTextColor={colors.ink500}
              style={styles.input}
              accessibilityLabel="Search the marketplace"
            />
            {typed ? (
              <Pressable onPress={() => setQ("")} hitSlop={8} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close" size={16} color={colors.navy900} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode={KEYBOARD_DISMISS_MODE}>
          {typed ? (
            <>
              {understoodSomething(parsed) ? (
                <View style={styles.understood}>
                  <View style={styles.eyebrowRow}>
                    <Ionicons name="sparkles" size={13} color="#8a6a1f" />
                    <Text style={styles.eyebrow}>We understood</Text>
                  </View>
                  <View style={styles.chips}>
                    {parsed.chips.map((c) => (
                      <View key={c.key} style={styles.chip}>
                        <Text style={styles.chipText}>
                          <Text style={styles.chipKey}>{c.label} </Text>
                          {c.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {parsed.corrections.length ? (
                    <Text style={styles.fix}>Spelling fixed: {parsed.corrections.map((c) => `${c.from} → ${c.to}`).join(", ")}</Text>
                  ) : null}
                </View>
              ) : null}

              <View>
                <Pressable onPress={() => go(q)} style={styles.line} accessibilityRole="button">
                  <Ionicons name="search" size={17} color={colors.green700} />
                  <Text style={[styles.lineText, styles.bold]} numberOfLines={1}>
                    Search “{q.trim()}”
                  </Text>
                  <Ionicons name="arrow-forward" size={17} color={colors.green700} />
                </Pressable>
                {completions.map((c) => (
                  <Pressable key={c} onPress={() => setQ(`${c} `)} style={styles.line} accessibilityRole="button" accessibilityLabel={`Fill in ${c}`}>
                    <Ionicons name="search" size={17} color={colors.ink500} />
                    <Text style={styles.lineText} numberOfLines={1}>
                      {c}
                    </Text>
                    <Ionicons name="arrow-up-outline" size={17} color={colors.ink500} style={{ transform: [{ rotate: "-45deg" }] }} />
                  </Pressable>
                ))}
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Listed now</Text>
                  {searching ? <ActivityIndicator size="small" color={colors.green700} /> : null}
                </View>
                {hits.map((h) => (
                  <Pressable key={h.id} onPress={() => router.push(`/listing/${h.id}`)} style={styles.hit} accessibilityRole="button">
                    {h.imageUrl ? <Image source={{ uri: h.imageUrl }} style={styles.hitPhoto} /> : <View style={[styles.hitPhoto, styles.hitNone]} />}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hitTitle} numberOfLines={1}>
                        {h.title}
                      </Text>
                      <Text style={styles.hitMeta} numberOfLines={1}>
                        {[h.condition, h.county].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    {h.priceCents != null ? <Text style={styles.hitPrice}>€{Math.round(h.priceCents / 100)}</Text> : null}
                  </Pressable>
                ))}
                {!searching && hits.length === 0 ? (
                  <View style={styles.none}>
                    <Text style={styles.noneTitle}>Nothing listed yet</Text>
                    <Text style={styles.noneBody}>Try fewer words — or search anyway and save it, so you hear when one's listed.</Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : (
            <>
              {recent.length ? (
                <View style={styles.section}>
                  <View style={styles.sectionHead}>
                    <Text style={styles.label}>Recent</Text>
                    <Pressable
                      onPress={() => {
                        void clearRecentSearches();
                        setRecent([]);
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.clearAll}>Clear</Text>
                    </Pressable>
                  </View>
                  {recent.map((r) => (
                    <Pressable key={r} onPress={() => go(r)} style={styles.line} accessibilityRole="button">
                      <Ionicons name="time-outline" size={17} color={colors.ink500} />
                      <Text style={styles.lineText} numberOfLines={1}>
                        {r}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.section}>
                <Text style={styles.label}>Popular this week</Text>
                <View style={styles.chips}>
                  {POPULAR_SEARCHES.map((p) => (
                    <Pressable key={p} onPress={() => go(p)} style={styles.popular} accessibilityRole="button">
                      <Text style={styles.popularText}>{p}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={styles.tip}>Write it how you&apos;d say it — “ping irons under 400 near me”, “scotty putter cork”, “left handed driver”.</Text>
            </>
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  head: { backgroundColor: colors.navy900, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingBottom: 14 },
  back: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  box: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: colors.cream50, paddingLeft: 14, paddingRight: 8, borderWidth: 2, borderColor: colors.gold500 },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  clear: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  understood: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: 14, gap: 10 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, textTransform: "uppercase", color: "#8a6a1f" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: colors.green100, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green800 },
  chipKey: { fontFamily: fonts.body, color: colors.green700 },
  fix: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  line: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.cream100 },
  lineText: { flex: 1, fontFamily: fonts.body, fontSize: 15.5, color: colors.ink900 },
  bold: { fontFamily: fonts.bodyBold, color: colors.green700 },
  section: { gap: 10 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.navy900 },
  label: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.ink500 },
  clearAll: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700 },
  hit: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 8 },
  hitPhoto: { width: 60, height: 60, borderRadius: 10 },
  hitNone: { backgroundColor: colors.cream100 },
  hitTitle: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.ink900 },
  hitMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 2 },
  hitPrice: { fontFamily: fonts.display, fontSize: 18, color: colors.navy900, paddingRight: 6 },
  none: { backgroundColor: colors.surface, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, borderRadius: 14, padding: 14, gap: 4 },
  noneTitle: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink900 },
  noneBody: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500 },
  popular: { minHeight: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  popularText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.navy900 },
  tip: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink500 },
});
