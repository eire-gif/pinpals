import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import {
  SALE_TYPE_LABELS,
  getListingDetail,
  isAuction,
  money,
  setFavourite,
  type ListingDetail,
} from "@/lib/marketplace";
import { conversationWith } from "@/lib/members";
import {
  ACTION_LABELS,
  actionsFor,
  publishListing,
  setListingStatus,
  type ListingAction,
  type ListingStatus,
} from "@/lib/listings";
import { ApiError } from "@/lib/api";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * One listing.
 *
 * Everything a member reads before deciding is native: the photos, the price,
 * the specs, the seller and their rating. Everything that moves money is not.
 *
 * Buy now opens Stripe Checkout, which has to be a real browser. Offers and
 * bids have state machines, reservation timers and notifications behind
 * them, and a second implementation of any of that is how two systems start
 * disagreeing about who owns a club. All three open the site's own page,
 * signed in, through the web view — so the member never leaves the app.
 */
const GALLERY_WIDTH = Dimensions.get("window").width;

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [photo, setPhoto] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const numeric = Number.parseInt(String(id), 10);
    if (!Number.isFinite(numeric)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const row = await getListingDetail(numeric, userId);
      if (!row) setNotFound(true);
      setListing(row);
    } finally {
      setLoading(false);
    }
  }, [id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function favourite() {
    if (!listing || !userId) return;
    const next = !listing.isFavourited;
    setListing({ ...listing, isFavourited: next });
    await setFavourite(listing.id, userId, next);
  }

  async function message() {
    if (!listing?.seller) return;
    setBusy(true);
    try {
      router.push(`/conversation/${await conversationWith(listing.seller.id)}`);
    } catch {
      // can_message() said no, or the network did. Falling back to the
      // listing page on the site, where the same button explains why.
      openOnSite();
    } finally {
      setBusy(false);
    }
  }

  const openOnSite = useCallback(() => {
    if (!listing) return;
    router.push({
      pathname: "/web",
      params: { path: `/marketplace/${listing.id}`, title: listing.title },
    });
  }, [listing]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  if (notFound || !listing) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Listing", headerBackTitle: "Back" }} />
        <Ionicons name="pricetag-outline" size={44} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Listing not available</Text>
        <Text style={styles.emptyBody}>
          It may have sold, been removed, or never been published.
        </Text>
      </View>
    );
  }

  const auction = isAuction(listing.saleType);
  const price = auction ? listing.currentBidCents : listing.priceCents;

  return (
    <>
      <Stack.Screen
        options={{
          title: listing.title,
          headerBackTitle: "Back",
          headerRight: () =>
            userId ? (
              <Pressable
                onPress={() => void favourite()}
                hitSlop={12}
                style={{ paddingHorizontal: spacing.md }}
                accessibilityLabel={
                  listing.isFavourited ? "Remove from saved" : "Save this listing"
                }
              >
                <Ionicons
                  name={listing.isFavourited ? "heart" : "heart-outline"}
                  size={23}
                  color={listing.isFavourited ? colors.red600 : colors.green700}
                />
              </Pressable>
            ) : null,
        }}
      />

      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        {listing.images.length > 0 ? (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) =>
                setPhoto(Math.round(event.nativeEvent.contentOffset.x / GALLERY_WIDTH))
              }
            >
              {listing.images.map((url) => (
                <Image key={url} source={{ uri: url }} style={styles.photo} />
              ))}
            </ScrollView>

            {listing.images.length > 1 && (
              <View style={styles.dots}>
                {listing.images.map((url, index) => (
                  <View key={url} style={[styles.dot, index === photo && styles.dotOn]} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.photo, styles.photoNone]}>
            <Ionicons name="image-outline" size={34} color={colors.ink500} />
          </View>
        )}

        <View style={styles.body}>
          <Text style={styles.eyebrow}>
            {[listing.category, listing.subcategory].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.title}>{listing.title}</Text>

          {listing.model || listing.brandOther ? (
            <Text style={styles.model}>{listing.brandOther ?? listing.model}</Text>
          ) : null}

          <View style={styles.priceRow}>
            <View>
              {auction && <Text style={styles.priceLabel}>Current bid</Text>}
              <Text style={styles.price}>{money(price) || "No bids yet"}</Text>
            </View>
            <View style={styles.saleTag}>
              <Text style={styles.saleTagLabel}>
                {SALE_TYPE_LABELS[listing.saleType] ?? listing.saleType}
              </Text>
            </View>
          </View>

          <View style={styles.pills}>
            {[listing.condition, listing.county].filter(Boolean).map((value) => (
              <View key={String(value)} style={styles.pill}>
                <Text style={styles.pillLabel}>{value}</Text>
              </View>
            ))}
            {listing.status !== "active" && (
              <View style={[styles.pill, styles.pillWarn]}>
                <Text style={[styles.pillLabel, styles.pillWarnLabel]}>{listing.status}</Text>
              </View>
            )}
          </View>

          {listing.specs.length > 0 && (
            <View style={styles.panel}>
              {listing.specs.map((spec) => (
                <View key={spec.label} style={styles.spec}>
                  <Text style={styles.specLabel}>{spec.label}</Text>
                  <Text style={styles.specValue}>{spec.value}</Text>
                </View>
              ))}
            </View>
          )}

          {listing.description ? (
            <Text style={styles.description}>{listing.description}</Text>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.sectionLabel}>Delivery</Text>
            {listing.deliveryOptions.includes("post") && (
              <Row icon="cube-outline" label="Can be posted" />
            )}
            {listing.deliveryOptions.includes("collection") && (
              <Row icon="walk-outline" label="Collection in person" />
            )}
            {listing.collectionNotes ? (
              <Text style={styles.notes}>{listing.collectionNotes}</Text>
            ) : null}
          </View>

          {listing.seller && (
            <View style={styles.panel}>
              <Text style={styles.sectionLabel}>Seller</Text>
              <View style={styles.seller}>
                <Avatar
                  url={null}
                  color={listing.seller.avatarColor}
                  name={listing.seller.name}
                  size={44}
                />
                <View style={styles.sellerBody}>
                  <Text style={styles.sellerName}>{listing.seller.name}</Text>
                  <Text style={styles.sellerMeta} numberOfLines={1}>
                    {listing.seller.homeClub ?? "No club set"}
                  </Text>
                  {listing.seller.reviewCount > 0 && listing.seller.rating !== null ? (
                    <Text style={styles.sellerMeta}>
                      ★ {listing.seller.rating.toFixed(1)} · {listing.seller.reviewCount}{" "}
                      {listing.seller.reviewCount === 1 ? "review" : "reviews"}
                    </Text>
                  ) : (
                    <Text style={styles.sellerMeta}>No reviews yet</Text>
                  )}
                </View>
              </View>

              {!listing.isMine && (
                <Pressable
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => void message()}
                  accessibilityRole="button"
                >
                  {busy ? (
                    <ActivityIndicator color={colors.green700} size="small" />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-outline" size={17} color={colors.green700} />
                      <Text style={styles.secondaryLabel}>Message the seller</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          )}

          {listing.isMine ? (
            <SellerControls
              listingId={listing.id}
              status={listing.status}
              userId={userId}
              onChanged={load}
              onEdit={openOnSite}
            />
          ) : (
            <>
              {/* The money. Deliberately one button to one place: the
                  listing's own page on the site, opened signed in. Buy needs
                  Stripe Checkout in a real browser, and offers and bids carry
                  state the app has no business keeping a second copy of. */}
              <Pressable style={styles.primary} onPress={openOnSite} accessibilityRole="button">
                <Text style={styles.primaryLabel}>
                  {auction
                    ? "Place a bid"
                    : listing.saleType === "offers_allowed"
                      ? "Buy or make an offer"
                      : "Buy now"}
                </Text>
                <Ionicons name="arrow-forward" size={18} color={colors.cream50} />
              </Pressable>

              <Text style={styles.footnote}>
                Payment is handled securely on pinpals.ie — you stay signed in.
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    </>
  );
}

/**
 * What the seller can do with their own listing, now that most of it happens
 * in the app rather than on the website.
 *
 * The buttons offered come from actionsFor(), which mirrors
 * validate_listing_status_transition() (0045) — the trigger is what actually
 * decides, so offering anything else would be offering a button that fails.
 *
 * Putting a draft on sale is the one that goes through the site's API rather
 * than the table: the trigger forbids a member moving draft -> active, and
 * Stripe has to say the seller can be paid first. Everything else is a plain
 * update the policy already allows.
 *
 * Editing the listing itself still opens the website. Photos, auctions and
 * price changes reach into Storage and into live offer state, and that is a
 * bigger thing than a status change.
 */
function SellerControls({
  listingId,
  status,
  userId,
  onChanged,
  onEdit,
}: {
  listingId: number;
  status: string;
  userId: string | null;
  onChanged: () => void | Promise<void>;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = actionsFor(status as ListingStatus);

  async function run(action: ListingAction) {
    if (!userId) return;
    setError(null);
    setBusy(true);
    try {
      if (action === "publish") {
        await publishListing(listingId);
      } else {
        const next = action === "sold" ? "sold" : action === "remove" ? "removed" : "active";
        const message = await setListingStatus(listingId, userId, next);
        if (message) {
          setError(message);
          return;
        }
      }
      await onChanged();
    } catch (err) {
      // The publish route's 422 carries a sentence worth showing — "finish
      // setting up payouts" is the whole answer to why the button didn't work.
      setError(
        err instanceof ApiError ? err.message : "Couldn't do that just now. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  function confirm(action: ListingAction) {
    if (action === "publish") {
      void run(action);
      return;
    }
    const destructive = action === "remove";
    Alert.alert(
      action === "sold" ? "Mark as sold?" : action === "remove" ? "Remove this listing?" : "Put it back on sale?",
      action === "sold"
        ? "It stops being for sale and any open offers are closed."
        : action === "remove"
          ? "It disappears from the marketplace. This can't be undone from the app."
          : undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: ACTION_LABELS[action],
          style: destructive ? "destructive" : "default",
          onPress: () => void run(action),
        },
      ]
    );
  }

  return (
    <View style={styles.sellerBox}>
      {error ? <Text style={styles.sellerError}>{error}</Text> : null}

      {actions.map((action, index) => (
        <Pressable
          key={action}
          style={[
            index === 0 ? styles.primary : styles.secondary,
            busy && styles.sellerBusy,
          ]}
          onPress={() => confirm(action)}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={index === 0 ? styles.primaryLabel : styles.secondaryLabel}>
            {ACTION_LABELS[action]}
          </Text>
        </Pressable>
      ))}

      <Pressable style={styles.secondary} onPress={onEdit} accessibilityRole="button">
        <Ionicons name="create-outline" size={17} color={colors.green700} />
        <Text style={styles.secondaryLabel}>Edit details and photos</Text>
      </Pressable>

      <Text style={styles.footnote}>
        {actions.includes("publish")
          ? "Putting it on sale needs your Stripe payouts set up, so a buyer can actually pay you."
          : "Editing photos, price and auctions still opens the website."}
      </Text>
    </View>
  );
}

function Row({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.green700} />
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  content: { paddingBottom: spacing.xl },

  photo: { width: GALLERY_WIDTH, height: GALLERY_WIDTH, backgroundColor: colors.surfaceTint },
  photoNone: { alignItems: "center", justifyContent: "center" },
  dots: {
    position: "absolute",
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  dotOn: { backgroundColor: colors.cream50, width: 16 },

  body: { padding: spacing.md, gap: spacing.md },

  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.ink500,
  },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink900, marginTop: -8 },
  model: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink500, marginTop: -10 },

  priceRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  priceLabel: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  price: { fontFamily: fonts.display, fontSize: 30, color: colors.green700 },
  saleTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
  },
  saleTagLabel: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.green700 },

  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pillLabel: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900 },
  pillWarn: { backgroundColor: colors.red100, borderColor: colors.red100 },
  pillWarnLabel: { color: colors.red600, textTransform: "capitalize" },

  panel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.ink500,
  },

  spec: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  specLabel: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  specValue: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },

  description: {
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 23,
    color: colors.ink900,
  },

  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowLabel: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  notes: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  seller: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sellerBody: { flex: 1, gap: 1 },
  sellerName: { fontFamily: fonts.display, fontSize: 18, color: colors.ink900 },
  sellerMeta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  secondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.green600,
  },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },

  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },

  sellerBox: { gap: spacing.sm },
  sellerBusy: { opacity: 0.45 },
  sellerError: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.red600,
    paddingBottom: 2,
  },

  footnote: {
    fontFamily: fonts.body,
    fontSize: type.label,
    color: colors.ink500,
    textAlign: "center",
  },

  emptyTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900, textAlign: "center" },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
});
