import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { LieArt as Art } from "@/lib/training";
import { colors } from "@/lib/theme";

/**
 * The little picture of each lie (Training). Plain Views, like guide-art.tsx
 * — the app has no SVG library. Drawn in a box `size` wide and 0.62 of that
 * high; everything scales from `size`, so the same art serves the 52pt list
 * tile and the guide's hero.
 */

const SAND = "#e6cf98";
const SAND_DARK = "#c9ab6a";
const TURF = "#2f7a3d";
const TURF_DARK = "#1f5c2e";
const SKY = "#173a68";

export function LieArtTile({ art, size, flip = false }: { art: Art; size: number; flip?: boolean }) {
  const w = size;
  const h = Math.round(size * 0.62);
  const u = size / 100; // one "unit": the drawings are planned on a 100-wide grid
  const ball = (x: number, y: number, r = 5) => (
    <View style={{ position: "absolute", left: (x - r) * u, top: (y - r) * u, width: r * 2 * u, height: r * 2 * u, borderRadius: r * u, backgroundColor: "#fff", borderWidth: Math.max(0.5, 0.4 * u), borderColor: "#d8d8d8" }} />
  );
  // A strip of ground through (cx, cy) at an angle in degrees.
  const ground = (cy: number, deg: number, color = TURF) => (
    <View style={{ position: "absolute", left: -20 * u, width: 140 * u, top: cy * u, height: 60 * u, backgroundColor: color, transform: [{ rotate: `${deg}deg` }] }} />
  );
  const feet = (y: number) => (
    <View style={{ position: "absolute", left: 18 * u, top: y * u, flexDirection: "row", gap: 3 * u }}>
      <View style={{ width: 7 * u, height: 3.5 * u, borderRadius: 2 * u, backgroundColor: colors.gold400 }} />
      <View style={{ width: 7 * u, height: 3.5 * u, borderRadius: 2 * u, backgroundColor: colors.gold400 }} />
    </View>
  );
  const grass = (y: number, tall: number, n = 14) => (
    <View style={{ position: "absolute", left: 6 * u, right: 6 * u, top: (y - tall) * u, height: tall * u, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ width: 1.6 * u, height: (tall * (0.65 + ((i * 37) % 10) / 28)) * u, backgroundColor: i % 2 ? "#7cc46f" : "#5fae58", transform: [{ rotate: `${((i * 53) % 21) - 10}deg` }] }} />
      ))}
    </View>
  );
  const wind = (dir: "in" | "out") => (
    <View style={{ position: "absolute", left: 10 * u, top: 8 * u, gap: 2 * u }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", marginLeft: i * 8 * u }}>
          <Ionicons name={dir === "in" ? "arrow-back" : "arrow-forward"} size={11 * u} color="rgba(255,255,255,0.85)" />
          <View style={{ width: 22 * u, height: 1.4 * u, backgroundColor: "rgba(255,255,255,0.7)", marginLeft: dir === "in" ? -2 * u : 0 }} />
        </View>
      ))}
    </View>
  );

  let body: React.ReactNode = null;
  switch (art) {
    case "uphill":
      body = (<>{ground(42, -14)}{ball(52, 30)}</>);
      break;
    case "downhill":
      body = (<>{ground(28, 14)}{ball(48, 31)}</>);
      break;
    case "above":
      body = (<>{ground(48, -28)}{feet(52)}{ball(70, 24)}</>);
      break;
    case "below":
      body = (<>{ground(10, 28)}{feet(14)}{ball(70, 44)}</>);
      break;
    case "splash":
      body = (
        <>
          {ground(30, 0)}
          <View style={{ position: "absolute", left: 18 * u, width: 64 * u, top: 30 * u, height: 26 * u, borderBottomLeftRadius: 32 * u, borderBottomRightRadius: 32 * u, backgroundColor: SAND }} />
          {ball(50, 37)}
        </>
      );
      break;
    case "plugged":
      body = (
        <>
          {ground(30, 0)}
          <View style={{ position: "absolute", left: 18 * u, width: 64 * u, top: 30 * u, height: 26 * u, borderBottomLeftRadius: 32 * u, borderBottomRightRadius: 32 * u, backgroundColor: SAND }} />
          <View style={{ position: "absolute", left: 40 * u, top: 37 * u, width: 20 * u, height: 7 * u, borderRadius: 10 * u, backgroundColor: SAND_DARK }} />
          {ball(50, 40, 4.5)}
        </>
      );
      break;
    case "fairwayBunker":
      body = (
        <>
          {ground(44, 0, SAND)}
          <View style={{ position: "absolute", left: 66 * u, top: 22 * u, width: 50 * u, height: 40 * u, backgroundColor: TURF, borderTopLeftRadius: 14 * u }} />
          {ball(36, 39)}
        </>
      );
      break;
    case "flier":
      body = (<>{ground(40, 0)}{grass(41, 6)}{ball(50, 33)}</>);
      break;
    case "thick":
      body = (<>{ground(40, 0, TURF_DARK)}{ball(50, 37)}{grass(42, 16, 18)}</>);
      break;
    case "divot":
      body = (
        <>
          {ground(36, 0)}
          <View style={{ position: "absolute", left: 36 * u, top: 35 * u, width: 30 * u, height: 8 * u, borderRadius: 10 * u, backgroundColor: "#8a6a44" }} />
          {ball(50, 37)}
        </>
      );
      break;
    case "trees":
      body = (
        <>
          {ground(44, 0)}
          {[[8, -6, 30], [34, -10, 36], [64, -8, 34]].map(([x, y, r], i) => (
            <View key={i} style={{ position: "absolute", left: x * u, top: y * u, width: r * u, height: r * u, borderRadius: r * u, backgroundColor: i === 1 ? "#244d27" : "#2c5a2c" }} />
          ))}
          <View style={{ position: "absolute", left: 30 * u, top: 39 * u, width: 50 * u, height: 1.6 * u, backgroundColor: colors.gold400 }} />
          {ball(26, 39)}
        </>
      );
      break;
    case "bare":
      body = (<>{ground(40, 0, "#9b7b52")}{ball(50, 35)}</>);
      break;
    case "into":
      body = (<>{ground(44, 0)}{wind("in")}{ball(70, 39)}</>);
      break;
    case "down":
      body = (<>{ground(44, 0)}{wind("out")}{ball(70, 39)}</>);
      break;
  }

  return (
    <View
      style={[styles.box, { width: w, height: h, borderRadius: Math.max(8, 12 * u) }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[StyleSheet.absoluteFill, flip && { transform: [{ scaleX: -1 }] }]}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden", backgroundColor: SKY, borderWidth: 1, borderColor: "rgba(211,165,63,0.55)" },
});
