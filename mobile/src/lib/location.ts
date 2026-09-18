import { useCallback, useState } from "react";
import * as Location from "expo-location";

export type Coords = { lat: number; lng: number };

export type LocationState =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "ready"; coords: Coords }
  | { status: "denied" }
  | { status: "failed" };

/**
 * Location, asked for only when the member taps "Near me".
 *
 * Deliberately not requested on launch. iOS shows the permission dialog once
 * per install, and a member who is asked before they understand why says no —
 * after which the only way back is Settings, which nobody does. Asking at the
 * moment of use means the dialog arrives with its reason already obvious.
 *
 * `Balanced` accuracy rather than `High`: this feeds a radius search measured
 * in tens of kilometres, so GPS-grade precision costs battery and a slower fix
 * to produce an answer that rounds to the same result.
 */
export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>({ status: "idle" });

  const request = useCallback(async () => {
    setState({ status: "asking" });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setState({ status: "denied" });
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      setState({ status: "ready", coords });
      return coords;
    } catch {
      // Indoors with no fix, location services off at the OS level, a simulator
      // with no position set — all land here, and all mean the same thing to
      // the member: we couldn't tell where you are.
      setState({ status: "failed" });
      return null;
    }
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, request, reset };
}
