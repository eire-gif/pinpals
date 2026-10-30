import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Kicker, proStyles } from "@/components/pro-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { dublinParts, euroCents, hoursLine, type HoursRow } from "@/lib/pro-rules";
import { loadDiary, loadEarnings, loadMyHours, loadMyPro, setProPaused, type Lesson, type Pro } from "@/lib/pros";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing } from "@/lib/theme";

type Hub = { pro: Pro | null; hours: HoursRow[]; diary: Lesson[]; earnings: { heldCents: number; paidCents: number }; payoutsReady: boolean };

/**
 * Book a pro (0204): Teach on PinPals. Before applying, what it is; while
 * PinPals checks, where it stands; once approved, the pro's diary — what's
 * booked, what's coming to them after PinPals' 10% — and the things to set
 * up: what they offer, their hours, getting paid.
 */
export default function TeachScreen() {
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const [hub, setHub] = useState<Hub | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const pro = await loadMyPro(me);
      const [hours, diary, earnings, account] = pro
        ? await Promise.all([
            loadMyHours(pro.id),
            loadDiary(pro.id),
            loadEarnings(pro.id),
            supabase.from("stripe_connected_accounts").select("charges_enabled, payouts_enabled").eq("user_id", me).maybeSingle(),
          ])
        : [[], [], { heldCents: 0, paidCents: 0 }, { data: null }];
      const acct = (account as { data: { charges_enabled: boolean; payouts_enabled: boolean } | null }).data;
      setHub({ pro, hours, diary, earnings, payoutsReady: !!acct?.charges_enabled && !!acct?.payouts_enabled });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [me]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("bookAPro")) return <StateMessage size="screen" icon="school-outline" title="Book a pro is on its way" />;
  if (failed && hub === null) return <LoadError size="screen" onRetry={() => void load()} what="your lessons" />;
  if (hub === null) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  const { pro } = hub;
  const refresh = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    />
  );

  if (!pro) {
    return (
      <ScrollView style={proStyles.screen} contentContainerStyle={proStyles.body} refreshControl={refresh}>
        <Stack.Screen options={{ title: "Teach on PinPals" }} />
        <View style={styles.hero}>
          <Kicker color={colors.gold400}>FOR PROS AND FITTERS</Kicker>
          <Text style={styles.heroTitle}>List your lessons</Text>
          <Text style={styles.heroBody}>Golfers near you find you, pick a time and pay in the app. You keep 90%; PinPals keeps 10%. Paid to your bank after each lesson.</Text>
        </View>
        <Point icon="shield-checkmark-outline" text="PGA professionals, and qualified teaching pros and club fitters. PinPals checks your PGA number or qualification before you go live." />
        <Point icon="time-outline" text="You set what you offer, your prices, your hours and your own cancellation terms." />
        <Point icon="card-outline" text="Payments through Stripe. If you cancel, the golfer gets everything back." />
        <Pressable style={proStyles.primary} onPress={() => router.push("/teach/apply")} accessibilityRole="button">
          <Text style={proStyles.primaryText}>Apply to teach</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const live = pro.status === "approved";
  const todo: { label: string; to: () => void }[] = [];
  if (pro.services.length === 0) todo.push({ label: "Add what you offer and your prices", to: () => router.push("/teach/services") });
  if (hub.hours.length === 0) todo.push({ label: "Set the hours you teach", to: () => router.push("/teach/hours") });
  if (!hub.payoutsReady) todo.push({ label: "Set up getting paid (Stripe)", to: () => router.push("/payouts") });

  const days = new Map<string, Lesson[]>();
  for (const l of hub.diary) {
    const p = dublinParts(l.starts_at);
    const key = `${p.dow.toUpperCase()} ${p.day} ${p.month.toUpperCase()}`;
    days.set(key, [...(days.get(key) ?? []), l]);
  }

  const togglePause = async () => {
    try {
      await setProPaused(live);
      await load();
    } catch (e) {
      Alert.alert("Couldn't change that", e instanceof Error ? e.message : "Please try again.");
    }
  };

  return (
    <ScrollView style={proStyles.screen} contentContainerStyle={{ paddingBottom: spacing.xl * 2 }} refreshControl={refresh}>
      <Stack.Screen options={{ title: "Teach on PinPals" }} />
      <View style={[styles.hero, { borderRadius: 0 }]}>
        <Kicker color={colors.gold400}>
          {pro.status === "pending" ? "WAITING FOR PINPALS" : pro.status === "declined" ? "NOT APPROVED" : pro.status === "paused" ? "BOOKINGS PAUSED" : "YOUR LESSONS"}
        </Kicker>
        <Text style={styles.heroTitle}>{live || pro.status === "paused" ? "Your diary" : pro.status === "pending" ? "Thanks for applying" : "Not this time"}</Text>
        {live || pro.status === "paused" ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>Booked</Text>
              <Text style={styles.tileValue}>{hub.diary.length}</Text>
            </View>
            <View style={[styles.tile, { backgroundColor: colors.green100 }]}>
              <Text style={[styles.tileLabel, { color: colors.green800 }]}>Coming to you</Text>
              <Text style={[styles.tileValue, { color: colors.ink900 }]}>{euroCents(hub.earnings.heldCents)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.heroBody}>
            {pro.status === "pending"
              ? "PinPals is checking your details. You'll get a message when you're live. Set up your lessons and hours meanwhile."
              : `PinPals couldn't approve it: ${pro.declineReason ?? "no reason given"}. Change it and send it again.`}
          </Text>
        )}
        {live || pro.status === "paused" ? <Text style={styles.heroNote}>{`After PinPals' 10%. Paid to your bank once each lesson's time has passed. ${euroCents(hub.earnings.paidCents)} paid so far.`}</Text> : null}
      </View>

      <View style={proStyles.body}>
        {todo.length ? (
          <View style={[proStyles.card, { borderColor: colors.gold500 }]}>
            {todo.map((t, i) => (
              <Pressable key={t.label} style={[styles.todo, i > 0 && styles.rowLine]} onPress={t.to} accessibilityRole="button">
                <Ionicons name="alert-circle" size={20} color={colors.gold500} />
                <Text style={styles.todoText}>{t.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {(live || pro.status === "paused") && hub.diary.length === 0 ? <Text style={proStyles.hint}>Nothing booked yet. Golfers find you in Book a pro.</Text> : null}
        {[...days.entries()].map(([label, items]) => (
          <View key={label} style={{ gap: 6 }}>
            <Kicker>{label}</Kicker>
            <View style={proStyles.card}>
              {items.map((l, i) => (
                <Pressable key={l.id} style={[styles.lesson, i > 0 && styles.rowLine]} onPress={() => router.push({ pathname: "/lesson/[id]", params: { id: String(l.id) } })} accessibilityRole="button">
                  <Text style={styles.lessonTime}>{dublinParts(l.starts_at).time}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.lessonWho} numberOfLines={1}>
                      {l.golferName}
                    </Text>
                    <Text style={proStyles.hint} numberOfLines={1}>
                      {[l.title, ...l.focus].join(" · ")}
                      {l.note ? ` · “${l.note}”` : ""}
                    </Text>
                  </View>
                  <Text style={styles.lessonNet}>{euroCents(l.price_cents - l.commission_cents)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <View style={proStyles.card}>
          <Row icon="pricetags-outline" title="What you offer" sub={pro.services.length ? `${pro.services.length} on offer` : "Nothing yet"} onPress={() => router.push("/teach/services")} />
          <Row icon="time-outline" title="Your hours and time off" sub={hoursLine(hub.hours)} onPress={() => router.push("/teach/hours")} />
          <Row icon="person-circle-outline" title="Your details and bio" sub="What golfers read about you, and your cancellation terms" onPress={() => router.push("/teach/apply")} />
          <Row icon="eye-outline" title="See your page" sub="As golfers see it" onPress={() => router.push({ pathname: "/pros/[id]", params: { id: String(pro.id) } })} />
          <Row icon="card-outline" title="Getting paid" sub={hub.payoutsReady ? "Set up with Stripe" : "Not set up yet"} onPress={() => router.push("/payouts")} last />
        </View>

        {live || pro.status === "paused" ? (
          <Pressable style={proStyles.secondary} onPress={() => void togglePause()} accessibilityRole="button">
            <Text style={proStyles.secondaryText}>{live ? "Pause new bookings" : "Take bookings again"}</Text>
          </Pressable>
        ) : null}
        {live ? <Text style={[proStyles.hint, { textAlign: "center" }]}>Pausing hides you from Book a pro. Lessons already booked stay booked.</Text> : null}
      </View>
    </ScrollView>
  );
}

function Point({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <Ionicons name={icon} size={22} color={colors.green700} />
      <Text style={[proStyles.hint, { flex: 1, fontSize: 15, color: colors.ink900 }]}>{text}</Text>
    </View>
  );
}

function Row({ icon, title, sub, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[styles.todo, !last && { borderBottomWidth: 1, borderBottomColor: colors.cream100 }]} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={22} color={colors.green700} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.todoText}>{title}</Text>
        <Text style={proStyles.hint} numberOfLines={2}>
          {sub}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.navy900, padding: spacing.lg, gap: 10, borderRadius: radii.lg },
  heroTitle: { fontFamily: fonts.display, fontSize: 28, color: colors.cream50 },
  heroBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: "#c9d1dc" },
  heroNote: { fontFamily: fonts.body, fontSize: 12, color: "#c9d1dc" },
  tile: { flex: 1, backgroundColor: colors.navy800, borderRadius: radii.md, padding: 12, gap: 2 },
  tileLabel: { fontFamily: fonts.body, fontSize: 12, color: "#c9d1dc" },
  tileValue: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.cream50 },
  todo: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 56 },
  todoText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  lesson: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 10, minHeight: 56 },
  lessonTime: { width: 48, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  lessonWho: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  lessonNet: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },
});
