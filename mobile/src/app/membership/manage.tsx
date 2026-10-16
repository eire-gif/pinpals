import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldButton } from "@/components/gold-button";
import { StateMessage } from "@/components/state-message";
import { isOn } from "@/lib/features";
import { useMembership } from "@/lib/membership";
import { PLAN_COPY, renewalLine } from "@/lib/membership-rules";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Membership settings (approved mock-up "App · Membership settings"): my
 * plan, when it renews or the trial ends, upgrade, restore, and the way out —
 * cancelling is the store's job, so the button opens its subscriptions page.
 * Gated by `memberships` (off).
 */

const STORE_SUBSCRIPTIONS =
  Platform.OS === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions";

export default function MembershipManageScreen() {
  const { membership, refresh } = useMembership();

  if (!isOn("memberships")) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Membership" }} />
        <StateMessage size="screen" icon="diamond-outline" title="Memberships are on their way" body="Everything in PinPals is free for now." />
      </View>
    );
  }

  const plan = PLAN_COPY[membership.tier];
  const renewal = renewalLine(membership);
  const storeName = membership.source === "play_store" ? "Google Play" : membership.source === "app_store" ? "the App Store" : null;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Membership", headerStyle: { backgroundColor: colors.navy900 }, headerTintColor: colors.cream50, headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, membership.tier !== "basic" && styles.cardPaid]}>
          <Text style={styles.eyebrow}>YOUR PLAN</Text>
          <View style={styles.row}>
            <Text style={styles.plan}>{plan.name}</Text>
            {membership.billing ? <Text style={styles.badge}>{membership.billing === "annual" ? "Annual" : "Monthly"}</Text> : null}
          </View>
          {renewal ? <Text style={styles.line}>{renewal}</Text> : null}
          {storeName ? <Text style={styles.line}>Billed by {storeName}</Text> : null}
          {membership.tier === "basic" ? <Text style={styles.line}>{plan.blurb}. Free for ever.</Text> : null}
        </View>

        {membership.tier !== "pro" ? (
          <GoldButton
            label={membership.tier === "basic" ? "See Premium and Pro" : "Upgrade to Pro"}
            onPress={() => router.push({ pathname: "/membership", params: { plan: membership.tier === "basic" ? "premium" : "pro" } })}
          />
        ) : null}

        <View style={styles.list}>
          <Pressable
            style={styles.item}
            accessibilityRole="button"
            onPress={() => {
              // Restoring re-reads the store receipt once purchases are in the
              // binary; today it re-reads what PinPals has on file.
              void refresh().then(() => Alert.alert("Up to date", "Your membership has been checked."));
            }}
          >
            <Text style={styles.itemText}>Restore purchases</Text>
            <Ionicons name="refresh" size={18} color={creamAlpha(0.7)} />
          </Pressable>
        </View>

        {storeName ? (
          <View style={styles.bottom}>
            <Pressable style={styles.outline} accessibilityRole="link" onPress={() => void Linking.openURL(STORE_SUBSCRIPTIONS)}>
              <Text style={styles.outlineText}>Cancel or change in {storeName}</Text>
              <Ionicons name="open-outline" size={16} color={colors.cream50} />
            </Pressable>
            <Text style={styles.fine}>
              {storeName === "Google Play" ? "Google Play" : "Apple"} looks after cancellations. If you cancel, you keep {plan.name} until the end of the time
              you've paid for, then move back to Basic — your rounds and history stay.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  scroll: { padding: spacing.md + 2, paddingBottom: spacing.xl * 2, gap: spacing.md + 4 },
  card: { borderRadius: radii.lg + 4, padding: 18, gap: 6, backgroundColor: creamAlpha(0.06), borderWidth: 2, borderColor: creamAlpha(0.12) },
  cardPaid: { borderColor: colors.gold400, backgroundColor: creamAlpha(0.1) },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.6, color: colors.gold400 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  plan: { fontFamily: fonts.display, fontSize: 28, color: colors.cream50 },
  badge: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    backgroundColor: colors.gold400,
    color: colors.navy900,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
  line: { fontFamily: fonts.body, fontSize: type.small, color: creamAlpha(0.8) },
  list: { borderRadius: radii.lg, backgroundColor: creamAlpha(0.06), overflow: "hidden" },
  item: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: 12 },
  itemText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.cream50 },
  bottom: { gap: 10, marginTop: spacing.md },
  outline: {
    minHeight: 52,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    borderColor: creamAlpha(0.3),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  outlineText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.cream50 },
  fine: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, textAlign: "center", color: creamAlpha(0.75) },
});
