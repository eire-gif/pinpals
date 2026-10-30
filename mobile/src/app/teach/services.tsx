import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Kicker, ServiceRow, proStyles } from "@/components/pro-bits";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { SERVICE_KIND_LABEL, euroCents, proTake, type ServiceKind } from "@/lib/pro-rules";
import { loadMyPro, removeService, saveService, type Pro, type ProService } from "@/lib/pros";
import { colors, spacing } from "@/lib/theme";

const KINDS: ServiceKind[] = ["lesson", "playing", "fitting"];
const LENGTHS = [30, 45, 60, 90, 120, 150, 180, 240];
const DEFAULT_TITLE: Record<ServiceKind, string> = { lesson: "Lesson", playing: "Playing lesson", fitting: "Club fitting" };

type Draft = { id: number | null; kind: ServiceKind; title: string; details: string; minutes: number; price: string };
const blank = (): Draft => ({ id: null, kind: "lesson", title: "Lesson", details: "", minutes: 60, price: "" });

/**
 * Book a pro (0204): what a pro offers — lessons, playing lessons and
 * fittings, each with a length and a price. Up to 12. Taking one off keeps
 * the lessons already booked.
 */
export default function ServicesScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [pro, setPro] = useState<Pro | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    setPro(await loadMyPro(me).catch(() => null));
  }, [me]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (pro === undefined) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!pro) return <StateMessage size="screen" icon="school-outline" title="Apply to teach first" />;

  const priceCents = draft ? Math.round(Number(draft.price.replace(",", ".").replace(/[^0-9.]/g, "")) * 100) : 0;

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await saveService(draft.id, { kind: draft.kind, title: draft.title, details: draft.details, minutes: draft.minutes, price_cents: priceCents, position: draft.id ? (pro.services.find((s) => s.id === draft.id)?.position ?? 0) : pro.services.length });
      setDraft(null);
      await load();
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = (s: ProService) =>
    Alert.alert(`Take "${s.title}" off?`, "Lessons already booked stay booked.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Take it off",
        style: "destructive",
        onPress: async () => {
          try {
            await removeService(s.id);
            setDraft(null);
            await load();
          } catch (e) {
            Alert.alert("Couldn't take it off", e instanceof Error ? e.message : "Please try again.");
          }
        },
      },
    ]);

  return (
    <KeyboardAvoidingView style={proStyles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "What you offer" }} />
      <ScrollView contentContainerStyle={[proStyles.body, { paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled">
        {pro.services.length ? (
          <View style={proStyles.card}>
            {pro.services.map((s, i) => (
              <ServiceRow
                key={s.id}
                s={s}
                last={i === pro.services.length - 1}
                onPress={() => setDraft({ id: s.id, kind: s.kind, title: s.title, details: s.details ?? "", minutes: s.minutes, price: String(s.priceCents / 100) })}
              />
            ))}
          </View>
        ) : (
          <Text style={proStyles.hint}>Add the lessons, playing lessons and fittings golfers can book, with how long each takes and its price.</Text>
        )}

        {draft ? (
          <View style={[proStyles.card, { padding: spacing.md, gap: 12 }]}>
            <Kicker>{draft.id ? "CHANGE IT" : "ADD ONE"}</Kicker>
            <View style={styles.row}>
              {KINDS.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setDraft({ ...draft, kind: k, title: draft.title === DEFAULT_TITLE[draft.kind] ? DEFAULT_TITLE[k] : draft.title })}
                  style={[proStyles.chip, draft.kind === k && proStyles.chipOn]}
                  accessibilityRole="button"
                >
                  <Text style={[proStyles.chipText, draft.kind === k && proStyles.chipTextOn]}>{SERVICE_KIND_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={proStyles.label}>Name</Text>
            <TextInput value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} maxLength={60} style={proStyles.input} />
            <Text style={proStyles.label}>Details (optional)</Text>
            <TextInput value={draft.details} onChangeText={(t) => setDraft({ ...draft, details: t })} maxLength={120} style={proStyles.input} placeholder="e.g. With video of your swing, sent after" placeholderTextColor={colors.ink500} />
            <Text style={proStyles.label}>How long</Text>
            <View style={styles.row}>
              {LENGTHS.map((m) => (
                <Pressable key={m} onPress={() => setDraft({ ...draft, minutes: m })} style={[proStyles.chip, draft.minutes === m && proStyles.chipOn]} accessibilityRole="button">
                  <Text style={[proStyles.chipText, draft.minutes === m && proStyles.chipTextOn]}>{m < 60 ? `${m} min` : `${m / 60}${m % 60 ? "½" : ""} hr${m >= 120 ? "s" : ""}`}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={proStyles.label}>Price (€)</Text>
            <TextInput value={draft.price} onChangeText={(t) => setDraft({ ...draft, price: t })} keyboardType="decimal-pad" style={proStyles.input} placeholder="e.g. 60" placeholderTextColor={colors.ink500} />
            {priceCents >= 500 ? <Text style={proStyles.hint}>{`You get ${euroCents(proTake(priceCents))} after PinPals' 10%.`}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {draft.id ? (
                <Pressable style={[proStyles.secondary, { borderColor: "#9b2c1f" }]} onPress={() => remove(pro.services.find((s) => s.id === draft.id)!)} accessibilityRole="button" accessibilityLabel="Take it off">
                  <Ionicons name="trash-outline" size={20} color="#9b2c1f" />
                </Pressable>
              ) : null}
              <Pressable style={[proStyles.secondary, { flex: 1 }]} onPress={() => setDraft(null)} accessibilityRole="button">
                <Text style={proStyles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={[proStyles.primary, { flex: 1 }]} onPress={() => void save()} disabled={busy} accessibilityRole="button">
                {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={proStyles.primaryText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        ) : pro.services.length < 12 ? (
          <Pressable style={proStyles.primary} onPress={() => setDraft(blank())} accessibilityRole="button">
            <Text style={proStyles.primaryText}>+ Add a lesson, playing lesson or fitting</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
