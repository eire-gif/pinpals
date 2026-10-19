import { Image, StyleSheet, View, type ImageSourcePropType } from "react-native";

import type { LieArt as Art } from "@/lib/training";

/**
 * The picture of each lie (Training): a realistic scene with the ball sitting
 * in that lie. The app has no SVG library, so the scenes are drawn as SVG in
 * `mobile/tools/lie-art/` and rendered to JPEGs there (see its render.mjs) —
 * edit the SVG and re-render rather than editing the JPEGs.
 *
 * `size` is the width; the height is 11/16 of it. `fill` stretches the picture
 * to its parent's width with no frame of its own (the Training home tiles).
 */

export const LIE_ART_RATIO = 220 / 320;

const PICTURES: Record<Art, ImageSourcePropType> = {
  uphill: require("../../assets/images/lies/uphill.jpg"),
  downhill: require("../../assets/images/lies/downhill.jpg"),
  above: require("../../assets/images/lies/above.jpg"),
  below: require("../../assets/images/lies/below.jpg"),
  splash: require("../../assets/images/lies/splash.jpg"),
  plugged: require("../../assets/images/lies/plugged.jpg"),
  fairwayBunker: require("../../assets/images/lies/fairwayBunker.jpg"),
  flier: require("../../assets/images/lies/flier.jpg"),
  thick: require("../../assets/images/lies/thick.jpg"),
  divot: require("../../assets/images/lies/divot.jpg"),
  trees: require("../../assets/images/lies/trees.jpg"),
  bare: require("../../assets/images/lies/bare.jpg"),
  into: require("../../assets/images/lies/into.jpg"),
  down: require("../../assets/images/lies/down.jpg"),
};

export function LieArtTile({ art, size, flip = false, fill = false }: { art: Art; size?: number; flip?: boolean; fill?: boolean }) {
  const w = size ?? 100;
  const frame = fill
    ? { width: "100%" as const, aspectRatio: 1 / LIE_ART_RATIO }
    : [styles.framed, { width: w, height: Math.round(w * LIE_ART_RATIO), borderRadius: Math.max(8, w * 0.12) }];
  return (
    <View style={[styles.box, frame]} accessible={false} importantForAccessibility="no-hide-descendants">
      {/* Explicit width/height: without them the picture keeps its own pixel size and only its top-left corner shows. */}
      <Image source={PICTURES[art]} resizeMode="cover" style={[styles.picture, flip && { transform: [{ scaleX: -1 }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden", backgroundColor: "#173a68" },
  picture: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" },
  framed: { borderWidth: 1, borderColor: "rgba(211,165,63,0.55)" },
});
