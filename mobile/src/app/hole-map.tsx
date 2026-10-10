import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";

import { HoleMapView, type HoleMapHandle, type MapScene } from "@/components/hole-map-view";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import {
  defaultAim,
  distanceM,
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
  withTee,
  unitShort,
  type LatLng,
  type PointKind,
  type Shot,
  type Unit,
} from "@/lib/hole-geo";
import { addShot, loadCourseLayouts, loadRoundShots, shotKey, undoShot, type CourseLayout } from "@/lib/hole-maps";
import { osmLayoutPoints, outlinesNear, type OsmFeature } from "@/lib/osm-course";
import { loadCourseShapes } from "@/lib/osm-fetch";
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
 *
 * LAYOUT (Oct 2026, after Hole19): the photo is the whole screen. Floating
 * over it, a back button and the course at the top, and one sheet at the
 * bottom — the hole, par and SI, and front / centre / back — that you swipe
 * sideways for the next hole. On the photo, an aim circle a drive out with
 * the distance to it and from it to the green; drag it, or tap anywhere to
 * move it. Shots, hazards and the course's other loops are one tap away in
 * a pull-up list, not stacked under the map.
 */
type Fix = LatLng & { accuracyM: number | null };

// Yards everywhere by default: it's what golfers here think in, even where
// the club's own card is in metres. Metres are one tap away on the map.
const unitFor = (_country: string | null | undefined): Unit => "yards";

const HAZARD_NAMES: Partial<Record<PointKind, string>> = {
  green_bunker: "Greenside bunker",
  fairway_bunker: "Fairway bunker",
  water: "Water",
  trees: "Trees",
  other: "Hazard",
};

