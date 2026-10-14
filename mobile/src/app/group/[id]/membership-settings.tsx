import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Kicker } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { compactIban, formatIban, ibanIsValid, normaliseRevtag } from "@/lib/outing-payments";
import { parseFee } from "@/lib/outing-rules";
import { loadMembershipSettings, saveMembershipSettings, type MembershipSettings } from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Annual membership settings (0143): owner and admins. Whether the society
 * charges a yearly fee at all, how much, when the season starts, when it
 * falls due, what happens to someone who hasn't paid, and how members pay
 * the treasurer. save_membership_settings() decides who may.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DUE_DAYS = [0, 14, 30, 60, 90];

export default function MembershipSettingsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [state, setState] = useState<"loading" | "failed" | "denied" | "ready">("loading");
  const [enabled, setEnabled] = useState(false);
  const [fee, setFee] = useState("");
  const [startMonth, setStartMonth] = useState(1);
  const [dueAfter, setDueAfter] = useState(30);
  const [policy, setPolicy] = useState<"allow" | "block">("allow");
  const [revtag, setRevtag] = useState("");
  const [iban, setIban] = useState("");
  const [accountName, setAccountName] = useState("");
  const [cash, setCash] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [page, s] = await Promise.all([loadGroupPage(groupId, userId), loadMembershipSettings(groupId)]);
      if (!page || (page.myRole !== "owner" && page.myRole !== "admin")) {
        setState("denied");
        return;
      }
      setEnabled(s.enabled);
      setFee(s.feeCents != null ? (s.feeCents % 100 === 0 ? String(s.feeCents / 100) : (s.feeCents / 100).toFixed(2)) : "");
      setStartMonth(s.seasonStartMonth);
      setDueAfter(s.dueAfterDays);
      setPolicy(s.unpaidPolicy);
      setRevtag(s.payRevtag ?? "");
      setIban(s.payIban ? formatIban(s.payIban) : "");
      setAccountName(s.payAccountName ?? "");
      setCash(s.payCash);
      setNote(s.payNote ?? "");
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [groupId, userId]);

  // Load once on focus, but don't throw away edits when coming back.
  const [loadedOnce, setLoadedOnce] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (loadedOnce) return;
      setLoadedOnce(true);
      void load();
    }, [load, loadedOnce])
  );

  const header = <Stack.Screen options={{ title: "Membership settings", headerBackTitle: "Back" }} />;

  if (state === "loading") {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (state === "failed") {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="membership settings" size="screen" />
      </View>
    );
  }
  if (state === "denied") {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="lock-closed-outline" title="Only whoever runs the society can change this" size="screen" />
      </View>
    );
  }

  async function save() {
    const feeCents = parseFee(fee);
    const tag = normaliseRevtag(revtag);
    const ibanCompact = compactIban(iban);
    if (enabled && feeCents === undefined) {
      Alert.alert("Check the fee", "Write the fee as a number, like 80 or 65.50.");
      return;
    }
    if (enabled && feeCents == null) {
      Alert.alert("Add the fee", "How much is a year's membership?");
      return;
    }
    if (tag === undefined) {
      Alert.alert("Check the Revolut name", "A Revolut @name is letters, numbers, dots, dashes or underscores.");
      return;
    }
    if (ibanCompact && !ibanIsValid(ibanCompact)) {
      Alert.alert("Check the IBAN", "That IBAN doesn't add up — one of the characters may be wrong.");
      return;
    }
    if (ibanCompact && !accountName.trim()) {
      Alert.alert("Add the account name", "Whose name is the bank account in? Members' banks check it.");
      return;
    }
    const settings: MembershipSettings = {
      enabled,
      feeCents: feeCents ?? null,
      seasonStartMonth: startMonth,
      dueAfterDays: dueAfter,
      unpaidPolicy: policy,
      payRevtag: tag,
      payIban: ibanCompact,
      payAccountName: accountName.trim() || null,
      payCash: cash,
      payNote: note.trim() || null,
    };
    setSaving(true);
    try {
      await saveMembershipSettings(groupId, settings);
      router.back();
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.fill}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Card>
            <View style={styles.switchRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.switchTitle}>Annual membership</Text>
                <Text style={styles.hint}>Turn off if members only pay per event</Text>
              </View>
              <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel="Annual membership" trackColor={{ true: colors.green600, false: colors.line }} />
            </View>
          </Card>

          {enabled ? (
            <>
              <Card>
                <Kicker>The fee</Kicker>
                <Text style={styles.label} nativeID="feeLabel">
                  Annual fee
                </Text>
                <View style={styles.feeWrap}>
                  <Text style={styles.euroSign}>€</Text>
                  <TextInput
                    style={[styles.input, styles.feeInput]}
                    value={fee}
                    onChangeText={setFee}
                    keyboardType="decimal-pad"
                    placeholder="80"
                    placeholderTextColor={colors.ink500}
                    maxLength={7}
                    accessibilityLabel="Annual fee in euro"
                  />
                </View>

                <Text style={styles.label}>Season starts</Text>
                <View style={styles.chips}>
                  {MONTHS.map((m, i) => (
                    <Choice key={m} label={m} a11y={MONTH_NAMES[i]} selected={startMonth === i + 1} onPress={() => setStartMonth(i + 1)} />
                  ))}
                </View>

                <Text style={styles.label}>Due after</Text>
                <View style={styles.chips}>
                  {DUE_DAYS.map((d) => (
                    <Choice key={d} label={d === 0 ? "Straight away" : `${d} days`} selected={dueAfter === d} onPress={() => setDueAfter(d)} />
                  ))}
                </View>
                <Text style={styles.hint}>{`Due ${dueAfter === 0 ? "on" : `${dueAfter} days after`} 1 ${MONTH_NAMES[startMonth - 1]} each season.`}</Text>
              </Card>

              <Card>
                <Kicker>If someone hasn&apos;t paid</Kicker>
                <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
                  <Radio label="They can still enter events" selected={policy === "allow"} onPress={() => setPolicy("allow")} />
                  <Radio label="They can't enter events until they pay" selected={policy === "block"} onPress={() => setPolicy("block")} />
                </View>
              </Card>

              <Card>
                <Kicker>How members pay</Kicker>
                <Text style={styles.hint}>PinPals never handles the money — members pay the treasurer directly.</Text>

                <Text style={styles.label}>Revolut @name</Text>
                <TextInput
                  style={styles.input}
                  value={revtag}
                  onChangeText={setRevtag}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="@yoursociety"
                  placeholderTextColor={colors.ink500}
                  maxLength={41}
                  accessibilityLabel="Revolut name, optional"
                />

                <Text style={styles.label}>IBAN</Text>
                <TextInput
                  style={styles.input}
                  value={iban}
                  onChangeText={setIban}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="IE29 AIBK 9311 5212 3456 78"
                  placeholderTextColor={colors.ink500}
                  maxLength={42}
                  accessibilityLabel="IBAN, optional"
                />

                <Text style={styles.label}>Account name</Text>
                <TextInput
                  style={styles.input}
                  value={accountName}
                  onChangeText={setAccountName}
                  autoCapitalize="words"
                  placeholder="Name on the account"
                  placeholderTextColor={colors.ink500}
                  maxLength={70}
                  accessibilityLabel="Account name"
                />

                <View style={styles.switchRow}>
                  <Text style={[styles.switchTitle, { flex: 1 }]}>Cash is fine</Text>
                  <Switch value={cash} onValueChange={setCash} accessibilityLabel="Cash is fine" trackColor={{ true: colors.green600, false: colors.line }} />
                </View>

                <Text style={styles.label}>Note to members</Text>
                <TextInput
                  style={[styles.input, styles.multi]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  placeholder="e.g. Pay by the AGM in January"
                  placeholderTextColor={colors.ink500}
                  maxLength={200}
                  accessibilityLabel="Note to members, optional"
                />
              </Card>
            </>
          ) : null}

          <Button label="Save" onPress={() => void save()} busy={saving} icon="checkmark" />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Choice({ label, a11y, selected, onPress }: { label: string; a11y?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.choice, selected && styles.choiceOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={a11y ?? label}
      hitSlop={2}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Radio({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.radio, selected && styles.radioOn]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected, checked: selected }} accessibilityLabel={label}>
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? colors.green700 : colors.ink500} />
      <Text style={styles.radioText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  switchTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  label: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900, marginTop: spacing.xs },
  // 16pt floor: iOS zooms the screen when a smaller input takes focus.
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  multi: { minHeight: 84, paddingTop: 10, textAlignVertical: "top" },
  feeWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  euroSign: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  feeInput: { width: 120 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { minHeight: 44, minWidth: 52, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  choiceOn: { borderColor: colors.navy900, backgroundColor: colors.navy900 },
  choiceText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  choiceTextOn: { color: colors.cream50 },
  radio: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 50, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  radioOn: { borderColor: colors.green600, backgroundColor: colors.green100 },
  radioText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
});
