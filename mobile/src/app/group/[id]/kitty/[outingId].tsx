import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadKitty, type KittyPage } from "@/lib/kitty";
import { kittyEuros, splitShares, type KittyCategory } from "@/lib/kitty-rules";
import { outingDateLabel } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const KITTY_ICON: Record<KittyCategory, keyof typeof Ionicons.glyphMap> = {
  golf: "flag-outline",
  travel: "car-outline",
  food: "restaurant-outline",
  drinks: "beer-outline",
  stay: "bed-outline",
  other: "receipt-outline",
};

/**
 * The trip kitty (0202): what's been paid, by whom and split between whom,
 * what's been spent and where you stand. "+ Add what you paid" and "Settle
 * up". As on the "PinPals Next Ideas" canvas.
 */
export default function KittyScreen() {
  const { id: rawId, outingId: rawOuting } = useLocalSearchParams<{ id: string; outingId: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [page, setPage] = useState<KittyPage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setPage(await loadKitty(outingId, groupId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [outingId, groupId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("tripKitty")) return <StateMessage size="screen" icon="wallet-outline" title="The trip kitty is on its way" />;
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
  const spent = page.expenses.reduce((n, e) => n + e.amountCents, 0);
  const mine = me ? (page.balances.get(me) ?? 0) : 0;
  const add = () => router.push({ pathname: "/group/[id]/kitty/add", params: { id: String(groupId), outing: String(outingId) } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream50 }}>
      <Stack.Screen options={{ title: "The kitty" }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
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
        <View style={styles.hero}>
          <Text style={styles.kicker}>{`${page.tripTitle.toUpperCase()} · ${page.people.length} GOING`}</Text>
          <Text style={styles.title}>The kitty</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>Spent so far</Text>
              <Text style={styles.tileValue}>{kittyEuros(spent)}</Text>
            </View>
            <View style={[styles.tile, mine > 0 ? styles.tileOwed : mine < 0 ? styles.tileOwe : null]}>
              <Text style={[styles.tileLabel, mine !== 0 && { color: colors.ink900 }]}>{mine > 0 ? "You're owed" : mine < 0 ? "You owe" : "You're square"}</Text>
              <Text style={[styles.tileValue, mine !== 0 && { color: colors.ink900 }]}>{kittyEuros(Math.abs(mine))}</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {page.expenses.length === 0 ? (
            <StateMessage icon="wallet-outline" title="Nothing in the kitty yet" body="Paid for green fees, a taxi or dinner for the group? Add it and PinPals splits it and keeps the tally." />
          ) : (
            <>
              <Text style={styles.section}>WHAT&apos;S BEEN PAID</Text>
              <View style={styles.card}>
                {page.expenses.map((e, i) => {
                  const each = splitShares(e.amountCents, e.shares);
                  const everyone = e.shares.length === page.people.length;
                  const myShare = me ? each.get(me) : undefined;
                  return (
                    <Pressable
                      key={e.id}
                      style={[styles.row, i > 0 && styles.rowLine]}
                      onPress={() => router.push({ pathname: "/group/[id]/kitty/add", params: { id: String(groupId), outing: String(outingId), expense: String(e.id) } })}
                      accessibilityRole="button"
                    >
                      <View style={styles.icon}>
                        <Ionicons name={KITTY_ICON[e.category]} size={18} color={colors.green700} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {e.title}
                        </Text>
                        <Text style={styles.meta} numberOfLines={2}>
                          {`${nameOf(e.paidBy)} paid · ${everyone ? `split ${e.shares.length} ways` : `${e.shares.length} of you`}${myShare != null ? ` · your share ${kittyEuros(myShare)}` : ""} · ${outingDateLabel(e.spentOn)}`}
                        </Text>
                      </View>
                      <Text style={styles.amount}>{kittyEuros(e.amountCents)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          <Text style={styles.meta}>Pay each other by Revolut, bank or cash — PinPals keeps the tally, never the money.</Text>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable style={[styles.btn, styles.btnMain]} onPress={add} accessibilityRole="button">
          <Text style={[styles.btnText, { color: colors.cream50 }]}>+ Add what you paid</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() => router.push({ pathname: "/group/[id]/kitty/settle/[outingId]", params: { id: String(groupId), outingId: String(outingId) } })}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>{page.toSettle.length ? `Settle up · ${page.toSettle.length}` : "Settle up"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  hero: { backgroundColor: colors.navy900, padding: spacing.lg, gap: 10 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.cream50 },
  tile: { flex: 1, backgroundColor: colors.navy800, borderRadius: radii.md, padding: 12 },
  tileOwed: { backgroundColor: colors.green100 },
  tileOwe: { backgroundColor: colors.gold400 },
  tileLabel: { fontFamily: fonts.body, fontSize: 12, color: "#c9d1dc" },
  tileValue: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md },
  section: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.8, color: colors.ink500 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 60 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.cream50, borderTopWidth: 1, borderTopColor: colors.line },
  btn: { flex: 1, minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  btnMain: { backgroundColor: colors.green700 },
  btnText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
});