let rememberedUnit: Unit | null = null;
let rememberedOutlines = true;

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
  // OpenStreetMap shapes for the course: drawn on the map, and the hole
  // geometry wherever golfapi.io has none. Null until loaded; [] if none.
  const [shapes, setShapes] = useState<OsmFeature[] | null>(null);
  const [layoutId, setLayoutId] = useState<number | null>(params.layoutId ? Number(params.layoutId) : null);
  const [round, setRound] = useState<LiveRoundData | null>(null);
  const [shots, setShots] = useState<Map<number, Shot[]>>(new Map());
  const [failed, setFailed] = useState(false);
  const [hole, setHole] = useState(Math.min(18, Math.max(1, Number(params.hole) || 1)));
  const [unit, setUnit] = useState<Unit>(rememberedUnit ?? "yards");
  const [tap, setTap] = useState<LatLng | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOutlines, setShowOutlines] = useState(rememberedOutlines);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Tees the member dragged the T to, per loop and hole, while the screen is open.
  const [movedTees, setMovedTees] = useState<Map<string, LatLng>>(new Map());
  // The bottom sheet's height, so the hole is fitted above it, not under it.
  const [sheetH, setSheetH] = useState(220);

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
  useEffect(() => {
    if (course?.latitude == null || course.longitude == null || shapes !== null) return;
    void loadCourseShapes(clubId, { lat: course.latitude, lng: course.longitude }).then(setShapes);
  }, [clubId, course?.latitude, course?.longitude, shapes]);

  useEffect(
    () => (roundId != null ? subscribeToLiveRound(roundId, () => void loadRoundShots(roundId).then(setShots).catch(() => {})) : undefined),
    [roundId]
  );
  useEffect(() => setTap(null), [hole, layoutId]);

  // ---- What's on this hole ----
  const layout = layouts?.find((l) => l.id === layoutId) ?? layouts?.[0] ?? null;
  const holeCount = round?.card.length ?? layout?.holes ?? 18;
  const clubAt = course?.latitude != null && course.longitude != null ? { lat: course.latitude, lng: course.longitude } : null;
  const osmPoints = useMemo(() => (shapes && shapes.length ? osmLayoutPoints(shapes, clubAt) : []), [shapes, clubAt?.lat, clubAt?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  // golfapi.io's points when the hole has them; OpenStreetMap's otherwise.
  const mappedGeo = useMemo(() => {
    const fromLayout = holeGeometry(layout?.points ?? [], hole);
    return fromLayout.mapped ? fromLayout : holeGeometry(osmPoints, hole);
  }, [layout, hole, osmPoints]);
  const teeKey = `${layout?.id ?? "osm"}-${hole}`;
  const movedTee = movedTees.get(teeKey) ?? null;
  // Everything is measured from the tee the member put the T on, if they moved it.
  const geo = useMemo(() => withTee(mappedGeo, mappedGeo.mapped ? movedTee : null), [mappedGeo, movedTee]);
  const moveTee = (at: LatLng) => setMovedTees((m) => new Map(m).set(teeKey, at));
  const fromOsm = !holeGeometry(layout?.points ?? [], hole).mapped && geo.mapped;
  const origin = measuringFrom(geo, fix);
  const card = round?.card.find((c) => c.hole === hole) ?? null;
  const myShots = playerId != null ? (shots.get(shotKey(playerId, hole)) ?? []) : [];
  const legs = useMemo(() => shotLegs(myShots, geo.mapped ? geo : null), [myShots, geo]);
  const u = unitShort(unit);
  const fmt = (m: number | null) => (m == null ? "–" : String(inUnit(m, unit)));

  // Front / centre / back: from you or the tee — or, once the member has put
  // the aim circle somewhere, from there (the second shot, planned).
  const fromAim = tap != null && geo.mapped;
  const greens = fromAim ? greenDistancesM(geo, tap) : origin ? greenDistancesM(geo, origin.point) : null;
  const toGreenFromOrigin = origin ? greenDistancesM(geo, origin.point) : null;
  const allAhead = origin && geo.mapped ? hazardsAheadM(geo, origin.point) : [];
  const ahead = allAhead.slice(0, 4);
  // The aim circle: where the member put it, else a drive out (Hole19-style).
  const aim = tap ?? (origin && geo.mapped ? defaultAim(geo, origin.point) : null);
  const tapped = aim && origin ? tapDistancesM(geo, origin.point, aim) : null;
  const length = holeLengthM(geo);

  const scene: MapScene = useMemo(() => {
    // Framed on the mapped hole, so dragging the T doesn't move the view.
    const frame = holeFrame(mappedGeo, fix);
    return {
      fallbackCentre: fix ?? (course?.latitude != null && course.longitude != null ? { lat: course.latitude, lng: course.longitude } : null),
      rotation: frame.rotation,
      frame: frame.points,
      tee: geo.tee,
      teeFront: geo.teeBack && geo.teeFront ? geo.teeFront : null,
      green: { front: geo.greenFront, centre: geo.greenCentre, back: geo.greenBack },
      hazards: geo.hazards.map((h) => {
        // Distance beside each hazard still ahead of you (or the tee).
        const isAhead = allAhead.some((a) => a.lat === h.lat && a.lng === h.lng);
        return {
          lat: h.lat,
          lng: h.lng,
          kind: h.kind,
          label: h.label ?? HAZARD_NAMES[h.kind] ?? "",
          dist: isAhead && origin ? fmt(distanceM(origin.point, h)) : null,
        };
      }),
      teeMovable: geo.mapped && geo.tee != null,
      originIsTee: origin?.from === "tee",
      me: fix,
      shots: legs.map((l) => ({ lat: l.from.lat, lng: l.from.lng, n: l.shotNo, label: l.distance == null ? null : `${fmt(l.distance)} ${u}` })),
      tap:
        aim && origin && tapped
          ? {
              ...aim,
              origin: origin.point,
              toLabel: `${fmt(tapped.toTap)} ${u}`,
              onLabel: tapped.tapToGreen == null ? null : `${fmt(tapped.tapToGreen)} ${u}`,
              green: geo.greenCentre,
            }
          : null,
      greenLine:
        !aim && origin && geo.greenCentre && toGreenFromOrigin?.centre != null ? { origin: origin.point, label: `${fmt(toGreenFromOrigin.centre)} ${u}` } : null,
      hole,
      showOutlines,
      inset: { top: insets.top + 80, bottom: sheetH + 30 },
      // The view moves when the hole or course changes, or the first time
      // the member's position arrives — never on every GPS tick.
      outlines: shapes ? outlinesNear(shapes, frame.points.length ? frame.points : clubAt ? [clubAt] : []) : [],
      frameKey: `${layout?.id ?? "none"}-${hole}-${fix ? "fix" : "nofix"}-${geo.mapped ? "m" : "u"}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, mappedGeo, fix, course, legs, aim?.lat, aim?.lng, origin?.point, unit, layout?.id, hole, shapes, showOutlines, sheetH, insets.top]);

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

  const toggleOutlines = () => {
    rememberedOutlines = !showOutlines;
    setShowOutlines(!showOutlines);
  };

  // Swipe the bottom sheet sideways for the next or previous hole.
  const holeRef = useRef({ hole, holeCount });
  holeRef.current = { hole, holeCount };
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_e, g) => {
          const { hole: h, holeCount: n } = holeRef.current;
          if (g.dx < -60 && h < n) setHole(h + 1);
          else if (g.dx > 60 && h > 1) setHole(h - 1);
        },
      }),
    []
  );

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

  const fixLine = fromAim
    ? "From the aim circle"
    : origin?.from === "you"
      ? `From you${fix?.accuracyM != null ? ` · ±${Math.round(fix.accuracyM)} m` : ""}`
      : origin?.from === "tee"
        ? movedTee
          ? "From your tee"
          : "From the tee"
        : locState === "denied"
          ? "Location is off for PinPals"
          : "Waiting for your position";
  const holeMeta = [
    card ? `Par ${card.par}` : null,
    card?.strokeIndex != null ? `SI ${card.strokeIndex}` : null,
    length != null ? `${fmt(length)} ${u}` : null,
  ].filter(Boolean);
  const hasDetails = layouts.length > 1 || ahead.length > 0 || round != null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: course?.name ?? title, headerShown: false }} />
      <StatusBar style="light" />

      <View style={StyleSheet.absoluteFill}>
        <HoleMapView ref={mapRef} scene={scene} onTap={setTap} onTee={moveTee} />
      </View>

      {/* Over the map, top: back, the course, and the map's own buttons. */}
      <View style={[styles.topBar, { top: insets.top + 6 }]} pointerEvents="box-none">
        <MapButton icon="chevron-back" label="Back" onPress={() => router.back()} />
        <View style={styles.titlePill} pointerEvents="none">
          <Text style={styles.titleText} numberOfLines={1}>
            {course?.name ?? "Hole map"}
          </Text>
        </View>
        <Pressable onPress={switchUnit} style={styles.unitButton} accessibilityRole="button" accessibilityLabel={`Showing ${unit}. Switch.`}>
          <Text style={styles.unitText}>{u}</Text>
        </Pressable>
      </View>
      <View style={[styles.sideButtons, { top: insets.top + 62 }]} pointerEvents="box-none">
        <MapButton icon="scan-outline" label="Show the whole hole" onPress={() => mapRef.current?.recentre()} />
        {shapes && shapes.length > 0 ? (
          <MapButton icon={showOutlines ? "layers" : "layers-outline"} label={showOutlines ? "Hide course outlines" : "Show course outlines"} onPress={toggleOutlines} />
        ) : null}
        {tap || movedTee ? (
          <MapButton
            icon="refresh"
            label="Put the tee and aim back"
            onPress={() => {
              setTap(null);
              setMovedTees((m) => {
                const next = new Map(m);
                next.delete(teeKey);
                return next;
              });
            }}
          />
        ) : null}
      </View>

      {/* Over the map, bottom: the hole and the three numbers. Swipe for the next hole. */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 10 }]} onLayout={(e) => setSheetH(e.nativeEvent.layout.height)} {...swipe.panHandlers}>
        {!geo.mapped ? (
          <Text style={styles.notMappedText}>
            {shapes === null ? "Loading the course… " : layout || osmPoints.length ? "This hole isn't mapped yet. " : "This course isn't mapped yet. "}
            Tap anywhere to measure from where you are.
          </Text>
        ) : null}
        <View style={styles.holeRow}>
          <MapButton icon="chevron-back" label="Previous hole" disabled={hole <= 1} onPress={() => setHole(hole - 1)} flat />
          <View style={styles.holeMid} accessible accessibilityLabel={`Hole ${hole}. ${holeMeta.join(", ")}`}>
            <Text style={styles.holeNumber}>
              <Text style={styles.holeWord}>HOLE </Text>
              {hole}
            </Text>
            {holeMeta.length ? <Text style={styles.holeMeta}>{holeMeta.join(" · ")}</Text> : null}
          </View>
          <MapButton icon="chevron-forward" label="Next hole" disabled={hole >= holeCount} onPress={() => setHole(hole + 1)} flat />
        </View>

        <View style={styles.greenRow}>
          <Yardage label="Front" value={geo.mapped && greens ? fmt(greens.front) : "–"} />
          <Yardage label="Centre" value={geo.mapped && greens ? fmt(greens.centre) : "–"} big />
          <Yardage label="Back" value={geo.mapped && greens ? fmt(greens.back) : "–"} />
        </View>
        <View style={styles.fixRow}>
          <Ionicons name={fromAim ? "radio-button-off" : origin?.from === "you" ? "navigate" : "golf-outline"} size={13} color={creamAlpha(0.75)} />
          <Text style={styles.fixText}>{fixLine}</Text>
          {fromAim ? (
            <Pressable onPress={() => setTap(null)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.fixLink}>Reset</Text>
            </Pressable>
          ) : locState === "off" ? (
            <Pressable onPress={() => void startLocation()} hitSlop={8} accessibilityRole="button">
              <Text style={styles.fixLink}>Distances from me</Text>
            </Pressable>
          ) : null}
        </View>

        {canMark || hasDetails ? (
          <View style={styles.actionRow}>
            {canMark ? (
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
            ) : null}
            {canMark && legs.length > 0 ? (
              <Pressable onPress={() => void undo()} disabled={busy} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Undo the last shot">
                <Ionicons name="arrow-undo" size={18} color={colors.cream50} />
              </Pressable>
            ) : null}
            {hasDetails ? (
              <Pressable
                onPress={() => setDetailsOpen(true)}
                style={({ pressed }) => [canMark ? styles.roundButton : styles.detailsButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Shots, hazards and more"
              >
                <Ionicons name="list" size={18} color={colors.cream50} />
                {!canMark ? <Text style={styles.detailsLabel}>{round ? "Shots and hazards" : "Hazards and more"}</Text> : null}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDetailsOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.details, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <ScrollView contentContainerStyle={styles.detailsContent}>
            {layouts.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {layouts.map((l) => (
                  <Chip key={l.id} label={l.name} on={l.id === layout?.id} onPress={() => setLayoutId(l.id)} />
                ))}
              </ScrollView>
            ) : null}

            {round ? (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>Shots on hole {hole}</Text>
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

            <Text style={styles.footnote}>
              {fromOsm
                ? "This hole's map comes from OpenStreetMap volunteers. Distances are GPS estimates — check the course's markers before an important shot."
                : !layout && !geo.mapped
                  ? "Hole maps are being added course by course. Until this one is, you can still measure to anything you tap on the map."
                  : "Distances are GPS estimates. Check the course's own markers before an important shot."}
            </Text>
          </ScrollView>
        </View>
      </Modal>
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

function MapButton({
  icon,
  label,
  onPress,
  disabled = false,
  flat = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** On the sheet rather than the photo: no disc behind it. */
  flat?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.mapButton, flat && styles.flatButton, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Ionicons name={icon} size={20} color={colors.cream50} />
    </Pressable>
  );
}

const SHEET = "rgba(12,32,56,0.93)";
const ON_PHOTO = "rgba(12,32,56,0.78)";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.green800 },
  topBar: { position: "absolute", left: spacing.sm + 2, right: spacing.sm + 2, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  titlePill: { flex: 1, minHeight: 36, borderRadius: radii.pill, backgroundColor: ON_PHOTO, justifyContent: "center", paddingHorizontal: 14 },
  titleText: { fontFamily: fonts.display, fontSize: 15.5, color: colors.cream50, textAlign: "center" },
  mapButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: ON_PHOTO, alignItems: "center", justifyContent: "center" },
  flatButton: { backgroundColor: "transparent" },
  sideButtons: { position: "absolute", right: spacing.sm + 2, gap: spacing.sm, alignItems: "center" },
  unitButton: { minWidth: 48, height: 36, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: ON_PHOTO, alignItems: "center", justifyContent: "center" },
  unitText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },

  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SHEET,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: spacing.md,
    gap: 6,
  },
  notMappedText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: creamAlpha(0.85), textAlign: "center", paddingTop: 4 },
  holeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  holeMid: { alignItems: "center", flex: 1 },
  holeWord: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.4, color: colors.gold400 },
  holeNumber: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.cream50 },
  holeMeta: { fontFamily: fonts.bodySemi, fontSize: 13, color: creamAlpha(0.8) },

  greenRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around" },
  yardage: { alignItems: "center", minWidth: 80 },
  yardageLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: creamAlpha(0.65) },
  yardageValue: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.cream50 },
  yardageBig: { fontSize: 50, lineHeight: 56, color: colors.gold400 },
  fixRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  fixText: { fontFamily: fonts.body, fontSize: 12.5, color: creamAlpha(0.75) },
  fixLink: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold400, marginLeft: spacing.sm },

  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  markButton: { flex: 1, minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.gold400, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  markLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900 },
  roundButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: creamAlpha(0.35), alignItems: "center", justifyContent: "center" },
  detailsButton: { flex: 1, minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: creamAlpha(0.3), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  detailsLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.cream50 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  details: { maxHeight: "70%", backgroundColor: colors.navy900, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: creamAlpha(0.3), marginBottom: 6 },
  detailsContent: { padding: spacing.md, gap: spacing.sm + 2 },
  chips: { gap: spacing.sm, paddingBottom: 2 },
  chip: { paddingHorizontal: 14, minHeight: 34, borderRadius: radii.pill, borderWidth: 1, borderColor: creamAlpha(0.3), justifyContent: "center" },
  chipOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.cream50 },
  chipTextOn: { color: colors.navy900 },

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

  muted: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.7) },
  footnote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: creamAlpha(0.6), textAlign: "center", marginTop: spacing.xs },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
