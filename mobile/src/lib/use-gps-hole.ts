import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";

import { holeSpots, mergeSpots, type Fix, type HoleSpots } from "@/lib/gps-hole";
import { loadCourseLayouts } from "@/lib/hole-maps";
import { loadCourse } from "@/lib/onboarding";
import { loadCourseShapes } from "@/lib/osm-fetch";
import { osmLayoutPoints } from "@/lib/osm-course";

/**
 * Each hole's tees and green for a course (gps-hole.ts): golfapi.io's layout
 * where it has the hole, OpenStreetMap's otherwise. Empty until loaded, or
 * for a course with no map at all — then nothing ever moves on by itself.
 */
export function useHoleSpots(clubId: number | null, holes: readonly number[]): Map<number, HoleSpots> {
  const [spots, setSpots] = useState<Map<number, HoleSpots>>(new Map());
  const key = holes.join(",");
  useEffect(() => {
    if (clubId == null) return;
    let on = true;
    void (async () => {
      try {
        const layouts = await loadCourseLayouts(clubId);
        const fromApi = holeSpots(layouts[0]?.points ?? [], holes);
        if (on) setSpots(fromApi);
        // Every hole has a tee from golfapi: no need for OpenStreetMap.
        if (holes.every((n) => (fromApi.get(n)?.tees.length ?? 0) > 0)) return;
        const c = await loadCourse(clubId);
        if (c?.latitude == null || c.longitude == null) return;
        const at = { lat: c.latitude, lng: c.longitude };
        const shapes = await loadCourseShapes(clubId, at);
        if (on && shapes.length) setSpots(mergeSpots(fromApi, holeSpots(osmLayoutPoints(shapes, at), holes)));
      } catch {
        // No map: the round works exactly as before.
      }
    })();
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, key]);
  return spots;
}

/**
 * The member's position on the live round screen, for moving on to the next
 * hole. Only if they've already let PinPals use their location (the hole map
 * asks) — the round screen never asks by itself. Watched while the screen is
 * open, at a walking pace's worth of accuracy, and stopped when it isn't.
 */
export function useRoundFix(active: boolean): Fix | null {
  const [fix, setFix] = useState<Fix | null>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      let on = true;
      void (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (!on || status !== "granted" || watch.current) return;
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, distanceInterval: 8, timeInterval: 4000 },
            (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null })
          );
          if (on) watch.current = sub;
          else sub.remove();
        } catch {
          // Location unavailable: no moving on by itself.
        }
      })();
      return () => {
        on = false;
        watch.current?.remove();
        watch.current = null;
      };
    }, [active])
  );
  return fix;
}
