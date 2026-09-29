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
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  cents,
  euro,
  incomingOffers,
  listingPerformance,
  liveAuctions,
  ordersNeedingAction,
  salesHistory,
  shortDate,
  timeRemaining,
  type IncomingOffer,
  type ListingPerformance,
  type LiveAuction,
  type SaleOrder,
} from "@/lib/selling";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * My selling — everything you have on sale, are negotiating, or are owed for.
 *
 * Four tabs, loaded together on open rather than one at a time. The website
 * fetches per tab because a tab there is a page load; here it is a state
 * change, and four small queries on one round trip beat a spinner every time
 * a thumb moves sideways.
 *
 * Read-only by design, and the buttons say so. Answering an offer opens the
 * listing on the website inside the app, because offer_action() (0048) is the
 * single path a seller's response is written through and a second
 * implementation here would be two state machines to keep in agreement.
 * Balance and payout history live on their own screen — the header links
 * there rather than repeating them.
 */

const TABS = [
  { key: "listings", label: "Listings" },
  { key: "offers", label: "Offers" },
  { key: "orders", label: "To send" },
  { key: "sales", label: "Sales" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type Data = {
  listings: ListingPerformance[];
  offers: IncomingOffer[];
  auctions: LiveAuction[];
  toSend: SaleOrder[];
  sales: SaleOrder[];
};

const EMPTY: Data = { listings: [], offers: [], auctions: [], toSend: [], sales: [] };

export default function SellingScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [data, setData] = useState<Data>(EMPTY);
  const [tab, setTab] = useState<TabKey>("listings");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [listings, offers, auctions, toSend, sales] = await Promise.all([
        listingPerformance(userId),
        incomingOffers(userId),
        liveAuctions(userId),
        ordersNeedingAction(userId),
        salesHistory(userId),
      ]);
      setData({ listings, offers, auctions, toSend, sales });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // On focus: answering an offer happens on the website, in a web view this
  // screen pushed. Coming back should not still show the offer you just
  // accepted.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const counts: Record<TabKey, number> = {
    listings: data.listings.length,
    offers: data.offers.length + data.auctions.length,
    orders: data.toSend.length,
    sales: data.sales.length,
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{
          headerTitle: "",
          headerBackTitle: "Back",
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/payouts")}
              hitSlop={12}
              style={{ paddingHorizontal: spacing.md }}
              accessibilityLabel="Payouts"
            >
              <Ionicons name="wallet-outline" size={23} color={colors.green700} />
            </Pressable>
          ),
        }}
      />

      <ScreenHeader
        scene="lakeSunset"
        title="My selling"
        subtitle={sellingSubtitle(data, loading)}
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
        />
      )}
    </View>
  );
}

function sellingSubtitle(data: Data, loading: boolean): string {
  if (loading) return "Loading your sales";
  const waiting = data.offers.length;
  if (waiting > 0) return waiting === 1 ? "1 offer waiting on you" : `${waiting} offers waiting on you`;
  const toSend = data.toSend.length;
  if (toSend > 0) return toSend === 1 ? "1 sale to send out" : `${toSend} sales to send out`;
  const live = data.listings.filter((l) => l.status === "active").length;
  return live === 0 ? "Nothing on sale yet" : live === 1 ? "1 item on sale" : `${live} items on sale`;
}

function Body({
  tab,
  data,
  refreshing,
  onRefresh,
}: {
  tab: TabKey;
  data: Data;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const refresh = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green700} />
  );

  if (tab === "listings") {
    return (
      <FlatList
        style={styles.fill}
        contentContainerStyle={styles.list}
        data={data.listings}
        keyExtractor={(item) => String(item.id)}
        refreshControl={refresh}
        ListHeaderComponent={
          data.listings.length > 0 ? (
            <Pressable style={styles.linkRow} onPress={() => router.push("/my-listings")}>
              <Text style={styles.linkRowLabel}>Manage listings</Text>
              <Ionicons name="arrow-forward" size={15} color={colors.green700} />
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <Empty
            icon="pricetags-outline"
            title="Nothing listed yet"
            body="List a club and its saves and offers will show up here."
            action="List an item"
            onPress={() => router.push("/new-listing")}
          />
        }
        renderItem={({ item }) => <ListingRow listing={item} />}
      />
    );
  }

  if (tab === "offers") {
    return (
      <FlatList
        style={styles.fill}
        contentContainerStyle={styles.list}
        data={data.offers}
        keyExtractor={(item) => String(item.id)}
        refreshControl={refresh}
        ListFooterComponent={<Auctions auctions={data.auctions} />}
        ListEmptyComponent={
          data.auctions.length === 0 ? (
            <Empty
              icon="chatbubbles-outline"
              title="No offers right now"
              body="When a buyer makes an offer on one of your listings, it lands here — soonest deadline first."
            />
          ) : null
        }
        renderItem={({ item }) => <OfferRow offer={item} />}
      />
    );
  }

  if (tab === "orders") {
    return (
      <FlatList
        style={styles.fill}
        contentContainerStyle={styles.list}
        data={data.toSend}
        keyExtractor={(item) => String(item.id)}
        refreshControl={refresh}
        ListHeaderComponent={
          data.toSend.length > 0 ? (
            <Text style={styles.note}>
              PinPals doesn&apos;t track postage yet, so nothing here disappears when you send it.
              It&apos;s every paid sale, oldest first.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Empty
            icon="cube-outline"
            title="Nothing to send"
            body="Every paid sale waiting to be posted or handed over shows up here."
          />
        }
        renderItem={({ item }) => <OrderRow order={item} showDelivery />}
      />
    );
  }

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.list}
      data={data.sales}
      keyExtractor={(item) => String(item.id)}
      refreshControl={refresh}
      ListEmptyComponent={
        <Empty
          icon="receipt-outline"
          title="No sales yet"
          body="Every order on one of your listings shows up here, however it turns out."
        />
      }
      renderItem={({ item }) => <OrderRow order={item} showStatuses />}
    />
  );
}

