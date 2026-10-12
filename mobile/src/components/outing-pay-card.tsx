import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CLAIM_LABELS, formatIban, paymentReference, payWays, revolutUrl, type ClaimMethod } from "@/lib/outing-payments";
import { feeLabel, PAID_LABELS, type PaidStatus } from "@/lib/outing-rules";
import type { Outing } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A member's "Pay" card on an outing (0127): the amount, the ways the
 * organiser takes money (a Revolut button, bank details to copy, cash),
 * and "I've paid" so the organiser knows to check and confirm.
 *
 * PinPals never moves the money: the Revolut button opens revolut.me/<name>
 * (the Revolut app if it's installed; card payment on the web page if not).
 * Bank details are long-press-to-copy text — no clipboard module, so this
 * ships over the air.
 */
export function OutingPayCard({
  outing,
  myName,
  paid,
  claim,
  busy,
  onClaim,
}: {
  outing: Outing;
  myName: string;
  paid: PaidStatus | undefined;
  claim: ClaimMethod | undefined;
  busy: boolean;
  onClaim: (method: ClaimMethod | null) => void;
}) {
  const fee = feeLabel(outing.entryFeeCents);
  const noun = outing.kind === "day" ? "Entry" : "Cost";

  if (paid) {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <Ionicons name="checkmark-done-circle" size={22} color={colors.green700} />
        <Text style={styles.doneText}>{`${PAID_LABELS[paid]}${paid !== "waived" && fee ? ` · ${fee}` : ""}`}</Text>
      </View>
    );
  }

  const ways = payWays(outing);
  const reference = paymentReference(outing.title, myName);

  function sayPaid() {
    const options: ClaimMethod[] = ways.length ? ways : ["revolut", "transfer", "cash"];
    Alert.alert("How did you pay?", "The organisers check and confirm it.", [
      ...options.map((m) => ({ text: m === "revolut" ? "Revolut" : m === "transfer" ? "Bank transfer" : "Cash", onPress: () => onClaim(m) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  return (
    <View style={styles.card} accessibilityLabel={`${noun} ${fee}, not paid yet`}>
      <View style={styles.head}>
        <Text style={styles.kicker}>{claim ? "WAITING TO BE CONFIRMED" : "NOT PAID YET"}</Text>
        <Text style={styles.amount}>{`Pay ${fee ?? ""}`}</Text>
        {outing.payNote ? <Text style={styles.note}>{outing.payNote}</Text> : null}
      </View>

      {claim ? (
        <View style={styles.claim}>
          <Ionicons name="time-outline" size={18} color={colors.navy900} />
          <Text style={styles.claimText}>{`You said you paid by ${CLAIM_LABELS[claim]}. The organisers will confirm it here.`}</Text>
          <Pressable onPress={() => onClaim(null)} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Undo, I haven't paid">
            <Text style={styles.undo}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      {!claim && outing.payRevtag ? (
        <Pressable style={styles.revolut} onPress={() => void Linking.openURL(revolutUrl(outing.payRevtag!))} accessibilityRole="link" accessibilityLabel={`Pay ${fee ?? ""} with Revolut to @${outing.payRevtag}`}>
          <View style={styles.revolutMark}>
            <Ionicons name="send" size={15} color={colors.navy900} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.revolutTitle}>Pay with Revolut</Text>
            <Text style={styles.revolutSub}>{`@${outing.payRevtag} · enter ${fee ?? "the amount"}`}</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={colors.cream50} />
        </Pressable>
      ) : null}

      {!claim && outing.payIban ? (
        <View style={styles.bank}>
          <Text style={styles.wayTitle}>Bank transfer</Text>
          <Row label="Name" value={outing.payAccountName ?? ""} />
          <Row label="IBAN" value={formatIban(outing.payIban)} mono />
          <Row label="Reference" value={reference} />
          <Text style={styles.hint}>Press and hold to copy.</Text>
        </View>
      ) : null}

      {!claim && outing.payCash ? (
        <View style={styles.cash}>
          <Ionicons name="cash-outline" size={18} color={colors.green700} />
          <Text style={styles.cashText}>Cash to the organisers is fine too.</Text>
        </View>
      ) : null}

      {!claim && ways.length === 0 ? <Text style={styles.hint}>Pay the organisers — they&apos;ll mark it here.</Text> : null}

      {!claim ? (
        <Pressable style={styles.paidButton} onPress={sayPaid} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.navy900} /> : <Ionicons name="checkmark-circle-outline" size={18} color={colors.navy900} />}
          <Text style={styles.paidButtonText}>I&apos;ve paid</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm + 2, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.gold400, backgroundColor: "#fbf3df" },
  cardDone: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderColor: colors.green600, backgroundColor: colors.green100 },
  doneText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.green800 },
  head: { gap: 2 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: "#7a5a12" },
  amount: { fontFamily: fonts.display, fontSize: 26, color: colors.navy900 },
  note: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  claim: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface },
  claimText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  undo: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.red600 },
  revolut: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 14, borderRadius: radii.md, backgroundColor: colors.navy900 },
  revolutMark: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  revolutTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  revolutSub: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  bank: { gap: 6, padding: 12, borderRadius: radii.md, backgroundColor: colors.surface },
  wayTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  row: { flexDirection: "row", gap: spacing.sm },
  rowLabel: { width: 76, fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  rowValue: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  mono: { letterSpacing: 0.5 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  cash: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cashText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  paidButton: { flexDirection: "row", gap: 6, minHeight: 46, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.navy900, backgroundColor: colors.surface },
  paidButtonText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
});
