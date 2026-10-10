import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import { deadlineLabel, euro } from "@/lib/buying";
import { DISPUTE_STATUS_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, shortDate } from "@/lib/selling";
import { loadOrder, type OrderDetail } from "@/lib/orders";
import { HandoverPanel } from "@/components/handover-panel";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * One order, from either side.
 *
 * The same screen for buyer and seller, because the facts are the same
 * facts — what was bought, for how much, how it's getting there, where the
 * money is. Only the actions differ, and only the buyer has any: paying is
 * the one thing an order can still be waiting on.
 *
 * PAYING OPENS THE WEBSITE — for now. Card details are entered in Stripe's
 * own iframe through PaymentElement; a native card sheet needs Stripe's iOS
 * SDK, which is a native module and so arrives with a new build, not an
 * over-the-air update. Choosing delivery is native (app/checkout.tsx).
 * Reporting a problem also opens the site, because it writes to `reports`
 * with the admin client.
 *
 * No header photograph here on purpose. This screen is a receipt, and a
 * receipt with a sunset on it would be the app being pleased with itself
 * while somebody is trying to work out whether they've been charged twice.
 */
export default function OrderScreen() {
  const { id, pay } = useLocalSearchParams<{ id: string; pay?: string }>();
  const orderId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(orderId)) {
      setLoading(false);
      return;
    }
    try {
      setOrder(await loadOrder(orderId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orderId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openSite = (path: string, title: string) =>
    router.push({ pathname: "/web", params: { path, title } });

  // Arriving straight from the app's checkout (?pay=1): the order has just
  // been reserved and the member's next step is the card form, so open it
  // for them — once. Back from Stripe lands here, on the order.
  const opened = useRef(false);
  useEffect(() => {
    if (pay !== "1" || opened.current || !order) return;
    if (order.buyerId !== userId || order.paymentStatus === "paid" || !order.checkoutCompletedAt) return;
    opened.current = true;
    openSite(`/dashboard/orders/${order.id}`, "Pay securely");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay, order, userId]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Order", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Order", headerBackTitle: "Back" }} />
        <Ionicons name="receipt-outline" size={42} color={colors.ink500} />
        <Text style={styles.emptyTitle}>Order not found</Text>
        <Text style={styles.emptyBody}>
          It may have been removed, or it isn&apos;t one of yours.
        </Text>
      </View>
    );
  }

  const isBuyer = order.buyerId === userId;
  const deadline = deadlineLabel(order.reservationExpiresAt);
  const awaitingPayment =
    isBuyer && order.status === "pending" && order.paymentStatus !== "paid" && deadline !== "Expired";

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.green700}
        />
      }
    >
      <Stack.Screen options={{ title: `Order #${order.id}`, headerBackTitle: "Back" }} />

      <View style={styles.item}>
        {order.imageUrl ? (
          <Image source={{ uri: order.imageUrl }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbNone]}>
            <Ionicons name="image-outline" size={24} color={colors.ink500} />
          </View>
        )}
        <View style={styles.itemBody}>
          <Text style={styles.itemTitle}>{order.title}</Text>
          <Text style={styles.meta}>
            {[order.category, order.condition].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.meta}>
            {isBuyer ? "You bought this" : "You sold this"} · {shortDate(order.createdAt)}
          </Text>
        </View>
      </View>

      <View style={styles.statusRow}>
        <Badge label={ORDER_STATUS_LABELS[order.status]} />
        <Badge
          tone={order.paymentStatus === "paid" ? "green" : "plain"}
          label={PAYMENT_STATUS_LABELS[order.paymentStatus]}
        />
        {order.disputeStatus ? (
          <Badge
            tone="warn"
            label={DISPUTE_STATUS_LABELS[order.disputeStatus] ?? "Issue reported"}
          />
        ) : null}
      </View>

      {/* The only action an order can still be waiting on, and it opens the
          site because payment is Stripe's own iframe. */}
      {awaitingPayment ? (
        <View style={styles.actionCard}>
          <Text style={styles.actionTitle}>
            {order.checkoutCompletedAt ? "This order needs paying" : "Finish your checkout"}
          </Text>
          {deadline ? (
            <Text style={styles.actionNote}>
              The seller is holding it for you — {deadline.toLowerCase()}.
            </Text>
          ) : null}
          {/* Choosing delivery is native (app/checkout.tsx); paying is
              Stripe's card form on the site. */}
          <Pressable
            style={styles.cta}
            onPress={() =>
              order.checkoutCompletedAt
                ? openSite(`/dashboard/orders/${order.id}`, "Pay securely")
                : router.push({ pathname: "/checkout", params: { order: String(order.id) } })
            }
            accessibilityRole="button"
          >
            <Text style={styles.ctaLabel}>
              {order.checkoutCompletedAt ? "Pay now" : "Finish checkout"}
            </Text>
            {order.checkoutCompletedAt ? (
              <Ionicons name="lock-closed-outline" size={15} color={colors.cream50} />
            ) : null}
          </Pressable>
          <Text style={styles.fine}>
            Card details are entered with Stripe, never in PinPals.
          </Text>
        </View>
      ) : null}

      {/* Buyer Protection (0114): the handover, once paid. */}
      {order.paymentStatus === "paid" && order.fulfilmentStatus ? (
        <HandoverPanel order={order} isBuyer={isBuyer} onChanged={() => void load()} />
      ) : null}

      <Section title="Delivery">
        <Line
          label={order.deliveryMethod === "post" ? "By post" : "Collection"}
          value={order.deliveryDetail ?? "Not set yet"}
        />
      </Section>

      <Section title="What it came to">
        <Line label="Item" value={euro(order.amountEur)} />
        <Line label="Buyer Protection" value={euro(order.platformFeeEur)} />
        <Line label="Total" value={euro(order.totalEur)} strong />
        {order.refundedAmountEur !== null ? (
          <Line label="Refunded" value={euro(order.refundedAmountEur)} />
        ) : null}
      </Section>

      {/* Reporting writes to `reports` with the admin client, so it lives on
          the site. Kept quiet — it is a last resort, not a call to action. */}
      <Pressable
        style={styles.report}
        onPress={() => openSite(`/dashboard/orders/${order.id}`, "Order")}
        accessibilityRole="button"
      >
        <Ionicons name="flag-outline" size={15} color={colors.ink500} />
        <Text style={styles.reportLabel}>Something wrong with this order?</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineValueStrong]}>{value}</Text>
    </View>
  );
}

function Badge({ label, tone = "plain" }: { label: string; tone?: "plain" | "green" | "warn" }) {
  return (
    <View
      style={[styles.badge, tone === "green" && styles.badgeGreen, tone === "warn" && styles.badgeWarn]}
    >
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },

  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },

  item: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  thumb: { width: 78, height: 78, borderRadius: radii.md, backgroundColor: colors.surfaceTint },
  thumbNone: { alignItems: "center", justifyContent: "center" },
  itemBody: { flex: 1, gap: 3 },
  itemTitle: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.cream100,
  },
  badgeGreen: { backgroundColor: colors.green100 },
  badgeWarn: { backgroundColor: colors.gold400 },
  badgeLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink900 },

  actionCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.gold400,
    backgroundColor: colors.surface,
  },
  actionTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  actionNote: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  fine: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },

  section: { gap: 6 },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
  },
  sectionBody: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: 12,
  },
  lineLabel: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  lineValue: {
    flex: 1,
    textAlign: "right",
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink900,
  },
  lineValueStrong: { fontFamily: fonts.bodyBold, fontSize: type.body },

  report: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
  },
  reportLabel: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },

  emptyTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900 },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
    textAlign: "center",
  },
});
