import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldButton } from "@/components/gold-button";
import { handoverStep, type OrderDetail } from "@/lib/orders";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Buyer Protection on the order screen (0114) — the mock-up's "Meet-up
 * handover", for both sides.
 *
 * Buyer, collection: the big 4-digit code, the meet-up, safe meet-up tips,
 * "Problem with this item". Buyer, post: "It arrived — all OK".
 * Seller: the meet-up and a box for the buyer's code, or "Mark as posted".
 *
 * Every step goes through the site (handoverStep), where the database
 * decides who may take it and the money is released.
 */

const LIP = "#9c7a2c";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

const PROBLEMS = [
  { key: "item_not_as_described", label: "Not as described" },
  { key: "item_not_received", label: "No-show / never arrived" },
  { key: "scam_fraud", label: "Scam or fraud" },
  { key: "other", label: "Something else" },
] as const;

export function HandoverPanel({ order, isBuyer, onChanged }: { order: OrderDetail; isBuyer: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [tracking, setTracking] = useState("");
  const [editingMeetup, setEditingMeetup] = useState(false);
  const [meetAt, setMeetAt] = useState<Date>(() => (order.meetupAt ? new Date(order.meetupAt) : nextMorning()));
  const [place, setPlace] = useState(order.meetupPlace ?? (order.sellerClub ? `${order.sellerClub} · clubhouse car park` : ""));
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState<string>("item_not_as_described");
  const [problemText, setProblemText] = useState("");

  const f = order.fulfilmentStatus;
  if (!f) return null;
  const held = order.payoutStatus === "held";
  const collection = order.deliveryMethod !== "post";

  const run = async (body: Parameters<typeof handoverStep>[1], done?: string) => {
    setBusy(true);
    try {
      const r = await handoverStep(order.id, body);
      if (done) Alert.alert(done, r.released ? "The payment has been released to the seller." : undefined);
      onChanged();
    } catch (e) {
      Alert.alert("That didn't work", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const headline = (() => {
    if (f === "problem") {
      return (
        <>
          <Text style={styles.eyebrow}>Payment on hold</Text>
          <Text style={styles.big}>Problem reported</Text>
          <Text style={styles.cardBody}>PinPals is looking into it. Nobody is paid until it&apos;s sorted.</Text>
        </>
      );
    }
    if (!held) {
      return (
        <>
          <Text style={styles.eyebrow}>Complete</Text>
          <Text style={styles.big}>{isBuyer ? "All done — enjoy it" : "You've been paid"}</Text>
          {order.releasedAt ? <Text style={styles.cardBody}>Payment released {day(order.releasedAt)}.</Text> : null}
        </>
      );
    }
    if (isBuyer && collection) {
      return (
        <>
          <Text style={styles.eyebrow}>Your handover code</Text>
          <Text style={styles.code} accessibilityLabel={`Handover code ${order.handoverCode?.split("").join(" ") ?? "loading"}`}>
            {order.handoverCode ? order.handoverCode.split("").join(" ") : "· · · ·"}
          </Text>
          <Text style={styles.cardBody}>Check the item, then read this to the seller.{"\n"}They enter it and the money is released.</Text>
        </>
      );
    }
    if (isBuyer) {
      return (
        <>
          <Text style={styles.eyebrow}>{f === "posted" ? "On its way" : "Waiting to be posted"}</Text>
          <Text style={styles.big}>{f === "posted" ? "Has it arrived?" : "The seller is posting it"}</Text>
          {order.trackingRef ? <Text style={styles.cardBody}>Tracking {order.trackingRef}</Text> : null}
          <GoldButton
            label="It arrived — all OK"
            busy={busy}
            onPress={() =>
              Alert.alert("Release the payment?", "Only if you have it and it's as described.", [
                { text: "Not yet", style: "cancel" },
                { text: "Yes, all OK", onPress: () => void run({ step: "received" }, "Thanks!") },
              ])
            }
          />
          {order.releaseDueAt ? <Text style={styles.fine}>If you don&apos;t report a problem, the seller is paid {day(order.releaseDueAt)}.</Text> : null}
        </>
      );
    }
    if (collection) {
      return (
        <>
          <Text style={styles.eyebrow}>Get paid at the handover</Text>
          <Text style={styles.cardBody}>Ask the buyer for their 4-digit code once they&apos;ve checked the item.</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 4))}
            keyboardType="number-pad"
            placeholder="0000"
            placeholderTextColor="rgba(12,32,56,0.3)"
            style={styles.codeInput}
            maxLength={4}
            accessibilityLabel="The buyer's handover code"
          />
          <GoldButton label="Confirm handover" busy={busy} disabled={code.length !== 4} onPress={() => void run({ step: "code", code }, "Handover complete")} />
        </>
      );
    }
    if (f === "awaiting_post") {
      return (
        <>
          <Text style={styles.eyebrow}>Time to post it</Text>
          <TextInput
            value={tracking}
            onChangeText={setTracking}
            placeholder="Tracking number (optional)"
            placeholderTextColor="rgba(12,32,56,0.45)"
            style={styles.trackInput}
            maxLength={80}
          />
          <GoldButton label="Mark as posted" busy={busy} onPress={() => void run({ step: "posted", tracking: tracking.trim() || null }, "Marked as posted")} />
        </>
      );
    }
    return (
      <>
        <Text style={styles.eyebrow}>Posted</Text>
        <Text style={styles.big}>Waiting for the buyer</Text>
        {order.releaseDueAt ? <Text style={styles.cardBody}>You&apos;re paid when it arrives, or {day(order.releaseDueAt)} at the latest.</Text> : null}
      </>
    );
  })();

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.lip}>
        <View style={styles.card}>{headline}</View>
      </View>

      {collection && held && f === "awaiting_handover" ? (
        <View style={styles.meet}>
          {order.meetupAt && order.meetupPlace && !editingMeetup ? (
            <>
              <Text style={styles.meetWhen}>{when(order.meetupAt)}</Text>
              <Text style={styles.meetWhere}>{order.meetupPlace}</Text>
              <View style={styles.chips}>
                <Chip
                  icon="navigate-outline"
                  label="Directions"
                  onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.meetupPlace!)}`)}
                />
                <Chip icon="create-outline" label="Change" onPress={() => setEditingMeetup(true)} />
              </View>
              {order.releaseDueAt ? <Text style={styles.meetNote}>If nobody reports a problem, the seller is paid {day(order.releaseDueAt)}.</Text> : null}
            </>
          ) : (
            <>
              <Text style={styles.meetWhen}>Arrange the meet-up</Text>
              <Text style={styles.meetWhere}>Meet at a golf club, in daylight.</Text>
              <DateTimePicker
                value={meetAt}
                mode="datetime"
                display={Platform.OS === "ios" ? "compact" : "default"}
                minuteInterval={15}
                minimumDate={new Date()}
                onChange={(_e, d) => d && setMeetAt(d)}
                style={{ alignSelf: "flex-start", marginTop: spacing.sm }}
              />
              <TextInput value={place} onChangeText={setPlace} placeholder="Where — e.g. Portmarnock GC car park" placeholderTextColor={colors.ink500} style={styles.placeInput} maxLength={160} />
              <Pressable
                onPress={() => {
                  if (!place.trim()) return Alert.alert("Where will you meet?");
                  void run({ step: "meetup", at: meetAt.toISOString(), place: place.trim() }).then(() => setEditingMeetup(false));
                }}
                disabled={busy}
                style={({ pressed }) => [styles.navyButton, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.navyLabel}>Save the meet-up</Text>}
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {isBuyer && held && f !== "problem" ? (
        <View style={styles.safe}>
          <Text style={styles.safeTitle}>{collection ? "Safe meet-ups" : "Buyer Protection"}</Text>
          {collection ? <Text style={styles.safeLine}>· Meet at a club in daylight</Text> : null}
          <Text style={styles.safeLine}>
            {collection ? "· Don't share the code until you've checked the item" : "· Only tap “It arrived” once it's as described"}
          </Text>
          <Text style={styles.safeLine}>· Not as described? Report it — the seller isn&apos;t paid while we look into it</Text>
          {reporting ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={styles.chips}>
                {PROBLEMS.map((p) => (
                  <Pressable key={p.key} onPress={() => setProblem(p.key)} style={[styles.pChip, problem === p.key && styles.pChipOn]} accessibilityRole="button" accessibilityState={{ selected: problem === p.key }}>
                    <Text style={[styles.pChipText, problem === p.key && { color: colors.cream50 }]}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput value={problemText} onChangeText={setProblemText} placeholder="What's wrong?" placeholderTextColor={colors.ink500} multiline style={styles.problemInput} maxLength={4000} />
              <Pressable
                onPress={() => void run({ step: "problem", category: problem, description: problemText.trim() || undefined }, "Reported — the payment is on hold")}
                disabled={busy}
                style={({ pressed }) => [styles.redButton, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Text style={styles.navyLabel}>Report and hold the payment</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setReporting(true)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.problemLink}>Problem with this item</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

function nextMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 30, 0, 0);
  return d;
}

function Chip({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      <Ionicons name={icon} size={15} color={colors.navy900} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lip: { borderRadius: 20, backgroundColor: LIP, paddingBottom: 3, shadowColor: colors.navy900, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 6 } },
  card: { borderRadius: 20, borderWidth: 1.5, borderColor: colors.gold500, backgroundColor: colors.navy900, padding: spacing.lg, alignItems: "center", gap: 8 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: colors.gold400 },
  big: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: colors.cream50, textAlign: "center" },
  code: { fontSize: 52, lineHeight: 60, fontWeight: "800", letterSpacing: 6, color: colors.cream50 },
  cardBody: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.cream100, textAlign: "center" },
  fine: { fontFamily: fonts.body, fontSize: 12, color: colors.cream100, opacity: 0.8, textAlign: "center" },
  codeInput: { width: 170, textAlign: "center", fontSize: 34, fontWeight: "800", letterSpacing: 8, color: colors.navy900, backgroundColor: colors.cream50, borderRadius: radii.md, paddingVertical: 8, marginTop: 4 },
  trackInput: { alignSelf: "stretch", textAlign: "center", fontFamily: fonts.body, fontSize: type.body, color: colors.navy900, backgroundColor: colors.cream50, borderRadius: radii.md, paddingVertical: 12 },
  meet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: 2 },
  meetWhen: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  meetWhere: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500 },
  meetNote: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 38, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.navy900 },
  placeInput: { marginTop: spacing.sm, minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: spacing.md, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.cream50 },
  navyButton: { marginTop: spacing.sm, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  redButton: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.red600, alignItems: "center", justifyContent: "center" },
  navyLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  safe: { backgroundColor: "#eef3ec", borderRadius: radii.lg, padding: spacing.md, gap: 3 },
  safeTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: "#1f3d26", marginBottom: 2 },
  safeLine: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: "#1f3d26" },
  problemLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.red600, textAlign: "center", marginTop: spacing.sm },
  pChip: { paddingHorizontal: 12, minHeight: 36, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  pChipOn: { backgroundColor: colors.red600, borderColor: colors.red600 },
  pChipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  problemInput: { minHeight: 80, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, padding: spacing.sm, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.surface, textAlignVertical: "top" },
});
