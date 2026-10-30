import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { useAuth } from "@/lib/auth";
import { CATEGORIES, type Category } from "@/lib/listings";
import { loadMyProfile } from "@/lib/profile";
import { SMART_COUNTIES } from "@/lib/smart-search";
import { FLEXES, listingsFor, loadMyWanted, saveWanted, type Flex, type Hand, type ListingLite } from "@/lib/wanted";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const CLUBS = new Set<Category>(["Drivers", "Woods & hybrids", "Irons", "Wedges", "Putters", "Full sets"]);

/**
 * Wanted ads (0203): post one — or change it. What it is, anything in
 * particular, shaft and hand for clubs, your price and where. Listings that
 * already fit are shown before you post.
 */
export default function NewWantedScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editId = id ? Number(id) : null;
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [category, setCategory] = useState<Category>("Woods & hybrids");
  const [details, setDetails] = useState("");
  const [flex, setFlex] = useState<Flex | null>(null);
  const [hand, setHand] = useState<Hand | null>(null);
  const [price, setPrice] = useState("");
  const [county, setCounty] = useState<string | null>(null);
  const [countyOpen, setCountyOpen] = useState(false);
  const [now, setNow] = useState<ListingLite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!me || ready) return;
      void (async () => {
        const [mine, profile] = await Promise.all([editId ? loadMyWanted(me).catch(() => null) : Promise.resolve(null), loadMyProfile(me).catch(() => null)]);
        const ad = mine?.find((w) => w.id === editId);
        if (ad) {
          setCategory(ad.category);
          setDetails(ad.details ?? "");
          setFlex(ad.flex);
          setHand(ad.hand);
          setPrice(ad.maxPriceCents != null ? String(Math.round(ad.maxPriceCents / 100)) : "");
          setCounty(ad.county);
        } else if (profile?.county) {
          setCounty(profile.county);
        }
        setReady(true);
      })();
    }, [me, editId, ready])
  );

  const priceCents = price.trim() === "" ? null : /^\d{1,6}$/.test(price.replace(/[€\s,]/g, "")) ? Number(price.replace(/[€\s,]/g, "")) * 100 : NaN;
  const priceBad = priceCents != null && (Number.isNaN(priceCents) || priceCents < 100);
  const clubs = CLUBS.has(category);

  useEffect(() => {
    if (!ready || priceBad) return;
    let live = true;
    const t = setTimeout(() => {
      void listingsFor({ category, flex: clubs ? flex : null, hand: clubs ? hand : null, maxPriceCents: priceCents, county }, me, 3).then((l) => live && setNow(l));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ready, category, flex, hand, priceCents, county, me, clubs, priceBad]);

  const post = async () => {
    if (priceBad) return;
    setBusy(true);
    try {
      await saveWanted(editId, { category, details, flex: clubs ? flex : null, hand: clubs ? hand : null, maxPriceCents: priceCents, county });
      router.replace("/wanted");
    } catch (e) {
      Alert.alert("Couldn't post it", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: editId ? "Your wanted ad" : "Wanted" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>What are you after?</Text>
        <Text style={styles.meta}>Sellers who have one get told — and anything listed later that fits comes straight to you.</Text>

        <Text style={styles.label}>What it is</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => {
            const on = c === category;
            return (
              <Pressable key={c} style={[styles.chip, on && styles.chipOn]} onPress={() => setCategory(c)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Anything in particular?</Text>
        <TextInput value={details} onChangeText={setDetails} placeholder="3-wood, 15°, any make" placeholderTextColor={colors.ink500} maxLength={120} style={styles.input} accessibilityLabel="Anything in particular" />

        {clubs ? (
          <>
            <Text style={styles.label}>Shaft</Text>
            <View style={styles.chips}>
              {[null, ...FLEXES].map((f) => {
                const on = f === flex;
                return (
                  <Pressable key={f ?? "any"} style={[styles.chip, on && styles.chipOn]} onPress={() => setFlex(f)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{f ?? "Any"}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.label}>Hand</Text>
            <View style={styles.chips}>
              {([null, "Right-handed", "Left-handed"] as const).map((h) => {
                const on = h === hand;
                return (
                  <Pressable key={h ?? "any"} style={[styles.chip, on && styles.chipOn]} onPress={() => setHand(h)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{h ?? "Either"}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Up to</Text>
            <View style={styles.priceBox}>
              <Text style={styles.euro}>€</Text>
              <TextInput value={price} onChangeText={setPrice} placeholder="Any price" placeholderTextColor={colors.ink500} keyboardType="number-pad" style={styles.priceInput} accessibilityLabel="Your price, in euro" maxLength={7} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Where</Text>
            <Pressable style={styles.place} onPress={() => setCountyOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={`Where: ${county ?? "anywhere"}. Tap to change`}>
              <Text style={styles.placeText}>{county ?? "Anywhere"}</Text>
            </Pressable>
          </View>
        </View>
        {priceBad ? <Text style={styles.warn}>Type a price in whole euro, like 100.</Text> : null}
        {countyOpen ? (
          <View style={styles.chips}>
            {[null, ...SMART_COUNTIES].map((c) => {
              const on = c === county;
              return (
                <Pressable
                  key={c ?? "any"}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => {
                    setCounty(c);
                    setCountyOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c ?? "Anywhere"}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {now && now.length > 0 ? (
          <View style={styles.now}>
            <Text style={styles.nowTitle}>{`${now.length === 3 ? "3 or more" : now.length} listed right now could fit`}</Text>
            {now.map((l) => (
              <Pressable key={l.id} style={styles.nowRow} onPress={() => router.push(`/listing/${l.id}`)} accessibilityRole="link">
                <Text style={styles.nowName} numberOfLines={1}>
                  {l.title}
                </Text>
                <Text style={styles.nowPrice}>{l.priceCents != null ? `€${Math.round(l.priceCents / 100)}` : "Auction"}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={styles.meta}>Your wanted ad shows on the marketplace for 30 days, with your first name and county. Take it down any time.</Text>
        <Pressable style={[styles.post, (busy || priceBad) && { opacity: 0.5 }]} disabled={busy || priceBad} onPress={post} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.ink900} /> : <Text style={styles.postText}>{editId ? "Save my wanted ad" : "Post my wanted ad"}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 38, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  chipTextOn: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.surface },
  priceBox: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: 12, backgroundColor: colors.surface, marginTop: 6 },
  euro: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink500 },
  priceInput: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900, padding: 0 },
  place: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: 12, backgroundColor: colors.surface, justifyContent: "center", marginTop: 6 },
  placeText: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  warn: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.red600 },
  now: { backgroundColor: colors.green100, borderRadius: radii.lg, padding: spacing.md, gap: 6, marginTop: spacing.sm },
  nowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green800 },
  nowRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 },
  nowName: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink900 },
  nowPrice: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  post: { minHeight: 50, borderRadius: radii.md, backgroundColor: colors.buy500, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  postText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
});
