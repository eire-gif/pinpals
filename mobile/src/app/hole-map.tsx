import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";

import { HoleMapView, type HoleMapHandle, type MapScene } from "@/components/hole-map-view";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import {
  fixIsUsable,
  greenDistancesM,
  hazardsAheadM,
  holeFrame,
  holeGeometry,
  holeLengthM,
  inUnit,
  measuringFrom,
  shotLegs,
  tapDistancesM,
  unitShort,
  type LatLng,
  type PointKind,
  type Shot,
  type Unit,
} from "@/lib/hole-geo";
import { addShot, loadCourseLayouts, loadRoundShots, shotKey, undoShot, type CourseLayout } from "@/lib/hole-maps";
import { loadLiveRound, subscribeToLiveRound, type LiveRoundData } from "@/lib/live-rounds";
import { loadCourse, type CourseDetail } from "@/lib/onboarding";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A hole on satellite imagery, with GPS yardages (claude/hole-maps.md).
 *
 * Opened two ways:
 *   - from a live round (roundId): measures from the member, and marks where
 *     each shot was played from, for whichever player is selected;
 *   - from a course page (no roundId): look round a course before playing
 *     it — distances from the tee, or from the member if they're on it.
 *
 * Works on a hole with no geometry yet (most courses until imported): the
 * map opens on the club, and a tap still measures from the member. Every
 * number on screen comes from hole-geo.ts.
 */
type Fix = LatLng & { accuracyM: number | null };

// Irish, Spanish and Portuguese courses are measured in metres; British in yards.
const unitFor = (country: string | null | undefined): Unit =>
  country === "england" || country === "scotland" || country === "wales" || country === "northern-ireland" ? "yards" : "metres";

const HAZARD_NAMES: Partial<Record<PointKind, string>> = {
  green_bunker: "Greenside bunker",
  fairway_bunker: "Fairway bunker",
  water: "Water",
  trees: "Trees",
  other: "Hazard",
};

let rememberedUnit: Unit | null = null;

