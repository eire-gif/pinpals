import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import {
  ONBOARDING_LABELS,
  PAYOUT_STATUS_LABELS,
  euro,
  loadPayouts,
  shortDate,
  type PayoutRow,
  type PayoutsView,
  type SellerOnboardingStatus,
} from "@/lib/selling";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Getting paid — where a seller stands with Stripe, and what has landed.
 *
 * SETTING UP PAYOUTS OPENS THE WEBSITE, AND ALWAYS WILL. Stripe Connect
 * onboarding is a hosted flow: the site creates an AccountLink, hands the
 * member to Stripe's own pages, and Stripe returns them to a route that
 * re-syncs the account. Every part of that is a browser redirect, and the
 * bank details in the middle of it are entered on Stripe's domain, never in
 * a PinPals form — which is the point, and worth the member seeing.
 *
 * So this screen reads and explains; the two buttons hand over to the site
 * inside the app. Everything else is native: status, requirements, balance,
 * and the payout history Stripe's own webhooks wrote into `payouts` (0024).
 */
export default function PayoutsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [view, setView] = useState<PayoutsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setView(await loadPayouts(userId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  // On focus, not just on mount: onboarding finishes on Stripe's pages in a
  // web view this screen opened, and coming back still reading "Not started"
  // would be the app disagreeing with what just happened.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openSite = (path: string, title: string) =>
    router.push({ pathname: "/web", params: { path, title } });

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />

      <ScreenHeader
        scene="parkland"
        title="Getting paid"
        subtitle={view ? ONBOARDING_LABELS[view.status] : "Checking with Stripe"}
      />

      {loading ? (
        <View style={[styles.fill, styles.centre]}>
          <ActivityIndicator color={colors.green700} />
        </View>
      ) : (
        <FlatList
          style={styles.fill}
          contentContainerStyle={styles.list}
          data={view?.payouts ?? []}
          keyExtractor={(item) => String(item.id)}
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
          ListHeaderComponent={
            <View style={styles.head}>
              <StatusCard view={view} onOpen={openSite} />
              {view?.account ? <BalanceCard view={view} /> : null}
              {(view?.payouts.length ?? 0) > 0 ? (
                <Text style={styles.sectionTitle}>Payout history</Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            view?.account ? (
              <View style={styles.empty}>
                <Ionicons name="cash-outline" size={40} color={colors.ink500} />
                <Text style={styles.emptyTitle}>No payouts yet</Text>
                <Text style={styles.emptyBody}>
                  Once Stripe sends your first payout, it will show up here.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => <PayoutLine payout={item} />}
        />
      )}
    </View>
  );
}

function StatusCard({
  view,
  onOpen,
}: {
  view: PayoutsView | null;
  onOpen: (path: string, title: string) => void;
}) {
  const status: SellerOnboardingStatus = view?.status ?? "not_started";
  const ready = status === "enabled";
  const needsAttention = status === "requirements_due" || status === "restricted";

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <Text style={styles.cardLabel}>Payout readiness</Text>
        <View style={[styles.badge, ready && styles.badgeReady, needsAttention && styles.badgeWarn]}>
          <Text style={[styles.badgeLabel, ready && styles.badgeLabelReady]}>
            {ONBOARDING_LABELS[status]}
          </Text>
        </View>
      </View>

      <Text style={styles.cardBody}>{EXPLANATION[status]}</Text>

      {/* The requirement codes Stripe gives back, plainly. They read like
          "individual.verification.document" and there is no point dressing
          that up — what matters is that the member sees there is a specific
          list, and that the button takes them to where it gets cleared. */}
      {view?.account && view.account.requirementsCurrentlyDue.length > 0 ? (
        <View style={styles.requirements}>
          {view.account.requirementsCurrentlyDue.slice(0, 5).map((code) => (
            <Text key={code} style={styles.requirement} numberOfLines={1}>
              · {code}
            </Text>
          ))}
        </View>
      ) : null}

      <Pressable
        style={[styles.cta, ready && styles.ctaQuiet]}
        onPress={() =>
          ready
            ? onOpen("/dashboard/payouts/settings", "Payout settings")
            : onOpen("/dashboard/payouts", "Set up payouts")
        }
        accessibilityRole="button"
      >
        <Text style={[styles.ctaLabel, ready && styles.ctaLabelQuiet]}>
          {ready
            ? "Manage on Stripe"
            : status === "not_started"
              ? "Set up payouts"
              : "Finish setting up"}
        </Text>
        <Ionicons
          name="open-outline"
          size={15}
          color={ready ? colors.green700 : colors.cream50}
        />
      </Pressable>

      <Text style={styles.fine}>
        You enter your details, bank details included, with Stripe directly — never in a PinPals
        form.
      </Text>
    </View>
  );
}

const EXPLANATION: Record<SellerOnboardingStatus, string> = {
  not_started:
    "You can list and negotiate without this, but a buyer can't pay you until Stripe has verified who you are.",
  requirements_due: "Stripe needs another detail or two before it will pay you out.",
  pending: "Stripe is checking what you sent. This usually takes a day or so, and nothing is needed from you.",
  enabled: "You're set up. Money from a sale lands in your Stripe balance and Stripe pays it on to your bank.",
  restricted:
    "Stripe has put a hold on payouts to this account. The details of what it needs are on its own pages.",
};

function BalanceCard({ view }: { view: PayoutsView }) {
  const { balance } = view;
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Your Stripe balance</Text>

      <View style={styles.balanceRow}>
        <View style={styles.balanceCell}>
          <Text style={styles.balanceCaption}>Available</Text>
          <Text style={styles.balanceFigure}>
            {balance ? euro(balance.availableEur) : "—"}
          </Text>
        </View>
        <View style={styles.balanceCell}>
          <Text style={styles.balanceCaption}>Pending</Text>
          <Text style={styles.balanceFigure}>{balance ? euro(balance.pendingEur) : "—"}</Text>
        </View>
      </View>

      {/* Said plainly, and kept small. The balance is the one live figure on
          this screen; the payout rows below it are Stripe's own records and
          are unaffected by a hiccup reading it. */}
      {!balance ? (
        <Text style={styles.fine}>
          Couldn&apos;t reach Stripe for a live balance just now. This affects only what&apos;s shown
          here, not your actual money.
        </Text>
      ) : null}
    </View>
  );
}

function PayoutLine({ payout }: { payout: PayoutRow }) {
  const failed = payout.status === "failed" || payout.status === "canceled";
  return (
    <View style={styles.payout}>
      <View style={styles.payoutBody}>
        <Text style={styles.payoutAmount}>{euro(payout.amountEur)}</Text>
        <Text style={styles.meta}>{shortDate(payout.createdAt)}</Text>
        {failed && payout.failureMessage ? (
          <Text style={styles.failure} numberOfLines={2}>
            {payout.failureMessage}
          </Text>
        ) : null}
      </View>
      <View style={[styles.badge, payout.status === "paid" && styles.badgeReady, failed && styles.badgeWarn]}>
        <Text style={[styles.badgeLabel, payout.status === "paid" && styles.badgeLabelReady]}>
          {PAYOUT_STATUS_LABELS[payout.status]}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  head: { gap: spacing.sm, paddingBottom: 2 },

  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  cardLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
  },
  cardBody: {
    fontFamily: fonts.body,
    fontSize: type.small,
    lineHeight: 21,
    color: colors.ink900,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.cream100,
  },
  badgeReady: { backgroundColor: colors.green700 },
  badgeWarn: { backgroundColor: colors.gold400 },
  badgeLabel: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink900 },
  badgeLabelReady: { color: colors.cream50 },

  requirements: { gap: 2 },
  requirement: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink500 },

  balanceRow: { flexDirection: "row", gap: spacing.md },
  balanceCell: { flex: 1, gap: 2 },
  balanceCaption: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  balanceFigure: { fontFamily: fonts.display, fontSize: 25, color: colors.ink900 },

  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
  },
  ctaQuiet: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  ctaLabelQuiet: { color: colors.green700 },

  fine: {
    fontFamily: fonts.body,
    fontSize: type.label,
    lineHeight: 18,
    color: colors.ink500,
  },

  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.label,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: colors.ink500,
    paddingTop: spacing.sm,
  },

  payout: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  payoutBody: { flex: 1, gap: 2 },
  payoutAmount: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  failure: { fontFamily: fonts.body, fontSize: type.label, color: colors.red600 },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
    textAlign: "center",
  },
});
