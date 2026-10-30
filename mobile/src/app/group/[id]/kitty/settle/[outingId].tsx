import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { officeAreas } from "@/lib/groups";
import { loadKitty, markKittyPaid, undoKittyPayment, type KittyPage } from "@/lib/kitty";
import { kittyEuros } from "@/lib/kitty-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The trip kitty (0202): settle up. The fewest payments that square
 * everyone — yours first — each ticked off as paid by either of the two (or
 * whoever runs the trip), which takes it off the list. Payments already
 * ticked are listed under it, with Undo.
 */
export default function KittySettleScreen() {
  const { id: rawId, outingId: rawOuting } = useLocalSearchParams<{ id: string; outingId: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [page, setPage] = useState<KittyPage | null | undefined>(undefined);
  const [officer, setOfficer] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [p, g] = await Promise.all([loadKitty(outingId, groupId), loadGroupPage(groupId, me).catch(() => null)]);
      setPage(p);
      setOfficer(officeAreas(g?.myRole ?? null, g?.myOffice ?? null).includes("events"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [outingId, groupId, me]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (failed && page === undefined) return <LoadError size="screen" onRetry={() => void load()} what="the kitty" />;
  if (page === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!page) return <StateMessage size="screen" icon="wallet-outline" title="The trip kitty is on its way" />;

  const nameOf = (id: string) => (id === me ? "You" : (page.people.find((p) => p.id === id)?.name.split(" ")[0] ?? "Someone"));
  const mineIn = page.toSettle.filter((t) => t.to === me);
  const mineOut = page.toSettle.filter((t) => t.from === me);
  const others = page.toSettle.filter((t) => t.to !== me && t.from !== me);
  const canTick = (from: string, to: string) => officer || from === me || to === me;

  const tick = async (from: string, to: string, cents: number) => {
    const key = `${from}-${to}`;
    setBusy(key);
    try {
      await markKittyPaid(outingId, from, to, cents);
      await load();
    } catch (e) {
      Alert.alert("Couldn't tick that off", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const undo = async (id: number) => {
    setBusy(`u${id}`);
    try {
      await undoKittyPayment(id);
      await load();
    } catch (e) {
      Alert.alert("Couldn't undo that", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const shareAll = () => {
    const lines = page.toSettle.map((t) => `${page.people.find((p) => p.id === t.from)?.name.split(" ")[0] ?? "?"} → ${page.people.find((p) => p.id === t.to)?.name.split(" ")[0] ?? "?"}: ${kittyEuros(t.cents)}`);
    void Share.share({ message: [`${page.tripTitle} kitty — to settle up:`, ...lines, "Revolut, bank or cash — tick it off on PinPals when it's paid."].join("\n") });
  };

  const row = (t: { from: string; to: string; cents: number }, i: number) => {
    const key = `${t.from}-${t.to}`;
    return (
      <View key={key} style={[styles.row, i > 0 && styles.rowLine]}>
        <Text style={styles.who}>
          <Text style={{ fontFamily: fonts.bodyBold }}>{nameOf(t.from)}</Text>
          {t.from === me ? " pay " : t.to === me ? " pays " : " → "}
          <Text style={{ fontFamily: fonts.bodyBold }}>{t.to === me ? "you" : nameOf(t.to)}</Text>
        </Text>
        <Text style={styles.amount}>{kittyEuros(t.cents)}</Text>
        {canTick(t.from, t.to) ? (
          <Pressable style={styles.tick} disabled={busy === key} onPress={() => void tick(t.from, t.to, t.cents)} accessibilityRole="button" accessibilityLabel={`Mark ${kittyEuros(t.cents)} from ${nameOf(t.from)} as paid`}>
            {busy === key ? <ActivityIndicator color={colors.green700} /> : <Text style={styles.tickText}>Mark as paid</Text>}
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "Settle up" }} />
      {page.toSettle.length === 0 ? (
        <View style={[styles.card, { padding: spacing.md, gap: 4 }]}>
          <Text style={styles.title}>Everyone&apos;s square</Text>
          <Text style={styles.meta}>Nobody owes anybody — add more to the kitty as you go.</Text>
        </View>
      ) : (
        <Text style={styles.meta}>{`${page.toSettle.length} payment${page.toSettle.length === 1 ? "" : "s"} square${page.toSettle.length === 1 ? "s" : ""} everyone.`}</Text>
      )}

      {mineIn.length ? (
        <View style={[styles.card, { backgroundColor: colors.green100, borderColor: colors.green100 }]}>
          <Text style={styles.kicker}>{`COMING TO YOU · ${kittyEuros(mineIn.reduce((n, t) => n + t.cents, 0))}`}</Text>
          {mineIn.map(row)}
        </View>
      ) : null}
      {mineOut.length ? (
        <View style={[styles.card, { backgroundColor: "#fbf3dc", borderColor: colors.gold500 }]}>
          <Text style={[styles.kicker, { color: "#5a4512" }]}>{`YOU PAY · ${kittyEuros(mineOut.reduce((n, t) => n + t.cents, 0))}`}</Text>
          {mineOut.map(row)}
        </View>
      ) : null}
      {others.length ? (
        <>
          <Text style={styles.section}>EVERYONE ELSE</Text>
          <View style={styles.card}>{others.map(row)}</View>
        </>
      ) : null}

      {page.payments.length ? (
        <>
          <Text style={styles.section}>PAID</Text>
          <View style={styles.card}>
            {page.payments.map((p, i) => (
              <View key={p.id} style={[styles.row, i > 0 && styles.rowLine]}>
                <Ionicons name="checkmark-circle" size={20} color={colors.green700} />
                <Text style={styles.who}>{`${nameOf(p.from)} paid ${p.to === me ? "you" : nameOf(p.to)}`}</Text>
                <Text style={styles.amount}>{kittyEuros(p.amountCents)}</Text>
                {canTick(p.from, p.to) || p.markedBy === me ? (
                  <Pressable onPress={() => void undo(p.id)} disabled={busy === `u${p.id}`} accessibilityRole="button" style={styles.undo}>
                    <Text style={styles.undoText}>Undo</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={[styles.card, { flexDirection: "row", gap: 10, padding: spacing.md, alignItems: "center" }]}>
        <Ionicons name="information-circle-outline" size={22} color={colors.ink500} />
        <Text style={[styles.meta, { flex: 1 }]}>Pay each other by Revolut, bank or cash — PinPals keeps the tally, never the money.</Text>
      </View>

      {page.toSettle.length ? (
        <Pressable style={styles.share} onPress={shareAll} accessibilityRole="button">
          <Text style={styles.shareText}>Share to the chat</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, paddingVertical: 6 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: colors.green800, paddingHorizontal: spacing.md, paddingTop: 8 },
  section: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: colors.ink500 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, minHeight: 54 },
  rowLine: { borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)" },
  who: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink900 },
  amount: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  tick: { minHeight: 38, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface, justifyContent: "center" },
  tickText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },
  undo: { minHeight: 38, paddingHorizontal: 8, justifyContent: "center" },
  undoText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy800 },
  share: { minHeight: 48, borderRadius: radii.md, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  shareText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
