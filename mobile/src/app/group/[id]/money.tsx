import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Chip, Kicker, LinkRow, euro } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { CLAIM_LABELS } from "@/lib/outing-payments";
import { outingDateLabel } from "@/lib/outing-rules";
import { claimOutingPaid, markOutingPaid } from "@/lib/outings";
import { claimMembershipPaid, loadMoney, loadPaymentClaims, markMembership, mySocietyAreas, type Money, type PaymentClaim } from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The treasurer's view (0145): this season's money at a glance — what's
 * come in, what's still owed, what went back — the payments members say
 * they've made (confirm or "not received"), membership and each event's
 * fees. For anyone with the society's "money" area.
 */
export default function MoneyScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);

  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  const [money, setMoney] = useState<Money | null>(null);
  const [claims, setClaims] = useState<PaymentClaim[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const areas = await mySocietyAreas(groupId);
      if (!areas.includes("money")) {
        setAllowed(false);
        return;
      }
      setAllowed(true);
      const [m, c] = await Promise.all([loadMoney(groupId), loadPaymentClaims(groupId)]);
      setMoney(m);
      setClaims(c);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const header = <Stack.Screen options={{ title: "Money", headerBackTitle: "Back" }} />;

  if (allowed === undefined && !failed) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (allowed === false) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="lock-closed-outline" title="For the treasurer" body="The treasurer, captain and secretary look after the society's money." size="screen" />
      </View>
    );
  }
  if (failed && !money) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="the money" size="screen" />
      </View>
    );
  }
  if (!money) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  const ms = money.membership;
  const events = money.events ?? [];
  const methods = money.methods ?? { cash: 0, transfer: 0, card: 0 };
  const collected = (ms.enabled ? ms.collected_cents : 0) + events.reduce((s, e) => s + e.collected_cents, 0);
  const outstanding = (ms.enabled ? ms.outstanding_cents : 0) + events.reduce((s, e) => s + e.outstanding_cents, 0);
  const refunded = events.reduce((s, e) => s + (e.refunded_cents ?? 0), 0);
  const id = String(groupId);

  function confirm(c: PaymentClaim) {
    const how = c.method === "cash" ? "cash" : "transfer";
    if (c.kind === "event" && c.outingId != null) {
      const outingId = c.outingId;
      void act(key(c), () => markOutingPaid(outingId, c.memberId, how));
    } else if (c.kind === "membership" && c.season != null) {
      const season = c.season;
      void act(key(c), () => markMembership(groupId, c.memberId, season, "paid", how));
    }
  }

  function notReceived(c: PaymentClaim) {
    Alert.alert("Not received?", `${c.name}'s "I've paid" is taken away, and it shows as unpaid again.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Not received",
        style: "destructive",
        onPress: () => {
          if (c.kind === "event" && c.outingId != null) {
            const outingId = c.outingId;
            void act(key(c), () => claimOutingPaid(outingId, null, c.memberId));
          } else {
            void act(key(c), () => claimMembershipPaid(groupId, null, c.memberId));
          }
        },
      },
    ]);
  }

  const msTotal = ms.enabled ? ms.paid + ms.unpaid + ms.claimed : 0;

  return (
    <View style={styles.fill}>
      {header}
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {/* Season at a glance */}
        <View style={styles.hero}>
          <Kicker color={colors.gold400}>{`Season ${money.season_label}`}</Kicker>
          <View style={styles.tiles}>
            <Tile label="COLLECTED" value={euro(collected) || "€0"} />
            <Tile label="OUTSTANDING" value={euro(outstanding) || "€0"} warn={outstanding > 0} />
            <Tile label="REFUNDED" value={euro(refunded) || "€0"} />
          </View>
          <Text style={styles.methods}>{`Revolut/transfer ${euro(methods.transfer) || "€0"} · Cash ${euro(methods.cash) || "€0"} · Card ${euro(methods.card) || "€0"}`}</Text>
        </View>

        {/* Say they've paid */}
        {claims.length > 0 ? (
          <Card>
            <Text style={styles.cardTitle} accessibilityRole="header">{`Say they've paid · ${claims.length}`}</Text>
            {claims.map((c, i) => (
              <View key={key(c)} style={[styles.claimRow, i > 0 && styles.rule]}>
                <View style={{ gap: 1 }}>
                  <Text style={styles.claimName}>{c.name}</Text>
                  <Text style={styles.muted}>
                    {[c.kind === "membership" ? `Membership · ${c.title}` : c.title, c.amountCents != null ? euro(c.amountCents) : null, `by ${CLAIM_LABELS[c.method]}`].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <View style={styles.claimActions}>
                  <Pressable
                    style={[styles.pill, styles.pillOk]}
                    onPress={() => confirm(c)}
                    disabled={busy !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm ${c.name} paid by ${CLAIM_LABELS[c.method]}`}
                  >
                    {busy === key(c) ? <ActivityIndicator size="small" color={colors.cream50} /> : <Ionicons name="checkmark" size={16} color={colors.cream50} />}
                    <Text style={styles.pillOkText}>Confirm</Text>
                  </Pressable>
                  <Pressable style={styles.pill} onPress={() => notReceived(c)} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`Not received from ${c.name}`}>
                    <Text style={styles.pillText}>Not received</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Membership */}
        {ms.enabled ? (
          <Card>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} accessibilityRole="header">
                Membership
              </Text>
              <Text style={styles.muted}>{`${euro(ms.fee_cents)} a year`}</Text>
            </View>
            <Bar share={msTotal > 0 ? ms.paid / msTotal : 0} label={`${ms.paid} of ${msTotal} paid`} />
            <View style={styles.splitRow}>
              <Text style={styles.okText}>{`${ms.paid} paid · ${euro(ms.collected_cents) || "€0"}`}</Text>
              <Text style={ms.unpaid > 0 ? styles.dueText : styles.muted}>{`${ms.unpaid} unpaid · ${euro(ms.outstanding_cents) || "€0"}`}</Text>
            </View>
            {ms.claimed || ms.honorary || ms.lapsed ? (
              <Text style={styles.muted}>{[ms.claimed ? `${ms.claimed} say they've paid` : null, ms.honorary ? `${ms.honorary} honorary` : null, ms.lapsed ? `${ms.lapsed} lapsed` : null].filter(Boolean).join(" · ")}</Text>
            ) : null}
            <LinkRow icon="people-outline" title="Who hasn't paid" detail="The members list, unpaid first" onPress={() => router.push({ pathname: "/group/[id]/committee", params: { id, filter: "unpaid" } } as never)} />
          </Card>
        ) : null}

        {/* Events */}
        <Card>
          <Text style={styles.cardTitle} accessibilityRole="header">
            Events
          </Text>
          {events.length === 0 ? (
            <Text style={styles.muted}>No events with a fee this season.</Text>
          ) : (
            events.map((e, i) => {
              const owing = e.entrants - e.waived;
              return (
                <Pressable
                  key={e.id}
                  style={[styles.eventRow, i > 0 && styles.rule]}
                  onPress={() => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id, outingId: String(e.id) } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title}, ${outingDateLabel(e.plays_on)}, ${e.paid} of ${e.entrants} paid, ${e.outstanding_cents > 0 ? `${euro(e.outstanding_cents)} due` : "settled"}`}
                >
                  <View style={styles.eventHead}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.eventTitle} numberOfLines={1}>
                        {e.title}
                      </Text>
                      <Text style={styles.muted}>{`${outingDateLabel(e.plays_on)} · ${euro(e.fee_cents)}`}</Text>
                    </View>
                    <Chip tone={e.played ? "grey" : "asked"}>{e.played ? "Played" : "Open"}</Chip>
                  </View>
                  <Bar share={owing > 0 ? e.paid / owing : e.entrants > 0 ? 1 : 0} />
                  <View style={styles.splitRow}>
                    <Text style={styles.muted}>{`${e.paid} of ${e.entrants} paid · ${euro(e.collected_cents) || "€0"}`}</Text>
                    {e.outstanding_cents > 0 ? <Text style={styles.dueText}>{`${euro(e.outstanding_cents)} due`}</Text> : <Text style={styles.okText}>Settled</Text>}
                  </View>
                </Pressable>
              );
            })
          )}
        </Card>

        <Button label="Remind everyone unpaid" icon="notifications-outline" onPress={() => router.push({ pathname: "/group/[id]/message", params: { id, audience: "fees_unpaid" } } as never)} />
        <Button label="Accounts (CSV)" tone="line" icon="download-outline" onPress={() => router.push({ pathname: "/group/[id]/exports", params: { id } } as never)} />
      </ScrollView>
    </View>
  );
}

const key = (c: PaymentClaim) => `${c.kind}:${c.outingId ?? c.season ?? ""}:${c.memberId}`;

function Tile({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label.toLowerCase()} ${value}`}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, warn && { color: colors.gold400 }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function Bar({ share, label }: { share: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, share));
  return (
    <View style={styles.bar} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  hero: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: { flex: 1, gap: 2, padding: 10, borderRadius: radii.md, backgroundColor: colors.navy800 },
  tileLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1, color: colors.cream100 },
  tileValue: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  methods: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  rule: { borderTopWidth: 1, borderTopColor: colors.line },
  claimRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  claimName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  claimActions: { flexDirection: "row", gap: spacing.sm },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pillOk: { borderColor: colors.green700, backgroundColor: colors.green700 },
  pillText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  pillOkText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  bar: { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: colors.red100 },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.green600 },
  splitRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" },
  okText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700 },
  dueText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.red600 },
  eventRow: { gap: 6, paddingVertical: spacing.sm, minHeight: 44 },
  eventHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eventTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
});