export default function HoleMapScreen() {
  const params = useLocalSearchParams<{ clubId: string; hole?: string; roundId?: string; layoutId?: string }>();
  const clubId = Number(params.clubId);
  const roundId = params.roundId ? Number(params.roundId) : null;
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const mapRef = useRef<HoleMapHandle>(null);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [layouts, setLayouts] = useState<CourseLayout[] | undefined>(undefined);
  const [layoutId, setLayoutId] = useState<number | null>(params.layoutId ? Number(params.layoutId) : null);
  const [round, setRound] = useState<LiveRoundData | null>(null);
  const [shots, setShots] = useState<Map<number, Shot[]>>(new Map());
  const [failed, setFailed] = useState(false);
  const [hole, setHole] = useState(Math.min(18, Math.max(1, Number(params.hole) || 1)));
  const [unit, setUnit] = useState<Unit>(rememberedUnit ?? "metres");
  const [tap, setTap] = useState<LatLng | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- Location: watched while the screen is open, only once allowed ----
  const [fix, setFix] = useState<Fix | null>(null);
  const [locState, setLocState] = useState<"off" | "asking" | "on" | "denied">("off");
  const watch = useRef<Location.LocationSubscription | null>(null);
  // Once the member has said yes on this screen, keep watching when they
  // come back to it from another screen.
  const wanted = useRef(roundId != null);

  const startLocation = useCallback(async () => {
    wanted.current = true;
    if (watch.current) return;
    setLocState("asking");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocState("denied");
        return;
      }
      setLocState("on");
      watch.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2, timeInterval: 2000 },
        (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null })
      );
    } catch {
      setLocState("denied");
    }
  }, []);

  const stopLocation = useCallback(() => {
    watch.current?.remove();
    watch.current = null;
  }, []);

  // A round is the moment of use: ask straight away. Browsing a course from
  // the sofa isn't — the member taps "Distances from me" if they want it.
  useFocusEffect(
    useCallback(() => {
      if (wanted.current) void startLocation();
      return stopLocation;
    }, [startLocation, stopLocation])
  );

  // ---- Data ----
  const load = useCallback(async () => {
    try {
      setFailed(false);
      const [c, l, r, s] = await Promise.all([
        loadCourse(clubId),
        loadCourseLayouts(clubId),
        roundId != null ? loadLiveRound(roundId) : Promise.resolve(null),
        roundId != null ? loadRoundShots(roundId) : Promise.resolve(new Map<number, Shot[]>()),
      ]);
      setCourse(c);
      setLayouts(l);
      setRound(r);
      setShots(s);
      if (rememberedUnit == null) setUnit(unitFor(c?.country));
      setLayoutId((cur) => cur ?? l[0]?.id ?? null);
      if (r) setPlayerId((cur) => cur ?? r.players.find((p) => p.memberId === me)?.id ?? r.players[0]?.id ?? null);
    } catch {
      setFailed(true);
    }
  }, [clubId, roundId, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useEffect(
    () => (roundId != null ? subscribeToLiveRound(roundId, () => void loadRoundShots(roundId).then(setShots).catch(() => {})) : undefined),
    [roundId]
  );
  useEffect(() => setTap(null), [hole]);

  // ---- What's on this hole ----
  const layout = layouts?.find((l) => l.id === layoutId) ?? layouts?.[0] ?? null;
  const holeCount = round?.card.length ?? layout?.holes ?? 18;
  const geo = useMemo(() => holeGeometry(layout?.points ?? [], hole), [layout, hole]);
  const origin = measuringFrom(geo, fix);
  const card = round?.card.find((c) => c.hole === hole) ?? null;
  const myShots = playerId != null ? (shots.get(shotKey(playerId, hole)) ?? []) : [];
  const legs = useMemo(() => shotLegs(myShots, geo.mapped ? geo : null), [myShots, geo]);
  const u = unitShort(unit);
  const fmt = (m: number | null) => (m == null ? "–" : String(inUnit(m, unit)));

  const greens = origin ? greenDistancesM(geo, origin.point) : null;
  const ahead = origin && geo.mapped ? hazardsAheadM(geo, origin.point).slice(0, 4) : [];
  const tapped = tap && origin ? tapDistancesM(geo, origin.point, tap) : null;
  const length = holeLengthM(geo);

  const scene: MapScene = useMemo(() => {
    const frame = holeFrame(geo, fix);
    return {
      fallbackCentre: fix ?? (course?.latitude != null && course.longitude != null ? { lat: course.latitude, lng: course.longitude } : null),
      rotation: frame.rotation,
      frame: frame.points,
      tee: geo.tee,
      teeFront: geo.teeBack && geo.teeFront ? geo.teeFront : null,
      green: { front: geo.greenFront, centre: geo.greenCentre, back: geo.greenBack },
      hazards: geo.hazards.map((h) => ({ lat: h.lat, lng: h.lng, kind: h.kind, label: h.label ?? HAZARD_NAMES[h.kind] ?? "" })),
      me: fix,
      shots: legs.map((l) => ({ lat: l.from.lat, lng: l.from.lng, n: l.shotNo, label: l.distance == null ? null : `${fmt(l.distance)} ${u}` })),
      tap:
        tap && origin && tapped
          ? {
              ...tap,
              origin: origin.point,
              toLabel: `${fmt(tapped.toTap)} ${u}`,
              onLabel: tapped.tapToGreen == null ? null : `${fmt(tapped.tapToGreen)} ${u}`,
              green: geo.greenCentre,
            }
          : null,
      // The view moves when the hole or course changes, or the first time
      // the member's position arrives — never on every GPS tick.
      frameKey: `${layout?.id ?? "none"}-${hole}-${fix ? "fix" : "nofix"}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, fix, course, legs, tap, origin?.point, unit, layout?.id, hole]);

  // ---- Shots ----
  const player = round?.players.find((p) => p.id === playerId) ?? null;
  const canMark = round?.round.status === "live" && player != null && card != null;
  const markShot = async () => {
    if (!round || !player || !fix) return;
    setBusy(true);
    try {
      await addShot(round.round.id, player.id, hole, fix);
      setShots(await loadRoundShots(round.round.id));
    } catch (e) {
      const msg = (e as { message?: unknown } | null)?.message;
      Alert.alert("That shot didn't save", typeof msg === "string" && msg ? msg : "Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!round || !player) return;
    setBusy(true);
    try {
      await undoShot(round.round.id, player.id, hole);
      setShots(await loadRoundShots(round.round.id));
    } catch (e) {
      const msg = (e as { message?: unknown } | null)?.message;
      Alert.alert("Couldn't undo", typeof msg === "string" && msg ? msg : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const switchUnit = () => {
    const next = unit === "yards" ? "metres" : "yards";
    rememberedUnit = next;
    setUnit(next);
  };

  // ---- Render ----
  const title = `Hole ${hole}`;
  if (!isOn("shotMaps")) return <StateMessage size="screen" icon="map-outline" title="Hole maps are on their way" />;
  if (!Number.isFinite(clubId)) return <StateMessage size="screen" icon="map-outline" title="No course chosen" />;
  if (failed) return <LoadError size="screen" what="this hole" onRetry={() => void load()} />;
  if (layouts === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;

  const fixLine =
    origin?.from === "you"
      ? `From you${fix?.accuracyM != null ? ` · ±${Math.round(fix.accuracyM)} m` : ""}`
      : origin?.from === "tee"
        ? "From the tee"
        : locState === "denied"
          ? "Location is off for PinPals"
          : "Waiting for your position";

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: course?.name ?? title }} />

      <View style={styles.mapWrap}>
        <HoleMapView ref={mapRef} scene={scene} onTap={setTap} />

        {/* Hole switcher, over the map. */}
        <View style={styles.topBar} pointerEvents="box-none">
          <MapButton icon="chevron-back" label="Previous hole" disabled={hole <= 1} onPress={() => setHole(hole - 1)} />
          <View style={styles.holeBadge}>
            <Text style={styles.holeBadgeTop}>Hole</Text>
            <Text style={styles.holeBadgeNumber}>{hole}</Text>
            <Text style={styles.holeBadgeMeta}>
              {card ? `Par ${card.par}${card.strokeIndex != null ? ` · SI ${card.strokeIndex}` : ""}` : length != null ? `${fmt(length)} ${u}` : " "}
            </Text>
          </View>
          <MapButton icon="chevron-forward" label="Next hole" disabled={hole >= holeCount} onPress={() => setHole(hole + 1)} />
        </View>

        <View style={styles.sideButtons} pointerEvents="box-none">
          <MapButton icon="scan-outline" label="Show the whole hole" onPress={() => mapRef.current?.recentre()} />
          <Pressable onPress={switchUnit} style={styles.unitButton} accessibilityRole="button" accessibilityLabel={`Showing ${unit}. Switch.`}>
            <Text style={styles.unitText}>{u}</Text>
          </Pressable>
        </View>

        {!geo.mapped ? (
          <View style={styles.notMapped} pointerEvents="none">
            <Text style={styles.notMappedText}>
              {layout ? "This hole isn't mapped yet." : "This course isn't mapped yet."} Tap anywhere to measure from where you are.
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={[styles.panelContent, { paddingBottom: insets.bottom + spacing.md }]}>
        {layouts.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {layouts.map((l) => (
              <Chip key={l.id} label={l.name} on={l.id === layout?.id} onPress={() => setLayoutId(l.id)} />
            ))}
          </ScrollView>
        ) : null}

        {/* The three numbers that matter. */}
        <View style={styles.greenRow}>
          <Yardage label="Front" value={geo.mapped && greens ? fmt(greens.front) : "–"} />
          <Yardage label="Centre" value={geo.mapped && greens ? fmt(greens.centre) : "–"} big />
          <Yardage label="Back" value={geo.mapped && greens ? fmt(greens.back) : "–"} />
        </View>
        <View style={styles.fixRow}>
          <Ionicons name={origin?.from === "you" ? "navigate" : "golf-outline"} size={14} color={colors.cream100} />
          <Text style={styles.fixText}>
            {fixLine} · {u}
          </Text>
          {locState === "off" ? (
            <Pressable onPress={() => void startLocation()} hitSlop={8} accessibilityRole="button">
              <Text style={styles.fixLink}>Distances from me</Text>
            </Pressable>
          ) : null}
        </View>

        {tapped ? (
          <View style={styles.tapRow}>
            <Text style={styles.tapText}>
              To there <Text style={styles.strong}>{fmt(tapped.toTap)}</Text>
              {tapped.tapToGreen != null ? (
                <>
                  {"  ·  "}then to the green <Text style={styles.strong}>{fmt(tapped.tapToGreen)}</Text>
                </>
              ) : null}{" "}
              {u}
            </Text>
            <Pressable onPress={() => setTap(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear the measurement">
              <Ionicons name="close-circle" size={20} color={colors.cream100} />
            </Pressable>
          </View>
        ) : null}

        {ahead.length > 0 ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Ahead of you</Text>
            {ahead.map((h, i) => (
              <View key={i} style={styles.hazardRow}>
                <View style={[styles.hazardDot, { backgroundColor: hazardColour(h.kind) }]} />
                <Text style={styles.hazardName}>{h.label ?? HAZARD_NAMES[h.kind] ?? "Hazard"}</Text>
                <Text style={styles.hazardDist}>
                  {fmt(h.distance)} {u}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {round ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Shots on this hole</Text>
            {round.players.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {round.players.map((p) => (
                  <Chip key={p.id} label={p.memberId === me ? "You" : p.name.split(" ")[0]} on={p.id === playerId} onPress={() => setPlayerId(p.id)} />
                ))}
              </ScrollView>
            ) : null}
            {legs.length === 0 ? (
              <Text style={styles.muted}>Stand where the ball is and tap "Mark shot" before each one.</Text>
            ) : (
              legs.map((l) => (
                <View key={l.shotNo} style={styles.shotRow}>
                  <View style={styles.shotNo}>
                    <Text style={styles.shotNoText}>{l.shotNo}</Text>
                  </View>
                  <Text style={styles.shotText}>
                    {l.distance != null ? `${fmt(l.distance)} ${u}` : "Last marked"}
                    {l.remaining != null ? <Text style={styles.muted}>{`  ·  ${fmt(l.remaining)} ${u} left from here`}</Text> : null}
                  </Text>
                </View>
              ))
            )}
            {canMark ? (
              <View style={styles.shotButtons}>
                <Pressable
                  onPress={() => void markShot()}
                  disabled={busy || !fix || !fixIsUsable(fix.accuracyM)}
                  style={({ pressed }) => [styles.markButton, (busy || !fix || !fixIsUsable(fix.accuracyM)) && styles.disabled, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  {busy ? (
                    <ActivityIndicator color={colors.navy900} />
                  ) : (
                    <>
                      <Ionicons name="locate" size={18} color={colors.navy900} />
                      <Text style={styles.markLabel}>
                        {!fix ? "Waiting for GPS" : !fixIsUsable(fix.accuracyM) ? "Weak GPS, hold on" : `Mark shot ${legs.length + 1}`}
                      </Text>
                    </>
                  )}
                </Pressable>
                {legs.length > 0 ? (
                  <Pressable onPress={() => void undo()} disabled={busy} style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Undo the last shot">
                    <Ionicons name="arrow-undo" size={18} color={colors.cream50} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {!layout ? (
          <Text style={styles.footnote}>Hole maps are being added course by course. Until this one is, you can still measure to anything you tap on the map.</Text>
        ) : (
          <Text style={styles.footnote}>Distances are GPS estimates. Check the course's own markers before an important shot.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function hazardColour(kind: PointKind): string {
  if (kind === "water") return "#4aa3df";
  if (kind === "trees") return "#2f6b3a";
  if (kind === "green_bunker" || kind === "fairway_bunker") return "#e9d9a6";
  return "#c9c3b6";
}

function Yardage({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.yardage} accessible accessibilityLabel={`${label} of the green, ${value}`}>
      <Text style={styles.yardageLabel}>{label}</Text>
      <Text style={[styles.yardageValue, big && styles.yardageBig]}>{value}</Text>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function MapButton({ icon, label, onPress, disabled = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.mapButton, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Ionicons name={icon} size={20} color={colors.cream50} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy900 },
  mapWrap: { flex: 1.35 },
  topBar: { position: "absolute", top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  holeBadge: { alignItems: "center", backgroundColor: "rgba(12,32,56,0.82)", borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 6, minWidth: 110 },
  holeBadgeTop: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  holeBadgeNumber: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: colors.cream50 },
  holeBadgeMeta: { fontFamily: fonts.body, fontSize: 12.5, color: creamAlpha(0.85) },
  mapButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(12,32,56,0.82)", alignItems: "center", justifyContent: "center" },
  sideButtons: { position: "absolute", right: spacing.sm, bottom: spacing.lg, gap: spacing.sm, alignItems: "center" },
  unitButton: { width: 44, height: 32, borderRadius: radii.pill, backgroundColor: "rgba(12,32,56,0.82)", alignItems: "center", justifyContent: "center" },
  unitText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.cream50 },
  notMapped: { position: "absolute", left: spacing.md, right: 64, bottom: spacing.lg, backgroundColor: "rgba(12,32,56,0.82)", borderRadius: radii.md, padding: spacing.sm + 2 },
  notMappedText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.cream50 },

  panel: { flex: 1, backgroundColor: colors.navy900 },
  panelContent: { padding: spacing.md, gap: spacing.sm + 2 },
  chips: { gap: spacing.sm, paddingBottom: 2 },
  chip: { paddingHorizontal: 14, minHeight: 34, borderRadius: radii.pill, borderWidth: 1, borderColor: creamAlpha(0.3), justifyContent: "center" },
  chipOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.cream50 },
  chipTextOn: { color: colors.navy900 },

  greenRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around" },
  yardage: { alignItems: "center", minWidth: 80 },
  yardageLabel: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: creamAlpha(0.7) },
  yardageValue: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50 },
  yardageBig: { fontSize: 52, lineHeight: 58, color: colors.gold400 },
  fixRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  fixText: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
  fixLink: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400, marginLeft: spacing.sm },

  tapRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: creamAlpha(0.08), borderRadius: radii.md, padding: spacing.sm + 2 },
  tapText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.cream50 },
  strong: { fontFamily: fonts.bodyBold },

  block: { backgroundColor: creamAlpha(0.06), borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  blockTitle: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  hazardRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hazardDot: { width: 10, height: 10, borderRadius: 5 },
  hazardName: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.cream50 },
  hazardDist: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },

  shotRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  shotNo: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.cream50, alignItems: "center", justifyContent: "center" },
  shotNoText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.navy900 },
  shotText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.cream50 },
  shotButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  markButton: { flex: 1, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.gold400, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  markLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  undoButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: creamAlpha(0.35), alignItems: "center", justifyContent: "center" },

  muted: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.7) },
  footnote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: creamAlpha(0.6), textAlign: "center", marginTop: spacing.xs },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
