import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { TONES } from "@/components/live-scoring-card";
import { PassportMap, type PassportMapHandle } from "@/components/passport-map";
import { LoadError, StateMessage } from "@/components/state-message";
import { TintedHeader } from "@/components/tinted-header";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import {
  IRISH_LINKS_TRAIL,
  PROVINCES,
  badges,
  countriesPlayed,
  loadPassport,
  mapPins,
  provinceCounts,
  type MapView,
  type Passport,
} from "@/lib/passport";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Course Passport (claude/course-passport.md; approved mock-ups "Course
 * Passport", then "a map of the world with stars… Apple Maps… satellite").
 *
 * The map first: a gold star on every course you've played, the newest
 * white with a gold ring, bucket-list courses outlined. Ireland / Europe /
 * World chips. Tap a star for the course. Then the badges, the four
 * provinces and the bucket lists.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ""}`;
};

export default function PassportScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [data, setData] = useState<Passport | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<MapView>("ireland");
  const [selected, setSelected] = useState<number | null>(null);
  // Map only (Oct 30): the details below hide so the map has the whole screen.
  const [mapOnly, setMapOnly] = useState(false);
  const map = useRef<PassportMapHandle | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setFailed(false);
      setData(await loadPassport(userId));
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const pins = useMemo(() => (data ? mapPins(data.stamps, data.bucket, short) : []), [data]);
  const countries = data ? countriesPlayed(data.stamps).length : 0;
  const header = (
    <TintedHeader
      color={TONES.navy.card}
      title="Course Passport"
      subtitle={data ? `${data.stamps.length} course${data.stamps.length === 1 ? "" : "s"} · ${countries} countr${countries === 1 ? "y" : "ies"}` : null}
    />
  );

  if (!isOn("coursePassport")) {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="earth-outline" title="Your Course Passport is on its way" />
      </>
    );
  }
  if (failed) {
    return (
      <>
        {header}
        <LoadError size="screen" what="your passport" onRetry={() => void load()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </>
    );
  }

  const prov = provinceCounts(data.stamps);
  const maxProv = Math.max(1, ...PROVINCES.map((p) => prov[p]));
  const playedIds = new Set(data.stamps.map((s) => s.id));
  const trailDone = IRISH_LINKS_TRAIL.filter((t) => {
    const c = data.trail.get(t.key);
    return c != null && playedIds.has(c.id);
  }).length;
  const myBadges = badges(data.stamps, trailDone, IRISH_LINKS_TRAIL.length);
  const pick = pins.find((p) => p.id === selected) ?? null;
  const newest = data.stamps.find((s) => s.lastPlayed);

  const choose = (v: MapView) => {
    setView(v);
    map.current?.show(v);
  };

  return (
    <>
      {header}
      {/* The map sits OUTSIDE the scrolling details (30 Oct): dragging the
          map used to drag the whole page with it. */}
      <View style={mapOnly ? { flex: 1 } : { height: 360 }}>
        <View style={{ flex: 1 }}>
          <PassportMap ref={map} pins={pins} view={view} onSelect={setSelected} />
          <View style={styles.chips} accessibilityRole="radiogroup">
            {(["ireland", "europe", "world"] as const).map((v) => (
              <Pressable
                key={v}
                onPress={() => choose(v)}
                style={[styles.chip, view === v && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: view === v }}
              >
                <Text style={[styles.chipText, view === v && { color: colors.cream50 }]}>{v === "ireland" ? "Ireland" : v === "europe" ? "Europe" : "World"}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => setMapOnly((v) => !v)}
            style={styles.expand}
            accessibilityRole="button"
            accessibilityLabel={mapOnly ? "Show the details" : "Map only"}
          >
            <Ionicons name={mapOnly ? "contract" : "expand"} size={18} color={colors.navy900} />
            <Text style={styles.expandText}>{mapOnly ? "Details" : "Map only"}</Text>
          </Pressable>
          {pick ? (
            <Pressable
              onPress={() => router.push(`/course/${pick.id}`)}
              style={styles.callout}
              accessibilityRole="button"
              accessibilityLabel={`${pick.title}. ${pick.sub}. Open the course`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.calloutEyebrow}>{pick.kind === "bucket" ? "BUCKET LIST" : pick.kind === "newest" ? "NEWEST STAMP" : "PLAYED"}</Text>
                <Text style={styles.calloutTitle} numberOfLines={1}>
                  {pick.title}
                </Text>
                <Text style={styles.calloutSub}>{pick.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.navy900} />
            </Pressable>
          ) : newest ? (
            <View style={styles.callout} pointerEvents="none">
              <View style={{ flex: 1 }}>
                <Text style={styles.calloutEyebrow}>NEWEST STAMP</Text>
                <Text style={styles.calloutTitle} numberOfLines={1}>
                  {newest.name}
                </Text>
                <Text style={styles.calloutSub}>{`${short(newest.lastPlayed!)} · tap a star for any course`}</Text>
              </View>
            </View>
          ) : null}
        </View>

      </View>

      {mapOnly ? null : (
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl * 2 }}>
        <View style={styles.body}>
          <View style={styles.legend}>
            <Legend dot={styles.dotPlayed} label="Played" />
            <Legend dot={styles.dotBucket} label="Bucket list" />
            <Legend dot={styles.dotGroup} label="Group" />
          </View>

          {data.stamps.length === 0 ? (
            <StateMessage
              icon="earth-outline"
              title="Your passport is empty"
              body="Save a scorecard from a round, or tick the courses you've played on your profile, and they'll be stamped here."
            />
          ) : null}

          <View style={styles.badges}>
            {myBadges.map((b) => (
              <View key={b.id} style={[styles.badge, b.earned ? styles.badgeOn : styles.badgeOff]} accessible accessibilityLabel={`${b.label}: ${b.earned ? "earned" : "not yet"}. ${b.detail}`}>
                <Ionicons
                  name={b.earned ? (b.icon === "globe" ? "earth" : b.icon === "water" ? "water" : b.icon === "flag" ? "flag" : "star") : "lock-closed-outline"}
                  size={24}
                  color={b.earned ? colors.gold400 : colors.ink500}
                />
                <Text style={[styles.badgeLabel, b.earned && { color: colors.cream50 }]} numberOfLines={2}>
                  {b.label}
                </Text>
                <Text style={[styles.badgeDetail, b.earned && { color: "#d9d2c2" }]} numberOfLines={1}>
                  {b.detail}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            {PROVINCES.map((p) => (
              <View key={p} style={styles.prov}>
                <Text style={styles.provName}>{p}</Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.round((prov[p] / maxProv) * 100)}%` }]} />
                </View>
                <Text style={styles.provCount}>{prov[p]}</Text>
              </View>
            ))}
          </View>

          <Pressable onPress={() => router.push({ pathname: "/passport-list", params: { list: "trail" } })} style={styles.bucket} accessibilityRole="button">
            <View style={styles.ring}>
              <Ionicons name="list" size={26} color={colors.gold400} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bucketEyebrow}>BUCKET LIST</Text>
              <Text style={styles.bucketTitle}>{`Irish Links Trail · ${trailDone} of ${IRISH_LINKS_TRAIL.length}`}</Text>
              <Text style={styles.bucketSub}>Twelve of the island&apos;s great links</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.gold400} />
          </Pressable>

          <Pressable onPress={() => router.push({ pathname: "/passport-list", params: { list: "mine" } })} style={styles.link} accessibilityRole="button">
            <Ionicons name="bookmark" size={24} color="#8a6a24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>My bucket list</Text>
              <Text style={styles.linkSub}>{data.bucket.length === 0 ? "Add courses from any course page" : `${data.bucket.filter((b) => !playedIds.has(b.id)).length} still to play`}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
          </Pressable>

          {data.stamps.length > 0 ? (
            <>
              <Text style={styles.label}>LATEST STAMPS</Text>
              <View style={styles.stamps}>
                {data.stamps.slice(0, 6).map((s, i) => (
                  <Pressable
                    key={s.id}
                    onPress={() => router.push(`/course/${s.id}`)}
                    style={[styles.stamp, { transform: [{ rotate: `${[-6, 5, -2, 4, -5, 3][i]}deg` }], borderColor: ["#8a6a24", colors.green700, "#6b2633"][i % 3] }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name}${s.lastPlayed ? `, ${short(s.lastPlayed)}` : ""}`}
                  >
                    <Text style={styles.stampName} numberOfLines={2}>
                      {s.name.replace(/\s+(Golf|Golf Club|Golf Links|GC|Golf & Country Club)$/i, "")}
                    </Text>
                    <Text style={[styles.stampDate, { color: ["#8a6a24", colors.green700, "#6b2633"][i % 3] }]}>{s.lastPlayed ? short(s.lastPlayed).toUpperCase() : "PLAYED"}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
      )}
    </>
  );
}

function Legend({ dot, label }: { dot: object; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, dot]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  expand: { position: "absolute", top: 12, right: 12, minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,0.94)" },
  expandText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  chips: { position: "absolute", top: 12, left: 12, flexDirection: "row", gap: 6 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,0.94)", justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  callout: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1.5, borderColor: "#c9a24a" },
  calloutEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.4, color: "#8a6a24" },
  calloutTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.navy900, marginTop: 3 },
  calloutSub: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink500 },
  body: { padding: spacing.md, gap: 14 },
  legend: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink500 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  dotPlayed: { backgroundColor: colors.gold400, borderWidth: 2, borderColor: "#fff" },
  dotBucket: { backgroundColor: "#fff", borderWidth: 2, borderStyle: "dashed", borderColor: "#8a6a24" },
  dotGroup: { backgroundColor: colors.navy900, borderWidth: 2, borderColor: colors.gold400 },
  badges: { flexDirection: "row", gap: 8 },
  badge: { flex: 1, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 6, alignItems: "center", gap: 5 },
  badgeOn: { backgroundColor: colors.navy800, borderWidth: 2, borderColor: "#c9a24a" },
  badgeOff: { backgroundColor: "#ece4d2", borderWidth: 2, borderStyle: "dashed", borderColor: "#b9ae98" },
  badgeLabel: { fontFamily: fonts.bodyBold, fontSize: 13, textAlign: "center", color: colors.navy900 },
  badgeDetail: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500 },
  card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: "#e6dcc6", padding: spacing.md, gap: 14 },
  prov: { flexDirection: "row", alignItems: "center", gap: 12 },
  provName: { width: 84, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  bar: { flex: 1, height: 12, borderRadius: 6, backgroundColor: "#ece4d2", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 6, backgroundColor: colors.green700 },
  provCount: { width: 30, textAlign: "right", fontFamily: fonts.bodyBold, fontSize: 17, color: colors.navy900 },
  bucket: { flexDirection: "row", alignItems: "center", gap: 14, padding: spacing.md, borderRadius: 22, backgroundColor: "#5c1f2b", borderWidth: 2, borderColor: "#c9a24a" },
  ring: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: "#e2b85c", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  bucketEyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, color: colors.gold400 },
  bucketTitle: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.cream50, marginTop: 4 },
  bucketSub: { fontFamily: fonts.body, fontSize: 14.5, color: "#ecd3d6", marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: "#e6dcc6", padding: spacing.md },
  linkTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.navy900 },
  linkSub: { fontFamily: fonts.body, fontSize: 15, color: colors.ink500, marginTop: 2 },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 2, color: colors.navy900, marginTop: 4 },
  stamps: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingHorizontal: 4 },
  stamp: { width: "29%", flexGrow: 1, aspectRatio: 1, borderRadius: 999, borderWidth: 2.5, borderStyle: "dashed", backgroundColor: "#fbf3df", alignItems: "center", justifyContent: "center", padding: 8, gap: 4 },
  stampName: { fontFamily: fonts.bodyBold, fontSize: 13.5, textAlign: "center", color: colors.navy900 },
  stampDate: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1 },
});
