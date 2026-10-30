import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/avatar";
import { Kicker, KindBadge, ServiceRow, fromPrice, proPhoto, proStyles } from "@/components/pro-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { PRO_KIND_LABEL, euroCents, lessonWhen, policyLine } from "@/lib/pro-rules";
import { loadPro, loadSlots, type Pro } from "@/lib/pros";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Book a pro (0204): one pro's page, as on the "PinPals Book a Pro" canvas —
 * the course photograph, the pro's own bio, what they offer (the cheapest
 * lesson picked out), their cancellation terms, and Book.
 */
export default function ProScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const proId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const insets = useSafeAreaInsets();
  const [pro, setPro] = useState<Pro | null | undefined>(undefined);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await loadPro(proId);
      setPro(p);
      setFailed(false);
      const first = p?.services[0];
      if (first) setNext((await loadSlots(first.id, 14).catch(() => []))[0] ?? null);
    } catch {
      setFailed(true);
    }
  }, [proId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isOn("bookAPro")) return <StateMessage size="screen" icon="school-outline" title="Book a pro is on its way" />;
  if (failed && pro === undefined) return <LoadError size="screen" onRetry={() => void load()} what="this pro" />;
  if (pro === undefined) {
    return (
      <View style={[proStyles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!pro || (pro.status !== "approved" && pro.memberId !== me)) {
    return <StateMessage size="screen" icon="school-outline" title="This pro isn't taking bookings" body="They may have paused their bookings for now." />;
  }

  const mine = pro.memberId === me;
  const from = fromPrice(pro);
  const featured = pro.services.length > 1 ? [...pro.services].sort((a, b) => b.minutes - a.minutes).find((s) => s.kind === "lesson") ?? null : null;
  const book = (serviceId: number) => router.push({ pathname: "/pros/book/[serviceId]", params: { serviceId: String(serviceId) } });

  return (
    <View style={proStyles.screen}>
      <Stack.Screen options={{ title: "", headerTransparent: true, headerTintColor: colors.cream50 }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        <View style={{ height: 270 + insets.top }}>
          <Image source={proPhoto(pro.club)} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(12,32,56,0.55)" }]} />
          {next ? (
            <View style={[styles.nextPill, { top: insets.top + 52 }]}>
              <View style={styles.dot} />
              <Text style={styles.nextText}>Next free: {lessonWhen(next)}</Text>
            </View>
          ) : null}
          <View style={styles.heroFoot}>
            <Avatar url={pro.avatarUrl} color={pro.avatarColor} name={pro.name} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <KindBadge kind={pro.kind} onDark />
              <Text style={styles.name} numberOfLines={2}>
                {pro.name}
              </Text>
              <Text style={styles.club} numberOfLines={1}>
                {PRO_KIND_LABEL[pro.kind]} · {pro.club}
                {pro.county ? `, Co. ${pro.county}` : ""}
              </Text>
            </View>
          </View>
        </View>

        <View style={proStyles.body}>
          {mine && pro.status !== "approved" ? (
            <View style={proStyles.terms}>
              <Ionicons name="eye-outline" size={20} color="#5a4512" />
              <Text style={proStyles.termsText}>This is how golfers will see your page once PinPals approves you.</Text>
            </View>
          ) : null}

          {pro.bio ? <Text style={styles.bio}>{pro.bio}</Text> : null}

          {featured ? (
            <Pressable style={styles.featured} onPress={() => book(featured.id)} disabled={mine} accessibilityRole="button">
              <Kicker color={colors.gold400}>MOST POPULAR</Kicker>
              <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.featuredTitle}>{`${featured.title} · ${featured.minutes} min`}</Text>
                  {featured.details ? <Text style={styles.featuredSub}>{featured.details}</Text> : null}
                </View>
                <Text style={styles.featuredPrice}>{euroCents(featured.priceCents)}</Text>
              </View>
            </Pressable>
          ) : null}

          <Kicker>BOOK</Kicker>
          <View style={proStyles.card}>
            {pro.services.map((s, i) => (
              <ServiceRow key={s.id} s={s} last={i === pro.services.length - 1} onPress={mine ? undefined : () => book(s.id)} />
            ))}
          </View>

          <View style={proStyles.terms}>
            <Ionicons name="time-outline" size={20} color="#5a4512" />
            <Text style={proStyles.termsText}>{policyLine(pro.cancelPolicy, pro.name.split(" ")[0])}</Text>
          </View>
          <Text style={proStyles.hint}>
            {pro.kind === "pga" ? "A PGA professional — PinPals checked their PGA membership." : "PinPals checked their qualification before listing them."} You pay in the app; nothing is added on top.
          </Text>
        </View>
      </ScrollView>

      {!mine && pro.services.length ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View>
            <Text style={proStyles.hint}>From</Text>
            <Text style={styles.footerPrice}>{from != null ? euroCents(from) : ""}</Text>
          </View>
          <Pressable style={[proStyles.primary, { flex: 1 }]} onPress={() => book((featured ?? pro.services[0]).id)} accessibilityRole="button">
            <Text style={proStyles.primaryText}>Book a lesson</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  nextPill: { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.green100, borderRadius: 16, paddingHorizontal: 12, minHeight: 32 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green700 },
  nextText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green800 },
  heroFoot: { position: "absolute", left: 20, right: 20, bottom: 18, flexDirection: "row", alignItems: "flex-end", gap: 14 },
  name: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: "#fff" },
  club: { fontFamily: fonts.body, fontSize: 14, color: colors.cream50 },
  bio: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink900 },
  featured: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: 8 },
  featuredTitle: { fontFamily: fonts.display, fontSize: 20, color: "#fff" },
  featuredSub: { fontFamily: fonts.body, fontSize: 13, color: "#c9d1dc" },
  featuredPrice: { fontFamily: fonts.bodyBold, fontSize: 26, color: colors.gold400 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: spacing.md, paddingTop: 12, backgroundColor: colors.cream50, borderTopWidth: 1, borderTopColor: colors.line },
  footerPrice: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.ink900 },
});