function ListingRow({ listing }: { listing: ListingPerformance }) {
  const price =
    listing.currentBidCents !== null
      ? `${cents(listing.currentBidCents)} current bid`
      : listing.priceEur !== null
        ? euro(listing.priceEur)
        : "Auction";

  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/listing/${listing.id}`)}
    >
      <Thumb uri={listing.imageUrl} />

      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {price}
          {listing.auctionEndsAt && listing.auctionStatus === "live"
            ? ` · ${timeRemaining(listing.auctionEndsAt)}`
            : ""}
        </Text>

        <View style={styles.pills}>
          {/* Nothing at all when the count is unknown. Zero is a claim. */}
          {listing.favourites !== null ? (
            <Pill icon="heart" label={String(listing.favourites)} />
          ) : null}
          {listing.activeOffers > 0 ? (
            <Pill
              tone="gold"
              label={`${listing.activeOffers} ${listing.activeOffers === 1 ? "offer" : "offers"}`}
            />
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function OfferRow({ offer }: { offer: IncomingOffer }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {offer.listingTitle}
        </Text>
        <Text style={styles.offerAmount}>{euro(offer.amountEur)}</Text>
        <Text style={styles.meta}>
          {offer.status === "countered" ? "You countered · " : ""}
          {timeRemaining(offer.expiresAt)}
        </Text>

        {/* Answering happens on the website. offer_action() is the one place
            a seller's response is written, and it checks the deadline again
            server-side — so a second implementation here would be a second
            opinion on money. */}
        <Pressable
          style={styles.cta}
          onPress={() =>
            router.push({
              pathname: "/web",
              params: { path: `/marketplace/${offer.listingId}`, title: "Offers" },
            })
          }
          accessibilityRole="button"
        >
          <Text style={styles.ctaLabel}>
            {offer.status === "countered" ? "View offer" : "Answer this offer"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Auctions({ auctions }: { auctions: LiveAuction[] }) {
  if (auctions.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Live auctions</Text>
      {auctions.map((auction) => (
        <Pressable
          key={auction.listingId}
          style={styles.card}
          accessibilityRole="button"
          onPress={() => router.push(`/listing/${auction.listingId}`)}
        >
          <Thumb uri={auction.imageUrl} />
          <View style={styles.cardBody}>
            <Text style={styles.title} numberOfLines={2}>
              {auction.listingTitle}
            </Text>
            <Text style={styles.meta}>
              {auction.hasBid ? "Current bid" : "Starting price"}: {cents(auction.currentBidCents)}
            </Text>
            <View style={styles.pills}>
              <Pill
                tone="gold"
                label={auction.status === "live" ? timeRemaining(auction.endsAt) : "Scheduled"}
              />
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
        </Pressable>
      ))}
    </View>
  );
}

function OrderRow({
  order,
  showDelivery,
  showStatuses,
}: {
  order: SaleOrder;
  showDelivery?: boolean;
  showStatuses?: boolean;
}) {
  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/order/${order.id}`)}
    >
      <Thumb uri={order.imageUrl} />

      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>
          {order.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {euro(order.totalEur)}
          {order.completedAt ? ` · paid ${shortDate(order.completedAt)}` : ""}
        </Text>

        {showDelivery && order.deliveryDetail ? (
          <Text style={styles.meta} numberOfLines={2}>
            {order.deliveryDetail}
          </Text>
        ) : null}

        {showStatuses ? (
          <View style={styles.pills}>
            <Pill label={ORDER_STATUS_LABELS[order.status]} />
            <Pill
              tone={order.paymentStatus === "paid" ? "green" : "plain"}
              label={PAYMENT_STATUS_LABELS[order.paymentStatus]}
            />
          </View>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
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

function Pill({
  label,
  icon,
  tone = "plain",
}: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  tone?: "plain" | "gold" | "green";
}) {
  return (
    <View style={[styles.pill, tone === "gold" && styles.pillGold, tone === "green" && styles.pillGreen]}>
      {icon ? <Ionicons name={icon} size={11} color={colors.ink900} /> : null}
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

  // Same shape as My listings, and for the same reason: a horizontal
  // ScrollView is a flex child, so without flexGrow 0 it splits the screen
  // with the list below it and every pill stretches to fill the result.
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

  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    paddingBottom: 2,
  },
  linkRowLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },

  note: {
    fontFamily: fonts.body,
    fontSize: type.label,
    lineHeight: 18,
    color: colors.ink500,
    paddingBottom: 2,
  },

  section: { gap: spacing.sm, paddingTop: spacing.lg },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  thumb: {
    width: 62,
    height: 62,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceTint,
  },
  thumbNone: { alignItems: "center", justifyContent: "center" },

  cardBody: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  offerAmount: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900 },

  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.cream100,
  },
  pillGold: { backgroundColor: colors.gold400 },
  pillGreen: { backgroundColor: colors.green100 },
  pillLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, color: colors.ink900 },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 21,
    color: colors.ink900,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },

  cta: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
});
