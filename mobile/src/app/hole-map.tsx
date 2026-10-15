import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";

import { HoleMapView, type HoleMapHandle, type MapScene } from "@/components/hole-map-view";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { YardagesSponsor, useCoursePartner } from "@/components/course-partner";
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
  shotEnds,
  tapDistancesM,
  withTee,
  unitShort,
  type LatLng,
  type PointKind,
  type Shot,
  type Unit,
  pinZone,
  withPin,
  greenFromPin,
  bearingDeg,
  distanceArcs,
  METRES_PER_YARD,
  PIN_COLOURS,
} from "@/lib/hole-geo";
import { arrowOnScreen, KMH_PER_MPH, playsLikeM, windLevel, windLine, windOnShot, windSpeed, type Wind } from "@/lib/wind";
import { useKeyboardHeight, FORM_SCROLL_KEYBOARD } from "@/components/keyboard";
import { clubDistanceM, clubInfo, likelyClubs, suggestClub, type BagClub } from "@/lib/bag";
import { loadMyBag, loadShotClubs, loadWind, tagShotClub } from "@/lib/hole-extras";
import { ClubTagRow, PlaysLikeRow, TipsBlock, WindChip, WindCredit, WindStream, clubOrder } from "@/components/hole-map-extras";
import { addShot, loadCourseLayouts, loadRoundShots, saveHoleFix, shotKey, undoShot, type CourseLayout } from "@/lib/hole-maps";
import { isSuperAdmin } from "@/lib/admin";
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
let rememberedWindShow = false;
let rememberedTucked = false;
type ArcsMode = "off" | "50" | "clubs";
let rememberedArcs: ArcsMode = "off";

