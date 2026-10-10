import { Dimensions, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { CATEGORY_TILES } from "@/lib/listing-icons";
import { isAuction, priceLine, type Card } from "@/lib/marketplace";
import { kmLabel } from "@/lib/used-gear";
import { colors, fonts, radii } from "@/lib/theme";

/** Grids are two columns, 16 in from each edge, 12 between. */
export const GRID_GAP = 12;
const GRID_COLUMN = (Dimensions.get("window").width - 32 - GRID_GAP) / 2;

/**
 * One item in the marketplace (Oct 2026 redesign): a big soft photo tile,
 * the price large in navy, then title, condition and where to collect it,
 * and the Buyer Protection tick. Gold "Featured" for paid placements, green
 * "New" for shop stock.
 */
export function GearCard({
  card,
  width,
  onPress,
  onFavourite,
}: {
  card: Card;
  /** Fixed width in a rail; omit to fill a grid column. */
  width?: number;
  onPress: () => void;
  onFavourite?: () => void;
}) {
  const price = priceLine(card);
  const where = [card.clubName ? `Collect at ${card.clubName}` : null, kmLabel(card.distanceKm)].filter(Boolean).join(" · ");
  const icon = CATEGORY_TILES.find((t) => t.key === card.category)?.icon ?? "golf";
  const badge = card.featured
    ? { text: "Featured", bg: colors.gold400, fg: colors.navy900 }
    : card.storeId
      ? { text: "New", bg: colors.green700, fg: colors.cream50 }
      : isAuction(card.saleType)
        ? { text: "Auction", bg: colors.navy900, fg: colors.cream50 }
        : null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [width ? { width } : styles.fill, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel={`${card.title}, ${price.value}`}>
      <View style={styles.photo}>
        {card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.image} />
        ) : (
          <MaterialCommunityIcons name={icon} size={46} color={colors.ink500} />
        )}
        {badge ? (
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.text}</Text>
          </View>
        ) : null}
        {onFavourite ? (
          <Pressable onPress={onFavourite} hitSlop={8} style={styles.heart} accessibilityRole="button" accessibilityLabel={card.isFavourited ? "Remove from saved" : "Save"}>
            <Ionicons name={card.isFavourited ? "heart" : "heart-outline"} size={16} color={card.isFavourited ? colors.red600 : colors.ink900} />
          </Pressable>
        ) : null}
      </View>
      {price.label ? <Text style={styles.priceLabel}>{price.label}</Text> : null}
      <Text style={styles.price}>{price.value || "—"}</Text>
      <Text style={styles.title} numberOfLines={2}>
        {card.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {[card.condition, card.stockQuantity != null && card.stockQuantity > 1 ? `${card.stockQuantity} in stock` : null].filter(Boolean).join(" · ")}
      </Text>
      {where ? (
        <Text style={styles.meta} numberOfLines={1}>
          {where}
        </Text>
      ) : null}
      {!card.storeId ? <Text style={styles.protect}>✓ Buyer Protection</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A fixed column width, so a lone last card keeps its size.
  fill: { width: GRID_COLUMN },
  photo: { aspectRatio: 1, borderRadius: radii.lg, backgroundColor: "#eef0ee", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  badge: { position: "absolute", top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" },
  heart: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.92)" },
  priceLabel: { fontFamily: fonts.body, fontSize: 10.5, color: colors.ink500, marginTop: 7 },
  price: { fontSize: 19, fontWeight: "800", color: colors.navy900, marginTop: 2 },
  title: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 18, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 2 },
  protect: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.green700, marginTop: 3 },
});
