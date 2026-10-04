import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import {
  OFFER_STATUS_LABELS,
  deadlineLabel,
  euro,
  listMyBids,
  listMyOffers,
  listPurchases,
  listReviewable,
  listSaved,
  submitReview,
  type MyBid,
  type MyOffer,
  type Purchase,
  type Reviewable,
  type SavedItem,
} from "@/lib/buying";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, cents, shortDate, timeRemaining } from "@/lib/selling";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE, KEYBOARD_DONE_ID, KeyboardDoneBar } from "@/components/keyboard";

/**
 * My buying — what you've bought, what you've offered, what you've saved,
 * and who you still owe a review.
 *
 * Read-only apart from reviews, which are a plain insert the database
 * already polices. Finishing checkout and answering a counter-offer are
 * native (app/checkout.tsx, the listing screen); paying opens Stripe's card
 * form on the website inside the app, until a build carries Stripe's SDK.
 *
 * The Purchases tab leads with what the member has to DO. An order waiting
 * on payment with a reservation ticking down is the only thing on this screen
 * that can be missed, so it gets the one coloured button.
 */

const TABS = [
  { key: "purchases", label: "Purchases" },
  { key: "offers", label: "Offers & bids" },
  { key: "saved", label: "Saved" },
  { key: "reviews", label: "Reviews" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type Data = {
  purchases: Purchase[];
  offers: MyOffer[];
  bids: MyBid[];
  saved: SavedItem[];
  reviewable: Reviewable[];
};

const EMPTY: Data = { purchases: [], offers: [], bids: [], saved: [], reviewable: [] };

export default function BuyingScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [data, setData] = useState<Data>(EMPTY);
  const [tab, setTab] = useState<TabKey>("purchases");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [purchases, offers, bids, saved, reviewable] = await Promise.all([
        listPurchases(userId),
        listMyOffers(userId),
        listMyBids(userId),
        listSaved(userId),
        listReviewable(userId),
      ]);
      setData({ purchases, offers, bids, saved, reviewable });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // Paying happens on the website in a web view this screen pushed, so coming
  // back has to re-read rather than show the order as still unpaid.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const awaiting = data.purchases.filter((p) => p.nextAction !== null).length;
  const toReview = data.reviewable.filter((r) => !r.reviewed).length;

  const counts: Record<TabKey, number> = {
    purchases: awaiting,
    offers: data.offers.length + data.bids.length,
    saved: data.saved.length,
    reviews: toReview,
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />

      <ScreenHeader
        scene="dunesGold"
        title="My buying"
        subtitle={
          loading
            ? "Loading"
            : awaiting > 0
              ? awaiting === 1
                ? "1 order needs you"
                : `${awaiting} orders need you`
              : data.purchases.length === 0
                ? "Nothing bought yet"
                : `${data.purchases.length} ${data.purchases.length === 1 ? "purchase" : "purchases"}`
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabStrip}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map((entry) => {
          const active = tab === entry.key;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setTab(entry.key)}
              style={[styles.tab, active && styles.tabOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelOn]}>
                {entry.label}
                {counts[entry.key] > 0 ? ` ${counts[entry.key]}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <Body
          tab={tab}
          data={data}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          onReviewed={() => void load()}
        />
      )}
    </View>
  );
}

const openSite = (path: string, title: string) =>
  router.push({ pathname: "/web", params: { path, title } });

function Body({
  tab,
  data,
  refreshing,
  onRefresh,
  onReviewed,
}: {
  tab: TabKey;
  data: Data;
  refreshing: boolean;
  onRefresh: () => void;
  onReviewed: () => void;
}) {
  const refresh = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green700} />
  );

  if (tab === "purchases") {
    return (
      <FlatList keyboardDismissMode={KEYBOARD_DISMISS_MODE}
        style={styles.fill}
        contentContainerStyle={styles.list}
        data={data.purchases}
        keyExtractor={(item) => String(item.id)}
        refreshControl={refresh}
        ListEmptyComponent={
          <Empty
            icon="bag-outline"
            title="Nothing bought yet"
            body="Anything you buy from another member shows up here, with whatever it still needs from you."
            action="Browse the marketplace"
            onPress={() => router.push("/marketplace")}
          />
        }
        renderItem={({ item }) => <PurchaseRow purchase={item} />}
      />
    );
  }

  if (tab === "offers") {
    return (
      <FlatList keyboardDismissMode={KEYBOARD_DISMISS_MODE}
        style={styles.fill}
        contentContainerStyle={styles.list}
        data={data.offers}
        keyExtractor={(item) => String(item.id)}
        refreshControl={refresh}
        ListFooterComponent={<Bids bids={data.bids} />}
        ListEmptyComponent={
          data.bids.length === 0 ? (
            <Empty
              icon="chatbubble-ellipses-outline"
              title="No offers or bids"
              body="Offers you've made and auctions you're bidding in show up here."
            />
          ) : null
        }
        renderItem={({ item }) => <OfferRow offer={item} />}
      />
    );
  }

  if (tab === "saved") {
    return (
      <FlatList keyboardDismissMode={KEYBOARD_DISMISS_MODE}
        style={styles.fill}
        contentContainerStyle={styles.list}
        data={data.saved}
        keyExtractor={(item) => String(item.listingId)}
        refreshControl={refresh}
        ListEmptyComponent={
          <Empty
            icon="heart-outline"
            title="Nothing saved"
            body="Tap the heart on a listing and it waits for you here."
            action="Browse the marketplace"
            onPress={() => router.push("/marketplace")}
          />
        }
        renderItem={({ item }) => <SavedRow item={item} />}
      />
    );
  }

  return (
    <FlatList keyboardDismissMode={KEYBOARD_DISMISS_MODE}
      style={styles.fill}
      contentContainerStyle={styles.list}
      data={data.reviewable}
      keyExtractor={(item) => String(item.orderId)}
      refreshControl={refresh}
      ListEmptyComponent={
        <Empty
          icon="star-outline"
          title="No reviews to leave"
          body="Once an order is complete you can say how it went. It helps the next buyer."
        />
      }
      renderItem={({ item }) => <ReviewRow order={item} onDone={onReviewed} />}
    />
  );
}

function PurchaseRow({ purchase }: { purchase: Purchase }) {
  const deadline = deadlineLabel(purchase.nextAction?.deadlineIso ?? null);

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.cardTop}
        accessibilityRole="button"
        onPress={() => router.push(`/order/${purchase.id}`)}
      >
        <Thumb uri={purchase.imageUrl} />
        <View style={styles.cardBody}>
          <Text style={styles.title} numberOfLines={2}>
            {purchase.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {euro(purchase.totalEur)} · {shortDate(purchase.createdAt)}
          </Text>
          <View style={styles.pills}>
            <Pill label={ORDER_STATUS_LABELS[purchase.status]} />
            <Pill
              tone={purchase.paymentStatus === "paid" ? "green" : "plain"}
              label={PAYMENT_STATUS_LABELS[purchase.paymentStatus]}
            />
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
      </Pressable>

      {/* The only thing on this screen that can be missed. Payment is a
          Stripe iframe, so it opens the website inside the app. */}
      {purchase.nextAction ? (
        <Pressable
          style={styles.cta}
          onPress={() =>
            // Choosing delivery is native now; paying is still Stripe's
            // card form on the site.
            purchase.nextAction!.path.endsWith("/checkout")
              ? router.push({ pathname: "/checkout", params: { order: String(purchase.id) } })
              : openSite(purchase.nextAction!.path, "Pay securely")
          }
          accessibilityRole="button"
        >
          <Text style={styles.ctaLabel}>{purchase.nextAction.label}</Text>
          {deadline ? <Text style={styles.ctaNote}>{deadline}</Text> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

function OfferRow({ offer }: { offer: MyOffer }) {
  const live = offer.status === "pending" || offer.status === "countered";
  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/listing/${offer.listingId}`)}
    >
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {offer.listingTitle}
        </Text>
        <Text style={styles.amount}>{euro(offer.amountEur)}</Text>
        <Text style={styles.meta}>
          {OFFER_STATUS_LABELS[offer.status] ?? offer.status}
          {live ? ` · ${timeRemaining(offer.expiresAt)}` : ""}
        </Text>

        {offer.status === "countered" ? (
          <Pressable
            style={styles.cta}
            // The listing screen answers it natively (purchase-panel.tsx).
            onPress={() => router.push(`/listing/${offer.listingId}`)}
            accessibilityRole="button"
          >
            <Text style={styles.ctaLabel}>Answer the counter</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function Bids({ bids }: { bids: MyBid[] }) {
  if (bids.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Your bids</Text>
      {bids.map((bid) => (
        <Pressable
          key={bid.id}
          style={styles.card}
          accessibilityRole="button"
          onPress={() => router.push(`/listing/${bid.listingId}`)}
        >
          <View style={styles.cardBody}>
            <Text style={styles.title} numberOfLines={2}>
              {bid.listingTitle}
            </Text>
            <Text style={styles.amount}>{cents(bid.amountCents)}</Text>
            <View style={styles.pills}>
              <Pill
                tone={bid.leading ? "green" : "plain"}
                label={bid.leading ? "Leading" : "Outbid"}
              />
              <Pill
                label={
                  bid.auctionStatus === "live" ? timeRemaining(bid.endsAt) : "Auction ended"
                }
              />
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
        </Pressable>
      ))}
    </View>
  );
}

function SavedRow({ item }: { item: SavedItem }) {
  const gone = item.status !== "active";
  return (
    <Pressable
      style={[styles.card, styles.cardTop, gone && styles.cardDim]}
      accessibilityRole="button"
      onPress={() => router.push(`/listing/${item.listingId}`)}
    >
      <Thumb uri={item.imageUrl} />
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta}>
          {item.priceEur !== null ? euro(item.priceEur) : "Auction"}
          {gone ? " · no longer for sale" : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function ReviewRow({ order, onDone }: { order: Reviewable; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    setSaving(true);
    const message = await submitReview(order.orderId, order.sellerId, rating, body);
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setOpen(false);
    onDone();
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Thumb uri={order.imageUrl} />
        <View style={styles.cardBody}>
          <Text style={styles.title} numberOfLines={2}>
            {order.title}
          </Text>
          <Text style={styles.meta}>{euro(order.totalEur)}</Text>
        </View>
        {order.reviewed ? (
          <View style={[styles.pill, styles.pillGreen]}>
            <Text style={styles.pillLabel}>Reviewed</Text>
          </View>
        ) : null}
      </View>

      {!order.reviewed && !open ? (
        <Pressable style={styles.cta} onPress={() => setOpen(true)} accessibilityRole="button">
          <Text style={styles.ctaLabel}>Leave a review</Text>
        </Pressable>
      ) : null}

      {open ? (
        <View style={styles.reviewForm}>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                onPress={() => setRating(value)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`${value} star${value === 1 ? "" : "s"}`}
              >
                <Ionicons
                  name={value <= rating ? "star" : "star-outline"}
                  size={30}
                  color={value <= rating ? colors.gold500 : colors.ink500}
                />
              </Pressable>
            ))}
          </View>

          <KeyboardDoneBar />
          <TextInput
            style={styles.reviewInput}
            value={body}
            onChangeText={setBody}
            multiline
            inputAccessoryViewID={KEYBOARD_DONE_ID}
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={2000}
            placeholder="How did it go? Optional."
            placeholderTextColor={colors.ink500}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.reviewActions}>
            <Pressable
              style={styles.quiet}
              onPress={() => setOpen(false)}
              accessibilityRole="button"
            >
              <Text style={styles.quietLabel}>Not now</Text>
            </Pressable>
            <Pressable
              style={[styles.cta, styles.ctaGrow, (saving || rating === 0) && styles.ctaOff]}
              onPress={() => void send()}
              disabled={saving || rating === 0}
              accessibilityRole="button"
            >
              <Text style={styles.ctaLabel}>{saving ? "Sending…" : "Send review"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Thumb({ uri }: { uri: string | null }) {
  if (uri) return <Image source={{ uri }} style={styles.thumb} />;
  return (
    <View style={[styles.thumb, styles.thumbNone]}>
      <Ionicons name="image-outline" size={22} color={colors.ink500} />
    </View>
  );
}

function Pill({ label, tone = "plain" }: { label: string; tone?: "plain" | "green" }) {
  return (
    <View style={[styles.pill, tone === "green" && styles.pillGreen]}>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

function Empty({
  icon,
  title,
  body,
  action,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={42} color={colors.ink500} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action && onPress ? (
        <Pressable style={styles.cta} onPress={onPress} accessibilityRole="button">
          <Text style={styles.ctaLabel}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },

  tabStrip: { flexGrow: 0, flexShrink: 0 },
  tabs: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: 6,
  },
  tab: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  tabOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  tabLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  tabLabelOn: { color: colors.cream50 },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },

  section: { gap: spacing.sm, paddingTop: spacing.lg },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
  },

  card: {
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardDim: { opacity: 0.6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  thumb: { width: 62, height: 62, borderRadius: radii.sm, backgroundColor: colors.surfaceTint },
  thumbNone: { alignItems: "center", justifyContent: "center" },

  cardBody: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  amount: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900 },

  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.cream100,
  },
  pillGreen: { backgroundColor: colors.green100 },
  pillLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, color: colors.ink900 },

  cta: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaGrow: { flex: 1 },
  ctaOff: { opacity: 0.45 },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  ctaNote: { fontFamily: fonts.body, fontSize: type.label, color: colors.cream100, marginTop: 1 },

  reviewForm: { gap: spacing.sm },
  stars: { flexDirection: "row", gap: 6, paddingVertical: 2 },
  reviewInput: {
    height: 84,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.cream50,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  reviewActions: { flexDirection: "row", gap: spacing.sm },
  quiet: {
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quietLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  error: { fontFamily: fonts.body, fontSize: type.small, color: colors.red600 },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900, textAlign: "center" },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
});
