import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ImageBackground, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { colors, fonts, radii, spacing } from "@/lib/theme";
import { handicapChange, loadFirstName, loadWrapped, monthName, shareWrapped, wrappedYear, type Wrapped } from "@/lib/wrapped-data";

/**
 * PinPals Wrapped — your year in golf (claude/wrapped.md; approved mock-ups
 * "PinPals Wrapped": cover, the numbers, your people and share).
 *
 * Full screen, story style: tap the right side for the next card, the left
 * for the one before. The last card shares the year as a picture sized for
 * an Instagram story, drawn by the website from the same numbers.
 */
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export default function WrappedScreen() {
  const params = useLocalSearchParams<{ year?: string }>();
  const year = params.year && /^\d{4}$/.test(params.year) ? Number(params.year) : wrappedYear(new Date());
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const insets = useSafeAreaInsets();
  const [w, setW] = useState<Wrapped | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [first, setFirst] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setFailed(false);
      const [data, name] = await Promise.all([loadWrapped(userId, year), loadFirstName(userId).catch(() => null)]);
      setW(data);
      setFirst(name ?? "");
    } catch {
      setFailed(true);
    }
  }, [userId, year]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const chrome = <Stack.Screen options={{ headerShown: false }} />;

  if (!isOn("wrapped")) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: "Your year in golf" }} />
        <StateMessage size="screen" icon="sparkles-outline" title="Your year in golf is on its way" />
      </>
    );
  }
  if (failed) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: "Your year in golf" }} />
        <LoadError size="screen" what="your year" onRetry={() => void load()} />
      </>
    );
  }
  if (!w) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.navy900 }]}>
        {chrome}
        <ActivityIndicator color={colors.gold400} style={{ marginTop: 200 }} />
      </View>
    );
  }

  const pages = w.rounds === 0 ? 1 : 3;
  const next = () => (page < pages - 1 ? setPage(page + 1) : close());
  const prev = () => page > 0 && setPage(page - 1);

  const share = async () => {
    setSharing(true);
    try {
      const r = await shareWrapped(year);
      if (r === "saved") Alert.alert("Saved to your Photos", "Post it to your Instagram story from there.");
    } catch (e) {
      Alert.alert("Couldn't make the picture", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSharing(false);
    }
  };

  const top = (
    <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
      <View style={styles.segs}>
        {Array.from({ length: pages }, (_, i) => (
          <View key={i} style={[styles.seg, i <= page && styles.segOn]} />
        ))}
      </View>
      <View style={styles.topRow}>
        <Text style={styles.brand}>PINPALS WRAPPED</Text>
        <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={colors.cream50} />
        </Pressable>
      </View>
    </View>
  );

  // Tap zones: left third back, the rest forward. Buttons sit above them.
  const zones = (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.zoneLeft} onPress={prev} accessibilityRole="button" accessibilityLabel="Previous" />
      <Pressable style={styles.zoneRight} onPress={next} accessibilityRole="button" accessibilityLabel={page < pages - 1 ? "Next" : "Close"} />
    </View>
  );

  if (page === 0) {
    return (
      <ImageBackground source={require("../../assets/images/scenes/old-head.jpg")} style={styles.screen} resizeMode="cover">
        {chrome}
        <StatusBar style="light" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(12,32,56,0.62)" }]} />
        <View style={[StyleSheet.absoluteFill, { top: "45%", backgroundColor: "rgba(12,32,56,0.55)" }]} />
        {zones}
        {top}
        <View style={[styles.coverBody, { paddingBottom: insets.bottom + 34 }]} pointerEvents="box-none">
          <Text style={styles.eyebrow}>{first ? `${first.toUpperCase()}, THIS WAS` : "THIS WAS"}</Text>
          <Text style={styles.coverTitle}>{`Your ${year}\nin golf`}</Text>
          {w.rounds === 0 ? (
            <Text style={styles.coverLine}>No rounds saved yet this year. Score a round with PinPals and your year starts here.</Text>
          ) : (
            <>
              <View style={styles.bigRow}>
                <Text style={styles.big}>{w.rounds}</Text>
                <Text style={styles.bigLabel}>{`round${w.rounds === 1 ? "" : "s"}\non PinPals`}</Text>
              </View>
              <Text style={styles.coverLine}>{`That's about ${w.km} kilometres walked. Tap to see the rest.`}</Text>
            </>
          )}
          <Pressable onPress={next} style={styles.gold} accessibilityRole="button">
            <Text style={styles.goldText}>{w.rounds === 0 ? "Close" : "See my year"}</Text>
            {w.rounds > 0 ? <Ionicons name="chevron-forward" size={20} color={colors.navy900} /> : null}
          </Pressable>
        </View>
      </ImageBackground>
    );
  }

  if (page === 1) {
    const max = Math.max(1, ...w.byMonth);
    return (
      <View style={[styles.screen, { backgroundColor: "#173f22" }]}>
        {chrome}
        <StatusBar style="light" />
        {zones}
        {top}
        <View style={styles.body} pointerEvents="box-none">
          <Text style={styles.cardTitle}>The numbers</Text>
          {w.handicap ? (
            <View style={[styles.tile, styles.hcp]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.k}>HANDICAP INDEX</Text>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 8 }}>
                  <Text style={styles.was}>{w.handicap.from.toFixed(1)}</Text>
                  <Text style={styles.now}>{w.handicap.to.toFixed(1)}</Text>
                </View>
              </View>
              <View style={styles.delta}>
                <Text style={styles.deltaBig}>{handicapChange(w.handicap)}</Text>
                <Text style={styles.deltaSub}>THIS YEAR</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.grid}>
            <Tile k="BEST ROUND" v={w.best ? String(w.best.points) : w.bestGross ? String(w.bestGross.strokes) : "—"} d={w.best ? `pts · ${w.best.courseName}, ${short(w.best.playedOn)}` : w.bestGross ? `strokes · ${w.bestGross.courseName}` : "No full card yet"} />
            <Tile k="BIRDIES" v={String(w.birdies)} d={w.eagles ? `plus ${w.eagles} eagle${w.eagles === 1 ? "" : "s"}` : `${w.pars} pars too`} />
            <Tile k="COURSES" v={String(w.courses)} d={w.topCourse ? `most: ${w.topCourse.name}` : "—"} />
            <Tile k="NEW COURSES" v={String(w.newCourses)} d={w.newestCourse ? `${w.newestCourse} the latest` : "Same old favourites"} />
          </View>
          <View style={styles.tile}>
            <Text style={styles.k}>{w.busiestMonth != null ? `ROUNDS BY MONTH · BUSIEST ${monthName(w.busiestMonth).toUpperCase()}` : "ROUNDS BY MONTH"}</Text>
            <View style={styles.bars} accessible accessibilityLabel={`Rounds by month, busiest ${w.busiestMonth != null ? monthName(w.busiestMonth) : "none"}`}>
              {w.byMonth.map((n, i) => (
                <View key={i} style={styles.barCol}>
                  <View style={[styles.bar, { height: `${Math.max(n ? 8 : 2, (n / max) * 100)}%`, opacity: n ? 1 : 0.35 }]} />
                  <Text style={styles.barLabel}>{MONTH_LETTERS[i]}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: "#4a1622" }]}>
      {chrome}
      <StatusBar style="light" />
      {zones}
      {top}
      <View style={styles.body} pointerEvents="box-none">
        <Text style={styles.eyebrow}>YOU&apos;RE A</Text>
        <Text style={styles.cardTitle}>{w.persona.title}</Text>
        <Text style={styles.persona}>{w.persona.line}</Text>
        {w.partner ? (
          <Row icon={<Text style={styles.avText}>{initials(w.partner.name)}</Text>} k="PARTNER OF THE YEAR" v={w.partner.name} d={`${w.partner.rounds} round${w.partner.rounds === 1 ? "" : "s"} together`} />
        ) : null}
        {w.topCourse ? (
          <Row icon={<Ionicons name="flag" size={24} color={colors.green700} />} light k="HOME FROM HOME" v={w.topCourse.name} d={`${w.topCourse.rounds} round${w.topCourse.rounds === 1 ? "" : "s"} there`} />
        ) : null}
        {w.countries > 1 ? (
          <Row icon={<Ionicons name="earth" size={24} color={colors.cream50} />} green k="ON TOUR" v={`${w.countries} countries`} d="Passport stamped" />
        ) : null}
      </View>
      <View style={[styles.shareBox, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable onPress={() => void share()} style={styles.gold} disabled={sharing} accessibilityRole="button">
          {sharing ? <ActivityIndicator color={colors.navy900} /> : <Text style={styles.goldText}>Share to Instagram story</Text>}
        </Pressable>
        <Pressable onPress={() => router.push("/passport")} style={styles.outline} accessibilityRole="button">
          <Text style={styles.outlineText}>Open my Course Passport</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Tile({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <View style={[styles.tile, { flexBasis: "47%", flexGrow: 1 }]}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
      <Text style={styles.d} numberOfLines={2}>
        {d}
      </Text>
    </View>
  );
}

function Row({ icon, k, v, d, light, green }: { icon: React.ReactNode; k: string; v: string; d: string; light?: boolean; green?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={[styles.av, light && { backgroundColor: colors.cream50 }, green && { backgroundColor: colors.green700 }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.k}>{k}</Text>
        <Text style={styles.rowV}>{v}</Text>
        <Text style={styles.rowD}>{d}</Text>
      </View>
    </View>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]!.toUpperCase())
    .join("");
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: 14, gap: 12, zIndex: 2 },
  segs: { flexDirection: "row", gap: 5 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  segOn: { backgroundColor: colors.gold400 },
  topRow: { flexDirection: "row", alignItems: "center" },
  brand: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, letterSpacing: 4, color: colors.gold400 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  zoneLeft: { position: "absolute", left: 0, top: 120, bottom: 0, width: "33%" },
  zoneRight: { position: "absolute", right: 0, top: 120, bottom: 0, width: "67%" },
  coverBody: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 24, gap: 6 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 15, letterSpacing: 3, color: colors.gold400 },
  coverTitle: { fontFamily: fonts.display, fontSize: 60, lineHeight: 60, color: colors.cream50, marginTop: 8 },
  bigRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 24 },
  big: { fontFamily: fonts.bodyBold, fontSize: 104, lineHeight: 104, color: colors.gold400 },
  bigLabel: { fontFamily: fonts.bodySemi, fontSize: 21, lineHeight: 26, color: colors.cream50, marginBottom: 12 },
  coverLine: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: "#d9d2c2", marginTop: 12, marginBottom: 22 },
  gold: { minHeight: 58, borderRadius: 20, backgroundColor: colors.gold400, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderBottomWidth: 4, borderBottomColor: "#a8802f" },
  goldText: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.navy900 },
  outline: { minHeight: 54, borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(247,243,234,0.5)", alignItems: "center", justifyContent: "center" },
  outlineText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.cream50 },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 18, gap: 12 },
  cardTitle: { fontFamily: fonts.display, fontSize: 42, lineHeight: 46, color: colors.cream50 },
  persona: { fontFamily: fonts.body, fontSize: 17, lineHeight: 23, color: "#ecd3d6", marginBottom: 6 },
  tile: { backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(232,196,107,0.45)", padding: 14 },
  hcp: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.navy900, borderColor: "#c9a24a" },
  k: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.8, color: colors.gold400 },
  v: { fontFamily: fonts.bodyBold, fontSize: 38, color: "#fff", marginTop: 8 },
  d: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 18, color: "#d6e4da", marginTop: 4 },
  was: { fontFamily: fonts.bodySemi, fontSize: 22, color: "#9aa6ba", textDecorationLine: "line-through" },
  now: { fontFamily: fonts.bodyBold, fontSize: 44, color: "#fff" },
  delta: { alignItems: "center", backgroundColor: colors.green700, borderRadius: radii.lg, paddingVertical: 10, paddingHorizontal: 14 },
  deltaBig: { fontFamily: fonts.bodyBold, fontSize: 26, color: "#fff" },
  deltaSub: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2, color: "#cfe0d4", marginTop: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 90, marginTop: 12 },
  barCol: { flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center", gap: 4 },
  bar: { width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: colors.gold400 },
  barLabel: { fontFamily: fonts.bodyBold, fontSize: 10, color: "#cfe0d4" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.22)", borderWidth: 1.5, borderColor: "rgba(232,196,107,0.45)" },
  av: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  avText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.navy900 },
  rowV: { fontFamily: fonts.bodyBold, fontSize: 21, color: "#fff", marginTop: 4 },
  rowD: { fontFamily: fonts.body, fontSize: 14, color: "#ecd3d6", marginTop: 2 },
  shareBox: { paddingHorizontal: 18, gap: 10, zIndex: 2 },
});
