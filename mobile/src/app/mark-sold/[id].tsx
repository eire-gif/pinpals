import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import { useAuth } from "@/lib/auth";
import { parsePrice } from "@/lib/listings";
import { getListingDetail, money, type ListingDetail } from "@/lib/marketplace";
import { CashError, markSold, possibleBuyers, type PossibleBuyer } from "@/lib/marketplace-cash";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Mark as sold (mock-up 6).
 *
 * "Who bought it?" from the people the seller has chatted with — this
 * listing's chats first — or "Sold somewhere else". Naming the buyer is what
 * opens feedback for both of them; the database only lets the seller name
 * someone they've actually messaged (mark_listing_sold, 0160).
 *
 * The final price is optional and private: it feeds the "similar items sold
 * for" guide as an average, never against anyone's name.
 */
const ELSEWHERE = "elsewhere";

export default function MarkSoldScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingId = Number.parseInt(String(id), 10);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [buyers, setBuyers] = useState<PossibleBuyer[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(listingId)) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const [row, people] = await Promise.all([getListingDetail(listingId, userId), possibleBuyers(listingId)]);
        setListing(row);
        setBuyers(people);
        // The person already talking about this listing is the likely buyer.
        if (people[0]?.aboutListing) setPicked(people[0].id);
        if (row?.priceCents) setPrice(String(Math.round(row.priceCents / 100)));
      } catch (err) {
        setError(err instanceof CashError ? err.message : "Couldn't load that listing.");
      } finally {
        setLoading(false);
      }
    })();
  }, [listingId, userId]);

  async function submit() {
    if (!picked) {
      setError("Pick who bought it, or Sold somewhere else.");
      return;
    }
    const euros = price.trim() ? parsePrice(price) : null;
    if (price.trim() && euros === null) {
      setError("That price doesn't look right — or leave it blank.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const buyerId = picked === ELSEWHERE ? null : picked;
      const saleId = await markSold(listingId, buyerId, euros === null ? null : Math.round(euros * 100));
      if (buyerId) {
        router.replace({ pathname: "/feedback/[id]", params: { id: String(saleId) } });
      } else {
        Alert.alert("Marked as sold", "It's off the marketplace. Nice one.");
        router.back();
      }
    } catch (err) {
      setError(err instanceof CashError ? err.message : "Couldn't mark it sold. Please try again.");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Mark as sold", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  if (!listing || !listing.isMine) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Mark as sold", headerBackTitle: "Back" }} />
        <Text style={styles.emptyTitle}>Listing not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Mark as sold", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.content} {...FORM_SCROLL_KEYBOARD}>
        <View style={styles.item}>
          {listing.images[0] ? <Image source={{ uri: listing.images[0] }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbNone]} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {listing.title}
            </Text>
            {listing.priceCents ? <Text style={styles.itemMeta}>Listed at {money(listing.priceCents)}</Text> : null}
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>Who bought it?</Text>
          <Text style={styles.sub}>Pick the buyer so you can both leave feedback.</Text>
        </View>

        <View style={styles.options} accessibilityRole="radiogroup">
          {buyers.map((b) => (
            <Option key={b.id} on={picked === b.id} onPress={() => setPicked(b.id)} label={b.name} note={b.aboutListing ? "Messaged you about this" : chatted(b.lastMessageAt)}>
              <Avatar url={b.avatarUrl} color={b.avatarColor} name={b.name} size={40} />
            </Option>
          ))}
          <Option on={picked === ELSEWHERE} onPress={() => setPicked(ELSEWHERE)} label="Sold somewhere else" note="No feedback either way">
            <View style={styles.elsewhereIcon}>
              <Ionicons name="storefront-outline" size={20} color={colors.navy900} />
            </View>
          </Option>
          {buyers.length === 0 ? (
            <Text style={styles.hint}>Nobody has messaged you on PinPals yet. If the buyer is on PinPals, ask them to send you a message first.</Text>
          ) : null}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Final price (optional, private)</Text>
          <View style={styles.priceBox}>
            <Text style={styles.euro}>€</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              style={styles.priceInput}
              placeholder="0"
              placeholderTextColor={colors.ink500}
              accessibilityLabel="Final price in euro"
            />
          </View>
          <Text style={styles.hint}>Helps the price guide. Never shown with your name.</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={() => void submit()}
          disabled={busy}
          style={[styles.primary, busy && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={colors.gold400} /> : <Text style={styles.primaryLabel}>Mark as sold</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function chatted(iso: string | null): string {
  if (!iso) return "Chatted on PinPals";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Messaged today";
  if (days === 1) return "Messaged yesterday";
  if (days < 30) return `Messaged ${days} days ago`;
  return "Chatted on PinPals";
}

function Option({ on, onPress, label, note, children }: { on: boolean; onPress: () => void; label: string; note: string; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, on && styles.optionOn]}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${label}. ${note}`}
    >
      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? colors.green700 : colors.ink500} />
      {children}
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionNote}>{note}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  item: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: radii.md },
  thumbNone: { backgroundColor: colors.surfaceTint },
  itemTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  itemMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  heading: { fontFamily: fonts.display, fontSize: 26, color: colors.navy900 },
  sub: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  options: { gap: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  optionOn: { borderWidth: 2, borderColor: colors.green700 },
  optionLabel: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  optionNote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  elsewhereIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  priceBox: { flexDirection: "row", alignItems: "center", gap: 6, height: 50, paddingHorizontal: 14, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  euro: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  priceInput: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  primary: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.gold400 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
});
