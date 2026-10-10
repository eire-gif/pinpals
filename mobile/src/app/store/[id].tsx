import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Image, ImageBackground, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { coursePhoto } from "@/components/course-photos";
import { GRID_GAP, GearCard } from "@/components/gear-card";
import { useAuth } from "@/lib/auth";
import { setFavourite, type Card } from "@/lib/marketplace";
import { loadShopListings, loadStore, type Store } from "@/lib/new-gear";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A pro shop's storefront (0115). Approved by PinPals; sells new stock,
 * click & collect at its club or posted. Buying works exactly like used gear
 * (same listing, checkout and order screens) — the only differences are no
 * Buyer Protection fee for the golfer and the shop's commission, both taken
 * care of by the database.
 */
export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [store, setStore] = useState<Store | null>(null);
  const [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await loadStore(String(id));
      setStore(found);
      setItems(found ? await loadShopListings(userId, found.id, 60) : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function favourite(card: Card) {
    if (!userId) return;
    const next = !card.isFavourited;
    setItems((prev) => prev.map((c) => (c.id === card.id ? { ...c, isFavourited: next } : c)));
    await setFavourite(card.id, userId, next);
  }

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Pro shop", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.navy900} />
      </View>
    );
  }

  if (!store) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Pro shop", headerBackTitle: "Back" }} />
        <Ionicons name="storefront-outline" size={42} color={colors.ink500} />
        <Text style={styles.emptyTitle}>This shop isn&apos;t open</Text>
        <Text style={styles.emptyBody}>It may not be approved yet, or it has closed on PinPals.</Text>
      </View>
    );
  }

  const header = (
    <View>
      <ImageBackground source={store.coverUrl ? { uri: store.coverUrl } : coursePhoto(store.clubId, store.clubName)} style={styles.hero}>
        <View style={styles.heroShade} />
        <View style={styles.heroBody}>
          {store.logoUrl ? (
            <Image source={{ uri: store.logoUrl }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoNone]}>
              <Ionicons name="storefront" size={26} color={colors.gold400} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PRO SHOP · PINPALS APPROVED</Text>
            <Text style={styles.name}>{store.name}</Text>
            {store.clubName ? <Text style={styles.club}>{store.clubName}</Text> : null}
          </View>
        </View>
      </ImageBackground>

      <View style={styles.perks}>
        <Perk icon="bag-check-outline" label="Click & collect" />
        <Perk icon="cube-outline" label="Tracked post" />
        {store.offersFittings ? <Perk icon="construct-outline" label="Fittings" /> : null}
        <Perk icon="sparkles-outline" label="All new" />
      </View>

      {store.description ? <Text style={styles.description}>{store.description}</Text> : null}
      <Text style={styles.section}>{items.length > 0 ? `In stock · ${items.length}` : "In stock"}</Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: store.name, headerBackTitle: "Back" }} />
      <FlatList
        style={styles.fill}
        data={items}
        keyExtractor={(c) => String(c.id)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.muted}>Nothing listed just yet — check back soon.</Text>}
        renderItem={({ item }) => (
          <GearCard
            card={{ ...item, clubName: null }}
            onPress={() => router.push(`/listing/${item.id}`)}
            onFavourite={userId ? () => void favourite(item) : undefined}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.navy900}
          />
        }
      />
    </>
  );
}

function Perk({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.perk}>
      <Ionicons name={icon} size={18} color={colors.navy900} />
      <Text style={styles.perkLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  content: { paddingBottom: spacing.xl * 2 },
  row: { gap: GRID_GAP, paddingHorizontal: spacing.md, marginBottom: spacing.md },

  hero: { height: 210, justifyContent: "flex-end" },
  heroShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(12,32,56,0.55)" },
  heroBody: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  logo: { width: 60, height: 60, borderRadius: 14, borderWidth: 2, borderColor: colors.gold400 },
  logoNone: { backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2, color: colors.gold400 },
  name: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50, marginTop: 2 },
  club: { fontFamily: fonts.body, fontSize: type.small, color: "rgba(255,255,255,0.85)" },

  perks: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: spacing.md, paddingBottom: 0 },
  perk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: "#f3ead2",
  },
  perkLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },

  description: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink900, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  section: { fontSize: 20, fontWeight: "800", color: colors.navy900, paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  muted: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, paddingHorizontal: spacing.md },

  emptyTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, textAlign: "center" },
});
