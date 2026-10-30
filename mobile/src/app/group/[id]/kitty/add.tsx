import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { LoadError } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { deleteKittyExpense, loadKitty, saveKittyExpense, type KittyPage } from "@/lib/kitty";
import { KITTY_CATEGORIES, kittyEuros, parseKittyAmount, splitShares, type KittyCategory } from "@/lib/kitty-rules";
import { irishToday } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The trip kitty (0202): add what you paid — or change something already
 * in it. What it was, how much, who paid, and who it's split between
 * (everyone going, unless you say otherwise).
 */
export default function KittyAddScreen() {
  const { id: rawId, outing, expense } = useLocalSearchParams<{ id: string; outing: string; expense?: string }>();
  const groupId = Number(rawId);
  const outingId = Number(outing);
  const expenseId = expense ? Number(expense) : null;
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [page, setPage] = useState<KittyPage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<KittyCategory>("golf");
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [shares, setShares] = useState<Set<string>>(new Set());
  const [spentOn, setSpentOn] = useState(irishToday());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await loadKitty(outingId, groupId);
      setPage(p);
      setFailed(false);
      if (!p) return;
      const existing = expenseId ? p.expenses.find((e) => e.id === expenseId) : undefined;
      if (existing) {
        setTitle(existing.title);
        setAmount((existing.amountCents / 100).toFixed(existing.amountCents % 100 ? 2 : 0));
        setCategory(existing.category);
        setPaidBy(existing.paidBy);
        setShares(new Set(existing.shares));
        setSpentOn(existing.spentOn);
      } else {
        setPaidBy((v) => v ?? me);
        setShares((s) => (s.size ? s : new Set(p.people.map((x) => x.id))));
      }
    } catch {
      setFailed(true);
    }
    // Only on open: typing mustn't be overwritten by a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outingId, groupId, expenseId]);
  useFocusEffect(
    useCallback(() => {
      if (page === undefined) void load();
    }, [load, page])
  );

  if (failed && page === undefined) return <LoadError size="screen" onRetry={() => void load()} what="the kitty" />;
  if (!page) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  const cents = parseKittyAmount(amount);
  const list = [...shares];
  const each = cents ? splitShares(cents, list) : new Map<string, number>();
  const problem = !title.trim() ? "Say what it was for" : cents == null ? "Put in the amount" : !paidBy ? "Who paid?" : list.length === 0 ? "Split it between at least one person" : null;
  const everyone = page.people.every((p) => shares.has(p.id));

  const save = async () => {
    if (problem || cents == null || !paidBy) return;
    setBusy(true);
    try {
      // Keep the people's order, so odd cents land the same way every time.
      const ordered = page.people.map((p) => p.id).filter((id) => shares.has(id));
      await saveKittyExpense(outingId, expenseId, { title, category, amountCents: cents, paidBy, spentOn, shares: ordered.length ? ordered : list });
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert("Take this off the kitty?", "Everyone's balance changes to match.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Take it off",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteKittyExpense(expenseId!);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't take it off", e instanceof Error ? e.message : "Please try again.");
          }
        },
      },
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: expenseId ? "Change it" : "Add what you paid" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>What was it for?</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="Green fees, taxis, dinner…" placeholderTextColor={colors.ink500} maxLength={80} style={styles.input} accessibilityLabel="What it was for" />

        <Text style={styles.label}>How much?</Text>
        <View style={styles.amountRow}>
          <Text style={styles.euro}>€</Text>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={colors.ink500} keyboardType="decimal-pad" style={styles.amountInput} accessibilityLabel="Amount in euro" maxLength={10} />
        </View>

        <View style={styles.chips}>
          {KITTY_CATEGORIES.map((c) => {
            const on = c.id === category;
            return (
              <Pressable key={c.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setCategory(c.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Who paid?</Text>
        <View style={styles.chips}>
          {page.people.map((p) => {
            const on = p.id === paidBy;
            return (
              <Pressable key={p.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setPaidBy(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.id === me ? "You" : p.name.split(" ")[0]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
          <Text style={[styles.label, { flex: 1, marginTop: 0 }]}>{`Split between ${list.length}`}</Text>
          <Pressable onPress={() => setShares(everyone ? new Set(paidBy ? [paidBy] : []) : new Set(page.people.map((p) => p.id)))} accessibilityRole="button" style={styles.link}>
            <Text style={styles.linkText}>{everyone ? "Just who paid" : "Everyone"}</Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          {page.people.map((p, i) => {
            const on = shares.has(p.id);
            return (
              <Pressable
                key={p.id}
                style={[styles.person, i > 0 && styles.rowLine]}
                onPress={() =>
                  setShares((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    return next;
                  })
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Ionicons name={on ? "checkbox" : "square-outline"} size={24} color={on ? colors.green700 : colors.ink500} />
                <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={30} />
                <Text style={styles.personName} numberOfLines={1}>
                  {p.id === me ? `${p.name} (you)` : p.name}
                </Text>
                {on && each.get(p.id) != null ? <Text style={styles.share}>{kittyEuros(each.get(p.id)!)}</Text> : null}
              </Pressable>
            );
          })}
        </View>

        {problem && (title || amount) ? <Text style={styles.warn}>{problem}</Text> : null}
        <Pressable style={[styles.save, (!!problem || busy) && { opacity: 0.5 }]} disabled={!!problem || busy} onPress={save} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.saveText}>{expenseId ? "Save" : "Add to the kitty"}</Text>}
        </Pressable>
        {expenseId ? (
          <Pressable style={styles.link} onPress={remove} accessibilityRole="button">
            <Text style={[styles.linkText, { color: colors.red600, textAlign: "center" }]}>Take it off the kitty</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900, marginTop: spacing.sm },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.surface },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 60, borderWidth: 2, borderColor: colors.gold500, borderRadius: radii.md, paddingHorizontal: 14, backgroundColor: "#fbf3df" },
  euro: { fontFamily: fonts.bodyBold, fontSize: 26, color: "#8a6a24" },
  amountInput: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 28, color: colors.navy900, padding: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  chipTextOn: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  person: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, minHeight: 52 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  personName: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink900 },
  share: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink500 },
  warn: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.red600 },
  save: { minHeight: 50, borderRadius: radii.md, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  saveText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  linkText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