export default function HoleMapScreen() {
  const params = useLocalSearchParams<{ clubId: string; hole?: string; roundId?: string; layoutId?: string }>();
  const clubId = Number(params.clubId);
  // "Yardages brought to you by …" (0139): in the sheet, under the numbers.
  const partner = useCoursePartner(clubId);
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
  // The "how far did that go" card on the side of the map (Oct 2026).
  const [shotCardOpen, setShotCardOpen] = useState(false);
  const [shotCardHidden, setShotCardHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hole, setHole] = useState(Math.min(18, Math.max(1, Number(params.hole) || 1)));
  useEffect(() => {
    setShotCardOpen(false);
    setShotCardHidden(false);
  }, [hole]);
  const [unit, setUnit] = useState<Unit>(rememberedUnit ?? "yards");
  const [tap, setTap] = useState<LatLng | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOutlines, setShowOutlines] = useState(rememberedOutlines);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Tees the member dragged the T to, per loop and hole, while the screen is open.
  const [movedTees, setMovedTees] = useState<Map<string, LatLng>>(new Map());
  // …and where they put the flag (today's pin position).
  const [movedPins, setMovedPins] = useState<Map<string, LatLng>>(new Map());
  // Super admins can keep a moved flag / T for everyone (0152): golfapi's
  // greens are sometimes on the wrong spot (Portmarnock Links, Oct 2026).
  const [superAdmin, setSuperAdmin] = useState(false);
  // Wind, My bag, distance arcs and club tags (Oct 2026, 0153).
  const [wind, setWind] = useState<Wind | null>(null);
  // Tap the wind to see it blowing across the map (Oct 2026).
  const [windShow, setWindShow] = useState(rememberedWindShow);
  const keyboardH = useKeyboardHeight();
  const detailsScroll = useRef<ScrollView>(null);
  const [bag, setBag] = useState<BagClub[] | null>(null);
  const [arcsMode, setArcsMode] = useState<ArcsMode>(rememberedArcs);
  const [shotClubs, setShotClubs] = useState<Map<string, string>>(new Map());
  const [tagging, setTagging] = useState(false);
  const [savingFix, setSavingFix] = useState(false);
  useEffect(() => {
    let on = true;
    void isSuperAdmin()
      .then((yes) => on && setSuperAdmin(yes))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  // The bottom sheet's height, so the hole is fitted above it, not under it.
  const [sheetH, setSheetH] = useState(220);
  // Drag the sheet down to see more of the map (Oct 2026): it follows the
  // finger and settles either open or tucked down to the hole and the
  // three numbers. peekH: how much stays showing when it's down.
  const [peekH, setPeekH] = useState(150);
  const [tucked, setTucked] = useState(rememberedTucked);
  const sheetY = useRef(new Animated.Value(0)).current;
  const tuckBy = Math.max(0, sheetH - peekH);
  const sheetRef = useRef({ tuckBy, tucked });
  sheetRef.current = { tuckBy, tucked };
  const settle = useCallback(
    (down: boolean) => {
      rememberedTucked = down;
      setTucked(down);
      Animated.spring(sheetY, { toValue: down ? sheetRef.current.tuckBy : 0, useNativeDriver: true, bounciness: 4, speed: 16 }).start();
    },
    [sheetY]
  );
  // Keep it tucked by the right amount when the sheet's size changes.
  useEffect(() => {
    sheetY.setValue(tucked ? tuckBy : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tuckBy]);

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
      // My bag may have changed on its own screen.
      void loadMyBag()
        .then(setBag)
        .catch(() => setBag(null));
    }, [load])
  );
  useEffect(() => {
    if (course?.latitude == null || course.longitude == null) return;
    let on = true;
    void loadWind({ lat: course.latitude, lng: course.longitude })
      .then((w) => on && setWind(w))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [course?.latitude, course?.longitude]);
  useEffect(() => {
    if (roundId == null) return;
    void loadShotClubs(roundId)
      .then(setShotClubs)
      .catch(() => {});
  }, [roundId, shots]);
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
  const movedPin = movedPins.get(teeKey) ?? null;
  // Everything is measured to the flag where the member put it, if they moved it.
  const geo = useMemo(
    () => withPin(withTee(mappedGeo, mappedGeo.mapped ? movedTee : null), mappedGeo.mapped ? movedPin : null),
    [mappedGeo, movedTee, movedPin]
  );
  const moveTee = (at: LatLng) => setMovedTees((m) => new Map(m).set(teeKey, at));
  const movePin = (at: LatLng) => setMovedPins((m) => new Map(m).set(teeKey, at));
  const forgetMoves = () => {
    const drop = (m: Map<string, LatLng>) => {
      const next = new Map(m);
      next.delete(teeKey);
      return next;
    };
    setMovedTees(drop);
    setMovedPins(drop);
  };
  const canSaveFix = superAdmin && layout != null && mappedGeo.mapped && (movedPin != null || movedTee != null);
  const saveFix = () => {
    if (!layout || savingFix) return;
    const what = movedPin && movedTee ? "the green and the tee" : movedPin ? "the green" : "the tee";
    Alert.alert(`Save ${what} for everyone?`, `Hole ${hole} at ${course?.name ?? "this course"} will show ${what} where you've put it, for every member. The old position is kept in the admin log.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: async () => {
          setSavingFix(true);
          try {
            const inLayout = holeGeometry(layout.points, hole).mapped;
            const green = movedPin ? greenFromPin(withTee(mappedGeo, movedTee), movedPin) : null;
            // A hole drawn from OpenStreetMap isn't in the map on file yet:
            // save its tee too, so the hole stands on its own.
            const tee = movedTee ?? (inLayout ? null : mappedGeo.tee);
            await saveHoleFix(layout.id, hole, green ?? (inLayout ? null : greenFromPin(mappedGeo, mappedGeo.greenCentre!)), tee);
            setLayouts(await loadCourseLayouts(clubId));
            forgetMoves();
            Alert.alert("Saved", `Hole ${hole} now shows ${what} where you put it, for everyone.`);
          } catch {
            Alert.alert("Couldn't save", "Nothing was changed. Please try again.");
          } finally {
            setSavingFix(false);
          }
        },
      },
    ]);
  };
  const zone = geo.greenCentre ? pinZone(geo, geo.greenCentre) : "middle";
  const fromOsm = !holeGeometry(layout?.points ?? [], hole).mapped && geo.mapped;
  const origin = measuringFrom(geo, fix);
  const card = round?.card.find((c) => c.hole === hole) ?? null;
  const myShots = playerId != null ? (shots.get(shotKey(playerId, hole)) ?? []) : [];
  // Each mark is where a ball finished; shot 1 starts on the tee (hole-geo).
  const ends = useMemo(() => shotEnds(myShots, geo.mapped ? geo : null), [myShots, geo]);
  const lastEnd = ends.length ? ends[ends.length - 1] : null;
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

  // ---- Wind, plays like, the club, arcs ----
  const mapRotation = useMemo(() => holeFrame(mappedGeo, fix).rotation, [mappedGeo, fix]);
  // The shot being planned: from the aim circle if it's been moved, else from you or the tee.
  const shotFrom = fromAim ? tap : (origin?.point ?? null);
  const windShot = wind && shotFrom && geo.greenCentre ? windOnShot(wind.speedKmh / KMH_PER_MPH, wind.fromDeg, bearingDeg(shotFrom, geo.greenCentre)) : null;
  const level = windShot && wind ? windLevel(wind.speedKmh / KMH_PER_MPH) : null;
  const windFx = windShow && wind && level ? { deg: arrowOnScreen(wind.fromDeg, mapRotation), level } : null;
  // From you, how far you are from the tee — the drive, before it's marked.
  const fromTeeM = origin?.from === "you" && geo.tee ? distanceM(geo.tee, origin.point) : null;
  const centreM = geo.mapped && greens?.centre != null ? greens.centre : null;
  const playsLike = windShot && centreM != null && windShot.along !== "calm" ? playsLikeM(centreM, windShot.head) : null;
  const windDelta = playsLike != null && centreM != null ? inUnit(playsLike, unit) - inUnit(centreM, unit) : null;
  const suggestion = bag && centreM != null ? suggestClub(bag, playsLike ?? centreM) : null;
  const bagWithDistances = (bag ?? []).filter((c) => c.inBag && clubDistanceM(c) != null);
  const arcs = useMemo(() => {
    if (arcsMode === "off" || !origin || !geo.mapped || !geo.greenCentre) return [];
    if (arcsMode === "clubs") {
      return bagWithDistances.flatMap((c) =>
        distanceArcs(origin.point, geo.greenCentre!, [clubDistanceM(c)!]).map((a) => ({ points: a.points, end: a.end, label: clubInfo(c.club).short }))
      );
    }
    const step = unit === "yards" ? METRES_PER_YARD : 1;
    return distanceArcs(origin.point, geo.greenCentre, [100, 150, 200, 250, 300].map((v) => v * step)).map((a) => ({
      points: a.points,
      end: a.end,
      label: String(inUnit(a.radiusM, unit)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcsMode, origin?.point?.lat, origin?.point?.lng, geo, unit, bag]);
  const cycleArcs = () => {
    const next: ArcsMode = arcsMode === "off" ? "50" : arcsMode === "50" && bagWithDistances.length > 0 ? "clubs" : "off";
    rememberedArcs = next;
    setArcsMode(next);
  };

  const scene: MapScene = useMemo(() => {
    // Framed on the mapped hole, so dragging the T doesn't move the view.
    const frame = holeFrame(mappedGeo, fix);
    return {
      fallbackCentre: fix ?? (course?.latitude != null && course.longitude != null ? { lat: course.latitude, lng: course.longitude } : null),
      rotation: frame.rotation,
      frame: frame.points,
      tee: geo.tee,
      teeFront: geo.teeBack && geo.teeFront ? geo.teeFront : null,
      green: { front: geo.greenFront, centre: geo.greenCentre, back: geo.greenBack, zone },
      pinMovable: geo.mapped,
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
      shots: ends.map((e) => ({ lat: e.at.lat, lng: e.at.lng, n: e.n, label: e.distance == null ? null : `${fmt(e.distance)} ${u}` })),
      shotStart: ends[0]?.from ?? null,
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
      arcs,
      greenLine:
        !aim && origin && geo.greenCentre && toGreenFromOrigin?.centre != null ? { origin: origin.point, label: `${fmt(toGreenFromOrigin.centre)} ${u}` } : null,
      hole,
      showOutlines,
      inset: { top: insets.top + 80, bottom: (tucked ? peekH : sheetH) + 30 },
      // The view moves when the hole or course changes, or the first time
      // the member's position arrives — never on every GPS tick.
      outlines: shapes ? outlinesNear(shapes, frame.points.length ? frame.points : clubAt ? [clubAt] : []) : [],
      frameKey: `${layout?.id ?? "none"}-${hole}-${fix ? "fix" : "nofix"}-${geo.mapped ? "m" : "u"}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, mappedGeo, zone, fix, course, ends, aim?.lat, aim?.lng, origin?.point, unit, layout?.id, hole, shapes, showOutlines, sheetH, insets.top, arcs, tucked, peekH]);

  // ---- Shots ----
  const player = round?.players.find((p) => p.id === playerId) ?? null;
  const canMark = round?.round.status === "live" && player != null && card != null;
  const markShot = async () => {
    if (!round || !player || !fix) return;
    setBusy(true);
    try {
      await addShot(round.round.id, player.id, hole, fix);
      setShots(await loadRoundShots(round.round.id));
      // Show how far it went, on the side of the map.
      setShotCardHidden(false);
      setShotCardOpen(false);
    } catch (e) {
      const msg = (e as { message?: unknown } | null)?.message;
      Alert.alert("That shot didn't save", typeof msg === "string" && msg ? msg : "Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  };
  // Which club was the last shot? Only for your own shots (0153).
  const lastClubKey = lastEnd && player ? `${player.id}-${hole}-${lastEnd.n}` : null;
  const lastClub = lastClubKey ? (shotClubs.get(lastClubKey) ?? null) : null;
  const canTag = round != null && player != null && player.memberId === me && lastEnd?.distance != null;
  const tagLast = async (club: string | null) => {
    if (!round || !player || !lastEnd || lastEnd.distance == null || !lastClubKey) return;
    setTagging(true);
    setShotClubs((m) => {
      const next = new Map(m);
      if (club) next.set(lastClubKey, club);
      else next.delete(lastClubKey);
      return next;
    });
    try {
      await tagShotClub(round.round.id, player.id, hole, lastEnd.n, club, lastEnd.distance);
      void loadMyBag()
        .then(setBag)
        .catch(() => {});
    } catch {
      Alert.alert("Couldn't save the club", "Please try again.");
      void loadShotClubs(round.round.id).then(setShotClubs).catch(() => {});
    } finally {
      setTagging(false);
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
  const gesture = useRef<"hole" | "sheet" | null>(null);
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          (Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2) || (Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5),
        onPanResponderGrant: (_e, g) => {
          gesture.current = Math.abs(g.dy) > Math.abs(g.dx) ? "sheet" : "hole";
        },
        onPanResponderMove: (_e, g) => {
          if (gesture.current !== "sheet") return;
          const { tuckBy: by, tucked: down } = sheetRef.current;
          sheetY.setValue(Math.max(0, Math.min(by, (down ? by : 0) + g.dy)));
        },
        onPanResponderRelease: (_e, g) => {
          if (gesture.current === "sheet") {
            const { tuckBy: by, tucked: down } = sheetRef.current;
            const at = (down ? by : 0) + g.dy;
            settle(g.vy > 0.4 ? true : g.vy < -0.4 ? false : at > by / 2);
          } else {
            const { hole: h, holeCount: n } = holeRef.current;
            if (g.dx < -60 && h < n) setHole(h + 1);
            else if (g.dx > 60 && h > 1) setHole(h - 1);
          }
          gesture.current = null;
        },
        onPanResponderTerminate: () => {
          if (gesture.current === "sheet") settle(sheetRef.current.tucked);
          gesture.current = null;
        },
      }),
    [sheetY, settle]
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
      ? `From you${fix?.accuracyM != null ? ` · ±${Math.round(fix.accuracyM)} m` : ""}${fromTeeM != null && fromTeeM > 20 ? ` · ${fmt(fromTeeM)} ${u} from the tee` : ""}`
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
  // Always: local knowledge lives in the list.
  const hasDetails = true;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: course?.name ?? title, headerShown: false }} />
      <StatusBar style="light" />

      <View style={StyleSheet.absoluteFill}>
        <HoleMapView ref={mapRef} scene={scene} onTap={setTap} onTee={moveTee} onPin={movePin} />
      </View>
      {/* The wind across the map: over the photo, under every button. */}
      {windFx ? <WindStream deg={windFx.deg} level={windFx.level} /> : null}

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
        {geo.mapped ? (
          <MapButton
            icon={arcsMode === "off" ? "radio-button-off" : "radio-button-on"}
            label={arcsMode === "off" ? "Show distance arcs" : arcsMode === "50" ? "Distance arcs every 50. Show my clubs" : "Arcs at my clubs. Hide arcs"}
            onPress={cycleArcs}
            on={arcsMode !== "off"}
          />
        ) : null}
        {shapes && shapes.length > 0 ? (
          <MapButton icon={showOutlines ? "layers" : "layers-outline"} label={showOutlines ? "Hide course outlines" : "Show course outlines"} onPress={toggleOutlines} />
        ) : null}
        {tap || movedTee || movedPin ? (
          <MapButton
            icon="refresh"
            label="Put the tee, flag and aim back"
            onPress={() => {
              setTap(null);
              forgetMoves();
            }}
          />
        ) : null}
        {canSaveFix ? (
          <MapButton icon="cloud-upload-outline" label="Save the flag and tee for everyone" onPress={saveFix} disabled={savingFix} />
        ) : null}
      </View>

      {/* Over the map, left: how far the last marked shot went. Tap for
          the rest from that spot: from the tee, and to the green. */}
      {wind && windShot ? (
        <WindChip
          top={insets.top + 62}
          arrowDeg={arrowOnScreen(wind.fromDeg, mapRotation)}
          speed={windSpeed(wind.speedKmh, unit === "yards")}
          gust={wind.gustKmh != null && wind.gustKmh > wind.speedKmh + 5 ? windSpeed(wind.gustKmh, unit === "yards").split(" ")[0] : null}
          line={windLine(windShot)}
          showing={windShow}
          level={level}
          onToggle={() => {
            rememberedWindShow = !windShow;
            setWindShow(!windShow);
          }}
        />
      ) : null}

      {lastEnd && !shotCardHidden ? (
        <ShotCard
          top={insets.top + 62 + (wind && windShot ? 64 : 0)}
          n={lastEnd.n}
          distance={lastEnd.distance != null ? fmt(lastEnd.distance) : null}
          unit={u}
          open={shotCardOpen}
          onToggle={() => setShotCardOpen((o) => !o)}
          onClose={() => setShotCardHidden(true)}
          rows={[
            { label: "From the tee", value: lastEnd.fromTee != null ? `${fmt(lastEnd.fromTee)} ${u}` : "–" },
            ...(geo.mapped
              ? (() => {
                  const g = greenDistancesM(geo, lastEnd.at);
                  return [
                    { label: "To the front", value: g.front != null ? `${fmt(g.front)} ${u}` : "–" },
                    { label: movedPin ? "To the pin" : "To the centre", value: g.centre != null ? `${fmt(g.centre)} ${u}` : "–" },
                    { label: "To the back", value: g.back != null ? `${fmt(g.back)} ${u}` : "–" },
                  ];
                })()
              : []),
          ]}
        >
          {canTag ? (
            <ClubTagRow order={clubOrder(lastClub ? [lastClub] : likelyClubs(bag ?? [], lastEnd.distance!), bag)} chosen={lastClub} busy={tagging} onPick={(c) => void tagLast(c)} />
          ) : null}
        </ShotCard>
      ) : null}

      {/* Over the map, bottom: the hole and the three numbers. Swipe for the next hole. */}
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + 10, transform: [{ translateY: sheetY }] }]}
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
        {...swipe.panHandlers}
      >
        <Pressable
          onPress={() => settle(!tucked)}
          hitSlop={{ top: 10, bottom: 6, left: 60, right: 60 }}
          style={styles.handleHit}
          accessibilityRole="button"
          accessibilityLabel={tucked ? "Show the rest of the panel" : "Tuck the panel down to see more of the map"}
        >
          <View style={styles.handle} />
        </Pressable>
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

        <View style={styles.greenRow} onLayout={(e) => setPeekH(Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height + 12))}>
          <Yardage label="Front" value={geo.mapped && greens ? fmt(greens.front) : "–"} />
          <Yardage
            label={movedPin ? "Pin" : "Centre"}
            value={geo.mapped && greens ? fmt(greens.centre) : "–"}
            big
            flag={movedPin ? PIN_COLOURS[zone] : undefined}
          />
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

        {geo.mapped ? (
          <PlaysLikeRow playsLike={playsLike} windDelta={windDelta} suggestion={suggestion} fmt={(m) => fmt(m)} unit={u} onBag={() => router.push("/my-bag")} />
        ) : null}

        <YardagesSponsor ad={partner} />

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
                      {!fix ? "Waiting for GPS" : !fixIsUsable(fix.accuracyM) ? "Weak GPS, hold on" : `Mark shot ${ends.length + 1}`}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
            {canMark && myShots.length > 0 ? (
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
      </Animated.View>

      <Modal visible={detailsOpen} transparent animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDetailsOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.details, keyboardH > 0 && styles.detailsTyping, { paddingBottom: keyboardH > 0 ? keyboardH + spacing.sm : insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <ScrollView ref={detailsScroll} contentContainerStyle={styles.detailsContent} {...FORM_SCROLL_KEYBOARD} automaticallyAdjustKeyboardInsets={false}>
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
                {ends.length === 0 ? (
                  <Text style={styles.muted}>Walk to your ball and tap "Mark shot": it shows how far that shot went.</Text>
                ) : (
                  ends.map((e) => {
                    const left = geo.mapped && geo.greenCentre ? distanceM(e.at, geo.greenCentre) : null;
                    return (
                      <View key={e.n} style={styles.shotRow}>
                        <View style={styles.shotNo}>
                          <Text style={styles.shotNoText}>{e.n}</Text>
                        </View>
                        <Text style={styles.shotText}>
                          {e.distance != null ? `${fmt(e.distance)} ${u}` : "Marked"}
                          {left != null ? <Text style={styles.muted}>{`  ·  ${fmt(left)} ${u} left`}</Text> : null}
                        </Text>
                      </View>
                    );
                  })
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

            {Number.isFinite(clubId) ? <TipsBlock clubId={clubId} hole={hole} onTyping={() => setTimeout(() => detailsScroll.current?.scrollToEnd({ animated: true }), 300)} /> : null}

            {wind ? <WindCredit wind={wind} /> : null}

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

function Yardage({ label, value, big = false, flag }: { label: string; value: string; big?: boolean; flag?: string }) {
  return (
    <View style={styles.yardage} accessible accessibilityLabel={label === "Pin" ? `To the pin, ${value}` : `${label} of the green, ${value}`}>
      <View style={styles.yardageHead}>
        {flag ? <Ionicons name="flag" size={12} color={flag} /> : null}
        <Text style={styles.yardageLabel}>{label}</Text>
      </View>
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

/**
 * How far the last marked shot went, floating on the left of the map. Tap
 * it to open the rest from that spot (from the tee, to the green); × hides
 * it until the next shot is marked.
 */
function ShotCard({
  top,
  n,
  distance,
  unit,
  open,
  onToggle,
  onClose,
  rows,
  children,
}: {
  children?: React.ReactNode;
  top: number;
  n: number;
  distance: string | null;
  unit: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  rows: { label: string; value: string }[];
}) {
  return (
    <View style={[styles.shotCard, { top }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Shot ${n}${distance ? `, ${distance} ${unit}` : ""}. ${open ? "Hide" : "Show"} the other distances.`}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <View style={styles.shotCardHead}>
          <Text style={styles.shotCardEyebrow}>SHOT {n}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.gold400} />
        </View>
        {distance ? (
          <Text style={styles.shotCardBig}>
            {distance}
            <Text style={styles.shotCardUnit}> {unit}</Text>
          </Text>
        ) : (
          <Text style={styles.shotCardMarked}>Marked</Text>
        )}
        {open ? (
          <View style={styles.shotCardRows}>
            {rows.map((r) => (
              <View key={r.label} style={styles.shotCardRow}>
                <Text style={styles.shotCardLabel}>{r.label}</Text>
                <Text style={styles.shotCardValue}>{r.value}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.shotCardHint}>Tap for more</Text>
        )}
      </Pressable>
      {children}
      <Pressable onPress={onClose} hitSlop={10} style={styles.shotCardClose} accessibilityRole="button" accessibilityLabel="Hide the shot distance">
        <Ionicons name="close" size={14} color={creamAlpha(0.7)} />
      </Pressable>
    </View>
  );
}

function MapButton({
  icon,
  label,
  onPress,
  disabled = false,
  flat = false,
  on = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** A switch that's on: gold ring. */
  on?: boolean;
  /** On the sheet rather than the photo: no disc behind it. */
  flat?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.mapButton, flat && styles.flatButton, on && styles.mapButtonOn, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Ionicons name={icon} size={20} color={on ? colors.gold400 : colors.cream50} />
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
  mapButtonOn: { borderWidth: 2, borderColor: colors.gold400 },
  shotCard: {
    position: "absolute",
    left: spacing.sm + 2,
    minWidth: 128,
    maxWidth: 210,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 28,
    borderRadius: radii.lg,
    backgroundColor: ON_PHOTO,
    borderWidth: 1,
    borderColor: colors.gold500,
  },
  shotCardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  shotCardEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.gold400 },
  shotCardBig: { fontFamily: fonts.display, fontSize: 38, lineHeight: 44, color: colors.cream50 },
  shotCardUnit: { fontFamily: fonts.bodySemi, fontSize: 15, color: creamAlpha(0.8) },
  shotCardMarked: { fontFamily: fonts.display, fontSize: 22, lineHeight: 30, color: colors.cream50 },
  shotCardHint: { fontFamily: fonts.body, fontSize: 11.5, color: creamAlpha(0.65) },
  shotCardRows: { marginTop: 6, gap: 4 },
  shotCardRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  shotCardLabel: { fontFamily: fonts.body, fontSize: 12.5, color: creamAlpha(0.75) },
  shotCardValue: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  shotCardClose: { position: "absolute", top: 8, right: 8 },
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
    paddingTop: 2,
    paddingHorizontal: spacing.md,
    gap: 6,
  },
  handleHit: { alignSelf: "center", paddingVertical: 4, paddingHorizontal: 20 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: creamAlpha(0.35) },
  notMappedText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: creamAlpha(0.85), textAlign: "center", paddingTop: 4 },
  holeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  holeMid: { alignItems: "center", flex: 1 },
  holeWord: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.4, color: colors.gold400 },
  holeNumber: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.cream50 },
  holeMeta: { fontFamily: fonts.bodySemi, fontSize: 13, color: creamAlpha(0.8) },

  greenRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around" },
  yardage: { alignItems: "center", minWidth: 80 },
  yardageHead: { flexDirection: "row", alignItems: "center", gap: 4 },
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
  detailsTyping: { maxHeight: "92%" },
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
