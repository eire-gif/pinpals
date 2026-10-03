import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AmountSheet } from "@/components/amount-sheet";
import type { ListingDetail } from "@/lib/marketplace";
import {
  MIN_OFFER_EUR,
  eur,
  loadPurchaseState,
  makeOffer,
  offerTotal,
  orderForOffer,
  placeBid,
  respondToOffer,
  type PurchaseState,
} from "@/lib/purchase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Buying, on the listing screen: Buy now, make an offer, answer a counter,
 * place a bid — all in the app.
 *
 * What the member can do is decided by the same facts the website's
 * computeListingPurchaseState() reads — sale type, listing status, auction
 * state — plus their own offer and any order already reserved for them.
 * None of it is trusted: every button goes through a route that calls the
 * database function that actually decides (src/lib/marketplace-operations.ts
 * on the site), and a refusal comes back in the member's own words.
 *
 * Paying is the one step that still opens the website, inside the app:
 * Stripe's card form. See src/lib/purchase.ts.
 */

const UNAVAILABLE: Record<string, string> = {
  reserved: "This item is under offer and no longer available.",
  sold: "This item has already sold.",
  expired: "This listing has expired.",
  removed: "This listing is no longer available.",
  draft: "This listing isn't on sale yet.",
};

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days left`;
  if (hours >= 1) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

type Sheet = null | "offer" | "bid";

export function PurchasePanel({
  listing,
  userId,
  onChanged,
}: {
  listing: ListingDetail;
  userId: string;
  /** Reload the listing — its price, status or bid may have moved. */
  onChanged: () => void;
}) {
  const [state, setState] = useState<PurchaseState | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await loadPurchaseState(listing.id, userId, listing.saleType));
    } catch {
      setState({ auction: null, offer: null, openOrder: null });
    }
  }, [listing.id, listing.saleType, userId]);

  useEffect(() => {
    void load();
  }, [load, listing.status, listing.currentBidCents]);

  const refresh = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  if (!state) {
    return <ActivityIndicator color={colors.green700} style={{ marginVertical: spacing.md }} />;
  }

  const goToOrder = (orderId: number, checkoutDone: boolean) =>
    checkoutDone
      ? router.push(`/order/${orderId}`)
      : router.push({ pathname: "/checkout", params: { order: String(orderId) } });

  // An order already reserved for this member beats everything else: it is
  // the thing they were in the middle of, and the clock is running on it.
  if (state.openOrder) {
    const o = state.openOrder;
    return (
      <View style={styles.panel}>
        <Notice
          icon="time-outline"
          title="Reserved for you"
          body={
            o.reservationExpiresAt
              ? `Finish within ${timeLeft(o.reservationExpiresAt).replace(" left", "")} or it goes back on sale.`
              : "Finish your purchase to secure it."
          }
        />
        <Primary
          label={o.checkoutDone ? "Pay now" : "Choose delivery and pay"}
          onPress={() => goToOrder(o.id, o.checkoutDone)}
        />
      </View>
    );
  }

  const unavailable = UNAVAILABLE[listing.status];
  if (unavailable) {
    return (
      <View style={styles.panel}>
        <Notice icon="information-circle-outline" title="Not available" body={unavailable} />
      </View>
    );
  }

  const offer = state.offer;
  const auction = state.auction;
  const isAuction = listing.saleType === "auction" || listing.saleType === "auction_with_buy_now";
  const price = listing.priceCents === null ? null : listing.priceCents / 100;

  async function withdraw() {
    if (!offer) return;
    Alert.alert("Withdraw your offer?", `Your offer of ${eur(offer.amountEur)} will be cancelled.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Withdraw",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await respondToOffer(offer.id, "withdraw");
            await refresh();
          } catch (err) {
            Alert.alert("Couldn't withdraw", err instanceof Error ? err.message : "Please try again.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function answerCounter(accept: boolean) {
    if (!offer) return;
    const run = async () => {
      setBusy(true);
      try {
        const result = await respondToOffer(offer.id, accept ? "accept" : "decline");
        await refresh();
        if (accept && result.order_id) goToOrder(result.order_id, false);
      } catch (err) {
        Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
      } finally {
        setBusy(false);
      }
    };
    if (accept) {
      void run();
      return;
    }
    Alert.alert("Decline the counter-offer?", "The seller will be told. You can make a new offer afterwards.", [
      { text: "Cancel", style: "cancel" },
      { text: "Decline", style: "destructive", onPress: () => void run() },
    ]);
  }

  async function continueAccepted() {
    if (!offer) return;
    setBusy(true);
    try {
      const orderId = await orderForOffer(offer.id);
      if (orderId) goToOrder(orderId, false);
      else Alert.alert("Order not found", "Pull down to refresh and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      {/* ---------------- Auction ---------------- */}
      {isAuction && auction ? (
        <>
          <View style={styles.auctionRow}>
            <View>
              <Text style={styles.small}>{auction.currentBidCents === null ? "Starting price" : "Current bid"}</Text>
              <Text style={styles.big}>
                {eur((auction.currentBidCents ?? auction.minimumNextBidCents) / 100)}
              </Text>
            </View>
            <View style={styles.clock}>
              <Ionicons name="time-outline" size={15} color={colors.ink500} />
              <Text style={styles.small}>{auction.ended ? "Auction ended" : timeLeft(auction.endsAt)}</Text>
            </View>
          </View>
          {!auction.ended ? (
            <>
              <Primary label="Place a bid" onPress={() => setSheet("bid")} />
              {auction.buyNowCents !== null ? (
                <Secondary
                  label={`Buy now for ${eur(auction.buyNowCents / 100)}`}
                  onPress={() => router.push({ pathname: "/checkout", params: { listing: String(listing.id) } })}
                />
              ) : null}
            </>
          ) : (
            <Notice icon="hammer-outline" title="Bidding has closed" body="The winner will be contacted to complete the sale." />
          )}
        </>
      ) : null}

      {/* ---------------- Fixed price ---------------- */}
      {!isAuction && price !== null ? (
        <>
          {offer?.status === "countered" || offer?.status === "accepted" ? null : (
            <Primary
              label={`Buy now · ${eur(price)}`}
              onPress={() => router.push({ pathname: "/checkout", params: { listing: String(listing.id) } })}
            />
          )}

          {listing.saleType === "offers_allowed" ? (
            offer?.status === "pending" ? (
              <View style={styles.offerBox}>
                <Text style={styles.offerHead}>Your offer: {eur(offer.amountEur)}</Text>
                <Text style={styles.small}>Waiting for the seller · {timeLeft(offer.expiresAt)}</Text>
                <Secondary label="Withdraw offer" onPress={() => void withdraw()} busy={busy} />
              </View>
            ) : offer?.status === "countered" ? (
              <View style={[styles.offerBox, styles.offerBoxAction]}>
                <Text style={styles.offerHead}>The seller countered: {eur(offer.amountEur)}</Text>
                <Text style={styles.small}>
                  You offered {eur(offer.originalAmountEur)} · {timeLeft(offer.expiresAt)}
                </Text>
                <Primary label={`Accept ${eur(offer.amountEur)}`} onPress={() => void answerCounter(true)} busy={busy} />
                <Secondary label="Decline" onPress={() => void answerCounter(false)} />
              </View>
            ) : offer?.status === "accepted" ? (
              <View style={[styles.offerBox, styles.offerBoxAction]}>
                <Text style={styles.offerHead}>Offer accepted: {eur(offer.amountEur)}</Text>
                <Text style={styles.small}>Choose delivery and pay to complete the sale.</Text>
                <Primary label="Continue to checkout" onPress={() => void continueAccepted()} busy={busy} />
              </View>
            ) : (
              <>
                {offer && (offer.status === "declined" || offer.status === "expired") ? (
                  <Text style={styles.small}>
                    Your last offer of {eur(offer.amountEur)} was {offer.status === "declined" ? "declined" : "not answered in time"}.
                  </Text>
                ) : null}
                <Secondary label="Make an offer" onPress={() => setSheet("offer")} />
              </>
            )
          ) : null}
        </>
      ) : null}

      <Text style={styles.footnote}>
        Card payments are taken securely by Stripe.
      </Text>

      <AmountSheet
        visible={sheet === "offer"}
        title="Make an offer"
        intro={
          price !== null
            ? `Asking price ${eur(price)}. The seller has 48 hours to accept, decline or counter.`
            : undefined
        }
        placeholder={price !== null ? String(Math.round(price * 0.9)) : undefined}
        summary={(amount) =>
          amount === null
            ? null
            : amount < MIN_OFFER_EUR
              ? `Offers start at ${eur(MIN_OFFER_EUR)}.`
              : `If accepted you'd pay ${eur(offerTotal(amount).total)} including the ${eur(offerTotal(amount).fee)} PinPals fee, plus delivery if posted.`
        }
        confirmLabel={(amount) => (amount === null ? "Send offer" : `Send offer of ${eur(amount)}`)}
        onClose={() => setSheet(null)}
        onSubmit={async (amount) => {
          await makeOffer(listing.id, amount);
          setSheet(null);
          await refresh();
          Alert.alert("Offer sent", "The seller has been told. You'll get an alert when they answer.");
        }}
      />

      <AmountSheet
        visible={sheet === "bid"}
        title="Place a bid"
        intro={
          auction
            ? `Minimum bid ${eur(auction.minimumNextBidCents / 100)}. Bids can't be withdrawn.`
            : undefined
        }
        initial={auction ? String(auction.minimumNextBidCents / 100) : ""}
        confirmLabel={(amount) => (amount === null ? "Place bid" : `Bid ${eur(amount)}`)}
        onClose={() => setSheet(null)}
        onSubmit={async (amount) => {
          await placeBid(listing.id, amount);
          setSheet(null);
          await refresh();
          Alert.alert("Bid placed", `You're bidding ${eur(amount)}. We'll tell you if you're outbid.`);
        }}
      />
    </View>
  );
}

function Primary({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable style={styles.primary} onPress={onPress} disabled={busy} accessibilityRole="button">
      {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryLabel}>{label}</Text>}
    </Pressable>
  );
}

function Secondary({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable style={styles.secondary} onPress={onPress} disabled={busy} accessibilityRole="button">
      {busy ? <ActivityIndicator color={colors.green700} /> : <Text style={styles.secondaryLabel}>{label}</Text>}
    </Pressable>
  );
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.notice}>
      <Ionicons name={icon} size={20} color={colors.green700} />
      <View style={{ flex: 1 }}>
        <Text style={styles.noticeTitle}>{title}</Text>
        <Text style={styles.small}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  primary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  secondary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.green700,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
  small: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  big: { fontFamily: fonts.display, fontSize: 26, color: colors.green700 },
  auctionRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  clock: { flexDirection: "row", alignItems: "center", gap: 4 },
  offerBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  offerBoxAction: { borderColor: colors.gold500, borderWidth: 1.5 },
  offerHead: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  notice: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.green100,
  },
  noticeTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900, marginBottom: 2 },
  footnote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "center", marginTop: 2 },
});
