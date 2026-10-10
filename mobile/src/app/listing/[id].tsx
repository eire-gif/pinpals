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
import { GoldButton } from "@/components/gold-button";
import { PurchasePanel } from "@/components/purchase-panel";
import { buyerProtectionFee, eur, sweepMarketplace } from "@/lib/purchase";
import { shortClub } from "@/lib/used-gear";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * One listing.
 *
 * Native throughout, including buying: Buy now, offers, counter-offers and
 * bids all happen here (components/purchase-panel.tsx), through routes that
 * call the same operations as the website — so there is still one
 * implementation of the offer and auction state machines, on the server.
 * The one step that opens the website is Stripe's card form, at the end.
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
      // Bring offers, reservations and auctions up to date first, as the
      // website does on every marketplace page — otherwise a lapsed
      // reservation would read as "under offer" until someone opened the site.
      if (userId) await sweepMarketplace();
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
  const shop = listing.store;
  const featured = !!listing.featuredUntil && Date.parse(listing.featuredUntil) > Date.now();
  const canMeet = listing.deliveryOptions.includes("collection");
  const canPost = listing.deliveryOptions.includes("post");
  const fee = price !== null ? buyerProtectionFee(price / 100) : null;
  const meetAt = shop?.clubName ?? listing.seller?.homeClub ?? null;

  return (
    <>
      <Stack.Screen
        options={{
          title: shop ? shop.name : "Used gear",
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
                  color={listing.isFavourited ? colors.red600 : colors.navy900}
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
        {featured || shop ? (
          <View style={[styles.badge, shop ? styles.badgeNew : styles.badgeFeatured]}>
            <Text style={[styles.badgeText, shop ? styles.badgeTextNew : null]}>{shop ? "New" : "Featured"}</Text>
          </View>
        ) : null}

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
            {[
              listing.condition,
              listing.specs.find((x) => x.label === "Dexterity")?.value,
              shop && listing.stockQuantity != null ? `${listing.stockQuantity} in stock` : null,
            ]
              .filter(Boolean)
              .map((value) => (
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

          {/* -------- How you'll get it (mock-up 3) -------- */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How you&apos;ll get it</Text>
            {canMeet ? (
              <Way
                icon="golf-outline"
                title={shop ? "Collect from the pro shop" : "Meet at the club"}
                body={
                  meetAt
                    ? `${shortClub(meetAt)} — ${shop ? "pick it up at the counter" : "hand over in person, show your code"}`
                    : "Hand over in person and show your code"
                }
                tag="Free"
              />
            ) : null}
            {canPost ? (
              <Way icon="cube-outline" title="Tracked post" body="Seller posts it with tracking — pay postage at checkout" />
            ) : null}
            {listing.collectionNotes ? <Text style={styles.notes}>{listing.collectionNotes}</Text> : null}
          </View>

          {/* -------- Buyer Protection -------- */}
          {!shop && !listing.isMine ? (
            <View style={[styles.card, styles.protectCard]}>
              <View style={styles.protectHead}>
                <Ionicons name="shield-checkmark" size={22} color={colors.green700} />
                <Text style={styles.cardTitle}>Buyer Protection{fee !== null ? ` · ${eur(fee)}` : ""}</Text>
              </View>
              <Tick text="Your money is held until you have the item" />
              <Tick text="Meet-ups confirmed with a handover code" />
              <Tick text="Refund if it isn't as described" />
            </View>
          ) : null}

          {listing.specs.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Details</Text>
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

          {/* -------- Who's selling -------- */}
          {shop ? (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => router.push({ pathname: "/store/[id]", params: { id: shop.slug } })}
              accessibilityRole="button"
              accessibilityLabel={`Visit ${shop.name}`}
            >
              <View style={styles.seller}>
                {shop.logoUrl ? (
                  <Image source={{ uri: shop.logoUrl }} style={styles.shopLogo} />
                ) : (
                  <View style={[styles.shopLogo, styles.shopLogoNone]}>
                    <Ionicons name="storefront" size={20} color={colors.gold400} />
                  </View>
                )}
                <View style={styles.sellerBody}>
                  <Text style={styles.sellerName}>{shop.name}</Text>
                  <Text style={styles.sellerMeta}>✓ PinPals approved pro shop</Text>
                  {shop.clubName ? <Text style={styles.sellerMeta}>{shop.clubName}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              </View>
            </Pressable>
          ) : listing.seller ? (
            <View style={styles.card}>
              <View style={styles.seller}>
                <Avatar
                  url={null}
                  color={listing.seller.avatarColor}
                  name={listing.seller.name}
                  size={48}
                />
                <View style={styles.sellerBody}>
                  <Text style={styles.sellerName}>{listing.seller.name}</Text>
                  <Text style={styles.sellerMeta} numberOfLines={1}>
                    {listing.seller.homeClub ?? "No club set"}
                  </Text>
                </View>
              </View>
              <View style={styles.trust}>
                <Trust
                  value={
                    listing.seller.reviewCount > 0 && listing.seller.rating !== null
                      ? `★ ${listing.seller.rating.toFixed(1)}`
                      : "New"
                  }
                  label={
                    listing.seller.reviewCount > 0
                      ? `${listing.seller.reviewCount} ${listing.seller.reviewCount === 1 ? "review" : "reviews"}`
                      : "seller"
                  }
                />
                <Trust value={memberSince(listing.seller.memberSince)} label="member since" />
                <Trust value={listing.seller.homeClub ? "✓" : "—"} label="club member" />
              </View>

              {!listing.isMine && (
                <Pressable
                  style={styles.secondary}
                  disabled={busy}
                  onPress={() => void message()}
                  accessibilityRole="button"
                >
                  {busy ? (
                    <ActivityIndicator color={colors.navy900} size="small" />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-outline" size={17} color={colors.navy900} />
                      <Text style={styles.secondaryLabel}>Message {listing.seller.name.split(" ")[0]}</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          ) : null}

          {listing.isMine ? (
            <>
              {listing.status === "active" && !shop ? (
                // Information only, no link: a promotion is a digital
                // service, so under App Store rule 3.1.1 it is bought on the
                // website, never inside the app (not even its web view).
                <View style={styles.promote}>
                  <Ionicons name="rocket-outline" size={20} color={colors.gold400} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.promoteTitle}>
                      {featured ? "Featured — showing at the top" : "Want it seen first?"}
                    </Text>
                    <Text style={styles.promoteBody}>
                      {featured
                        ? `Until ${new Date(listing.featuredUntil ?? "").toLocaleDateString("en-IE", { day: "numeric", month: "short" })}.`
                        : "Feature or bump it from My listings on the PinPals website."}
                    </Text>
                  </View>
                </View>
              ) : null}
              <SellerControls
                listingId={listing.id}
                status={listing.status}
                userId={userId}
                onChanged={load}
                onEdit={openOnSite}
              />
            </>
          ) : userId ? (
            // Buy now, offers and bids, native. See purchase-panel.tsx.
            <PurchasePanel listing={listing} userId={userId} onChanged={() => void load()} />
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

function memberSince(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IE", { month: "short", year: "numeric" });
}

function Way({ icon, title, body, tag }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; tag?: string }) {
  return (
    <View style={styles.way}>
      <View style={styles.wayIcon}>
        <Ionicons name={icon} size={20} color={colors.navy900} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.wayTitle}>{title}</Text>
        <Text style={styles.wayBody}>{body}</Text>
      </View>
      {tag ? <Text style={styles.wayTag}>{tag}</Text> : null}
    </View>
  );
}

function Tick({ text }: { text: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name="checkmark-circle" size={17} color={colors.green700} />
      <Text style={styles.tickLabel}>{text}</Text>
    </View>
  );
}

function Trust({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.trustCell}>
      <Text style={styles.trustValue}>{value}</Text>
      <Text style={styles.trustLabel}>{label}</Text>
    </View>
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
      {status === "draft" ? (
        <View style={styles.draftNote}>
          <Ionicons name="eye-off-outline" size={18} color={colors.navy900} />
          <Text style={styles.draftNoteText}>Only you can see this draft. Check it over, then put it on sale.</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.sellerError}>{error}</Text> : null}
      {error && /payout/i.test(error) ? (
        // The fix for "can't be paid yet": Stripe's setup, from Payouts.
        <GoldButton label="Set up payouts" onPress={() => router.push("/payouts")} />
      ) : null}

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
        <Ionicons name="create-outline" size={17} color={colors.navy900} />
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
  price: { fontSize: 32, fontWeight: "800", color: colors.navy900 },
  saleTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.navy900,
  },
  saleTagLabel: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.gold400 },

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

  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    shadowColor: colors.navy900,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: "800", color: colors.navy900 },
  protectCard: { backgroundColor: colors.green100 },
  protectHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  tickLabel: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, flex: 1 },

  way: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  wayIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#f3ead2", alignItems: "center", justifyContent: "center" },
  wayTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  wayBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginTop: 1 },
  wayTag: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.green700 },

  badge: { position: "absolute", top: 14, left: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  badgeFeatured: { backgroundColor: colors.gold400 },
  badgeNew: { backgroundColor: colors.green700 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: colors.navy900 },
  badgeTextNew: { color: colors.cream50 },

  shopLogo: { width: 48, height: 48, borderRadius: 12 },
  shopLogoNone: { backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },

  trust: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.sm },
  trustCell: { flex: 1, alignItems: "center" },
  trustValue: { fontSize: 16, fontWeight: "800", color: colors.navy900 },
  trustLabel: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500, marginTop: 1 },

  promote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.navy900,
  },
  promoteTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  promoteBody: { fontFamily: fonts.body, fontSize: type.small, color: "rgba(255,255,255,0.75)", marginTop: 1 },

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
    borderWidth: 1.5,
    borderColor: colors.navy900,
  },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },

  primary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.navy900,
  },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.gold400 },

  sellerBox: { gap: spacing.sm },
  draftNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.md, borderRadius: radii.lg, backgroundColor: "#f3ead2" },
  draftNoteText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
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
