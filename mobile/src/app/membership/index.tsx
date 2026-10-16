import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldButton } from "@/components/gold-button";
import { StateMessage } from "@/components/state-message";
import { isOn } from "@/lib/features";
import { useMembership } from "@/lib/membership";
import { PLAN_COPY, annualSaving, checkoutWording, perMonth, type Billing, type Tier } from "@/lib/membership-rules";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Choose your plan (claude/memberships.md, approved mock-up "App · Choose
 * your plan"). Monthly / Annual, three plan cards, what the picked plan
 * includes, and one gold button that opens the store's own payment sheet.
 *
 * `?plan=pro` opens with Pro picked — the upgrade sheet passes the plan a
 * locked feature needs.
 *
 * Paying needs in-app purchases (RevenueCat), which arrive in a new binary;
 * until then the button says so. Gated by `memberships` (off).
 */
export default function MembershipPlansScreen() {
  const params = useLocalSearchParams<{ plan?: string }>();
  const { membership } = useMembership();
  const [billing, setBilling] = useState<Billing>("annual");
  const [pick, setPick] = useState<Tier>(params.plan === "pro" ? "pro" : params.plan === "basic" ? "basic" : "premium");

  if (!isOn("memberships")) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Membership" }} />
        <StateMessage size="screen" icon="diamond-outline" title="Memberships are on their way" body="Everything in PinPals is free for now." />
      </View>
    );
  }

  const saving = annualSaving(membership.prices.premium.monthly, membership.prices.premium.annual);
  const wording = checkoutWording(pick, billing, membership);

  function buy() {
    if (pick === "basic" || pick === membership.tier) {
      router.back();
      return;
    }
    // In-app purchases (RevenueCat → App Store / Google Play) come with the
    // next binary. Until then nobody can be charged from here.
    Alert.alert("Not open yet", "Subscriptions open soon. Everything is free for now — enjoy it.");
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "", headerStyle: { backgroundColor: colors.navy900 }, headerTintColor: colors.cream50, headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>PINPALS MEMBERSHIP</Text>
        <Text style={styles.title} accessibilityRole="header">
          Golf is better on PinPals
        </Text>

        <View style={styles.segment} accessibilityRole="tablist">
          {(["monthly", "annual"] as const).map((b) => {
            const on = billing === b;
            return (
              <Pressable
                key={b}
                onPress={() => setBilling(b)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[styles.segmentItem, on && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                  {b === "monthly" ? "Monthly" : saving > 0 ? `Annual · save ${saving}%` : "Annual"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View accessibilityRole="radiogroup" style={styles.plans}>
          {(["basic", "premium", "pro"] as const).map((t) => {
            const on = pick === t;
            const copy = PLAN_COPY[t];
            const price = t === "basic" ? "Free" : membership.prices[t][billing];
            const per = t === "basic" ? "for ever" : billing === "annual" ? `per year · ${perMonth(membership.prices[t].annual) ?? ""}` : "per month";
            const tag = membership.tier === t ? "Your plan" : copy.tag;
            return (
              <Pressable
                key={t}
                onPress={() => setPick(t)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${copy.name}, ${price} ${per}`}
                style={[styles.plan, on && styles.planOn]}
              >
                <View style={[styles.dot, on && styles.dotOn]}>{on ? <View style={styles.dotInner} /> : null}</View>
                <View style={styles.planBody}>
                  <View style={styles.planNameRow}>
                    <Text style={styles.planName}>{copy.name}</Text>
                    <Text style={[styles.tag, t === "pro" ? styles.tagGold : t === "premium" ? styles.tagBlue : styles.tagQuiet]}>{tag.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.planBlurb}>{copy.blurb}</Text>
                </View>
                <View style={styles.planPrice}>
                  <Text style={styles.price}>{price}</Text>
                  <Text style={styles.per}>{per}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.includes}>
          <Text style={styles.includesHead}>{pick === "basic" ? "INCLUDED FREE" : `WITH ${PLAN_COPY[pick].name.toUpperCase()}`}</Text>
          {PLAN_COPY[pick].features.map((f) => (
            <View key={f} style={styles.includeRow}>
              <Ionicons name="checkmark" size={18} color={colors.gold400} />
              <Text style={styles.includeText}>{f}</Text>
            </View>
          ))}
        </View>

        <GoldButton label={wording.button} onPress={buy} style={styles.cta} />
        <Text style={styles.fine}>{wording.fine}</Text>
        <View style={styles.links}>
          <Pressable onPress={() => router.push("/membership/manage")} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.link}>Restore purchases</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/privacy")} accessibilityRole="link" hitSlop={8}>
            <Text style={styles.link}>Terms & privacy</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  scroll: { padding: spacing.lg - 4, paddingBottom: spacing.xl * 2, gap: spacing.md + 2 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50, marginTop: -8 },
  segment: { flexDirection: "row", backgroundColor: creamAlpha(0.08), borderRadius: radii.md + 2, padding: 4, gap: 4 },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: radii.md - 1, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.cream50 },
  segmentText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: creamAlpha(0.75) },
  segmentTextOn: { color: colors.navy900 },
  plans: { gap: 10 },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 72,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: creamAlpha(0.12),
    backgroundColor: creamAlpha(0.05),
  },
  planOn: { borderColor: colors.gold400, backgroundColor: creamAlpha(0.1) },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: creamAlpha(0.4), alignItems: "center", justifyContent: "center" },
  dotOn: { borderColor: colors.gold400 },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold400 },
  planBody: { flex: 1, minWidth: 0 },
  planNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  planName: { fontFamily: fonts.display, fontSize: 20, color: colors.cream50 },
  tag: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radii.pill, overflow: "hidden" },
  tagGold: { backgroundColor: colors.gold400, color: colors.navy900 },
  tagBlue: { backgroundColor: "#a9c3ea", color: colors.navy900 },
  tagQuiet: { backgroundColor: creamAlpha(0.14), color: colors.cream50 },
  planBlurb: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.75), marginTop: 2 },
  planPrice: { alignItems: "flex-end" },
  price: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  per: { fontFamily: fonts.body, fontSize: 12, color: creamAlpha(0.75) },
  includes: { backgroundColor: creamAlpha(0.06), borderRadius: radii.lg, padding: 14, gap: 9 },
  includesHead: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.5, color: colors.gold400 },
  includeRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  includeText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.cream50 },
  cta: { marginTop: spacing.sm },
  fine: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, textAlign: "center", color: creamAlpha(0.75) },
  links: { flexDirection: "row", justifyContent: "center", gap: spacing.lg },
  link: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.gold400, minHeight: 32, textAlignVertical: "center" },
});
