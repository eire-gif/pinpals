import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Kicker, euro } from "@/components/society-bits";
import { LoadError } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage, type GroupMember } from "@/lib/groups-data";
import { indexLabel, parseIndex } from "@/lib/live-scoring";
import { outingDateLabel } from "@/lib/outing-rules";
import { loadOuting, requestOutingPlace, type OutingPage } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Asking for a place on an event (0142), or changing what you asked for.
 *
 * Meal (from the event's options), a guest (name and index), who you'd like
 * to play with, an early or late tee time, and a note for the captain. On a
 * request-only event you're "Requested" until an officer answers; on a
 * first-come event you're in straight away if there's room for you (and your
 * guest), or on the waiting list if not. Nothing to pay until you're in.
 */
export default function RequestPlaceScreen() {
  const { id: rawId, outingId: rawOuting } = useLocalSearchParams<{ id: string; outingId: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [page, setPage] = useState<OutingPage | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [meal, setMeal] = useState<string | null>(null);
  const [withGuest, setWithGuest] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestIndex, setGuestIndex] = useState("");
  const [guestMeal, setGuestMeal] = useState<string | null>(null);
  const [playWith, setPlayWith] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [teePref, setTeePref] = useState<"early" | "late" | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [o, g] = await Promise.all([loadOuting(outingId), loadGroupPage(groupId, userId)]);
      setPage(o);
      setMembers((g?.members ?? []).filter((m) => m.id !== userId));
      setFailed(false);
      // Start from what they asked for before, once.
      if (o && !loaded) {
        const c = o.choices.get(userId);
        const q = o.queue.find((x) => x.memberId === userId);
        if (c) {
          setMeal(c.meal);
          setGuestMeal(c.guestMeal);
          setPlayWith(c.playWith);
          setTeePref(c.teePref);
          setNote(c.note ?? "");
        }
        if (q?.guestName) {
          setWithGuest(true);
          setGuestName(q.guestName);
          setGuestIndex(q.guestIndex != null ? indexLabel(q.guestIndex) : "");
        }
        setLoaded(true);
      }
    } catch {
      setFailed(true);
    }
  }, [groupId, outingId, userId, loaded]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (page === undefined && !failed) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Request a place", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Request a place", headerBackTitle: "Back" }} />
        <LoadError onRetry={() => void load()} what="this event" size="screen" />
      </View>
    );
  }

  const { outing } = page;
  const already = page.entries.some((e) => e.memberId === userId) ? "confirmed" : page.queue.find((q) => q.memberId === userId)?.status ?? null;
  const fee = outing.entryFeeCents ?? 0;
  const guestFee = outing.guestFeeCents ?? outing.entryFeeCents ?? 0;
  const total = fee + (withGuest ? guestFee : 0);
  const partner = members.find((m) => m.id === playWith) ?? null;
  const request = outing.entryMode === "request";
  // A guest is asked for with the place; once you're in, the officers add them.
  const canAddGuest = outing.guestsAllowed && already !== "confirmed";

  async function send() {
    const index = guestIndex.trim() ? parseIndex(guestIndex) : null;
    if (withGuest && !guestName.trim()) {
      Alert.alert("Your guest's name", "Add your guest's name, or switch off Bring a guest.");
      return;
    }
    if (withGuest && guestIndex.trim() && index == null) {
      Alert.alert("Check the index", "A handicap index looks like 14.2, or +1.5 for a plus handicap.");
      return;
    }
    setBusy(true);
    try {
      const status = await requestOutingPlace(outingId, {
        meal,
        guestMeal: withGuest ? guestMeal : null,
        playWith,
        teePref,
        note: note.trim() || null,
        guest: withGuest && canAddGuest ? { name: guestName.trim(), index } : null,
      });
      const said =
        status === "confirmed"
          ? already === "confirmed"
            ? ["Saved", "Your choices are updated."]
            : ["You're in", fee ? "Your place is confirmed. You can pay on the event page." : "Your place is confirmed."]
          : status === "waiting"
            ? ["On the waiting list", "It's full just now. You'll get a notification as soon as a place opens — then you have 24 hours to take it."]
            : ["Request sent", "You'll get a notification when the captain answers."];
      Alert.alert(said[0], said[1]);
      router.back();
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const mealPicker = (value: string | null, set: (v: string | null) => void, label: string) =>
    outing.mealOptions.length > 0 ? (
      <View style={styles.block} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <Kicker>{label}</Kicker>
        {outing.mealOptions.map((m) => {
          const on = value === m;
          return (
            <Pressable key={m} style={[styles.option, on && styles.optionOn]} onPress={() => set(on ? null : m)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={colors.navy900} />
              <Text style={styles.optionText}>{m}</Text>
            </Pressable>
          );
        })}
      </View>
    ) : null;

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: already ? "Your place" : request ? "Request a place" : "Get a place", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View>
          <Text style={styles.title}>{outing.title}</Text>
          <Text style={styles.meta}>{[outingDateLabel(outing.playsOn), outing.courseName].filter(Boolean).join(" · ")}</Text>
        </View>

        {mealPicker(meal, setMeal, "Your meal")}

        {canAddGuest ? (
          <Card>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.strong}>Bring a guest</Text>
                <Text style={styles.hint}>{`They take a place too${guestFee ? ` · guest fee ${euro(guestFee)}, paid by you` : ""}. Guests don't need PinPals.`}</Text>
              </View>
              <Switch value={withGuest} onValueChange={setWithGuest} accessibilityLabel="Bring a guest" />
            </View>
            {withGuest ? (
              <>
                <View style={styles.fields}>
                  <TextInput value={guestName} onChangeText={setGuestName} placeholder="Guest's name" placeholderTextColor={colors.ink500} style={[styles.input, { flex: 1 }]} maxLength={60} autoCapitalize="words" accessibilityLabel="Guest's name" />
                  <TextInput value={guestIndex} onChangeText={setGuestIndex} placeholder="Index" placeholderTextColor={colors.ink500} style={[styles.input, { width: 84, textAlign: "center" }]} keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel="Guest's handicap index, optional" />
                </View>
                {mealPicker(guestMeal, setGuestMeal, "Their meal")}
              </>
            ) : null}
          </Card>
        ) : already === "confirmed" && outing.guestsAllowed ? (
          <Text style={styles.hint}>To add a guest now you&apos;re in, ask the captain or secretary.</Text>
        ) : null}

        <View style={styles.block}>
          <Kicker>Playing requests · optional</Kicker>
          <View style={styles.pills}>
            <Pressable style={[styles.pill, partner && styles.pillOn]} onPress={() => setChoosing((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: choosing }}>
              <Text style={styles.pillText}>{partner ? `With ${partner.name}` : "Play with…"}</Text>
            </Pressable>
            {partner ? (
              <Pressable style={styles.pill} onPress={() => setPlayWith(null)} accessibilityRole="button" accessibilityLabel={`Don't ask to play with ${partner.name}`}>
                <Ionicons name="close" size={16} color={colors.navy900} />
              </Pressable>
            ) : null}
            {(["early", "late"] as const).map((t) => (
              <Pressable key={t} style={[styles.pill, teePref === t && styles.pillOn]} onPress={() => setTeePref(teePref === t ? null : t)} accessibilityRole="button" accessibilityState={{ selected: teePref === t }}>
                <Text style={styles.pillText}>{t === "early" ? "Early tee" : "Late tee"}</Text>
              </Pressable>
            ))}
          </View>
          {choosing ? (
            <View style={styles.list}>
              {members.map((m) => (
                <Pressable
                  key={m.id}
                  style={styles.option}
                  onPress={() => {
                    setPlayWith(m.id);
                    setChoosing(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.optionText}>{m.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.label}>Note to the captain</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Anything they should know" placeholderTextColor={colors.ink500} style={[styles.input, styles.note]} multiline maxLength={200} accessibilityLabel="Note to the captain" />
          <Text style={styles.hint}>Only you and the people running the event see your requests and note.</Text>
        </View>

        {!already ? (
          <View style={styles.next}>
            <Kicker>What happens next</Kicker>
            <Step n={1} tone="#dce6f5">{request ? "You show as Requested until the captain or secretary confirms." : "If there's room you're in straight away."}</Step>
            <Step n={2} tone={colors.green100}>Confirmed: you get a notification, and can pay.</Step>
            <Step n={3} tone="#f5e6c6">If it's full, you go on the waiting list. When a place opens you have 24 hours to take it.</Step>
          </View>
        ) : null}

        {fee ? (
          <View style={styles.total}>
            <Text style={styles.strong}>{withGuest ? "You + 1 guest" : "Entry"}</Text>
            <Text style={styles.money}>{euro(total)}</Text>
          </View>
        ) : null}
        <Button label={already ? "Save" : request ? "Send request" : "Get my place"} onPress={() => void send()} busy={busy} />
        {fee && !already ? <Text style={[styles.hint, { textAlign: "center" }]}>Nothing to pay until you&apos;re confirmed</Text> : null}
      </ScrollView>
    </View>
  );
}

function Step({ n, tone, children }: { n: number; tone: string; children: string }) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepN, { backgroundColor: tone }]}>
        <Text style={styles.stepNText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  block: { gap: spacing.sm },
  option: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  optionOn: { borderColor: colors.navy900, backgroundColor: colors.cream100 },
  optionText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  strong: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, lineHeight: 18 },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink500 },
  fields: { flexDirection: "row", gap: spacing.sm },
  input: { minHeight: 46, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  note: { minHeight: 70, paddingTop: 10, textAlignVertical: "top" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: { flexDirection: "row", alignItems: "center", minHeight: 40, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  pillOn: { borderColor: colors.navy900, backgroundColor: colors.cream100 },
  pillText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.navy900 },
  list: { gap: 6, maxHeight: 320 },
  next: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.cream100 },
  step: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepN: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepNText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink900 },
  stepText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink900, lineHeight: 20 },
  total: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  money: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
});
