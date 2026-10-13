import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { GuideArt } from "@/lib/guide";
import { colors, fonts } from "@/lib/theme";

/**
 * Drawings of the hole map for the how-to guide (lib/guide.ts, holeMap).
 *
 * A stylised top-down hole in the map's own colours — the white T, the aim
 * circle, the flag coloured by where the pin is, bunker and water dots, the
 * blue "you" dot and numbered shots — so a member recognises them on the
 * real satellite view. Drawn with plain Views (no SVG library in the app),
 * on a fixed 300 × 420 canvas.
 *
 * Keep these matching components/hole-map-page.ts when the map changes.
 */

const W = 300;
const H = 420;
const PANEL = 84;

const C = {
  rough: "#3d5f30",
  roughDark: "#2c4a24",
  fairway: "#6f9d47",
  fairwayStripe: "#79a74f",
  green: "#86c95f",
  greenEdge: "#a7dd84",
  tee: "#8fc466",
  sand: "#e9d9a6",
  water: "#3b8fd0",
  white: "#ffffff",
  you: "#1d8cf8",
  pinFront: "#e2483d",
  pinMiddle: "#ffd23f",
  pinBack: "#ffffff",
  shadow: "rgba(12,32,56,0.45)",
};

type P = { x: number; y: number };

const GREEN: P = { x: 150, y: 72 };
const FRONT: P = { x: 150, y: 104 };
const BACK: P = { x: 150, y: 40 };
const TEE: P = { x: 150, y: 306 };
const AIM: P = { x: 150, y: 176 };

// ---------------------------------------------------------------------------
// Drawing bits
// ---------------------------------------------------------------------------

function Line({ a, b, color = C.white, width = 2.5, dotted = false, opacity = 0.95 }: { a: P; b: P; color?: string; width?: number; dotted?: boolean; opacity?: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (dotted) {
    const n = Math.max(2, Math.floor(len / 9));
    return (
      <>
        {Array.from({ length: n + 1 }, (_, i) => (
          <View key={i} style={[s.abs, { left: a.x + (dx * i) / n - 1.5, top: a.y + (dy * i) / n - 1.5, width: 3, height: 3, borderRadius: 1.5, backgroundColor: color, opacity }]} />
        ))}
      </>
    );
  }
  return (
    <View
      style={[
        s.abs,
        {
          left: (a.x + b.x) / 2 - len / 2,
          top: (a.y + b.y) / 2 - width / 2,
          width: len,
          height: width,
          borderRadius: width / 2,
          backgroundColor: color,
          opacity,
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
        },
      ]}
    />
  );
}

function Blob({ at, w, h, color, r, rotate = 0, children }: { at: P; w: number; h: number; color: string; r?: number; rotate?: number; children?: ReactNode }) {
  return <View style={[s.abs, { left: at.x - w / 2, top: at.y - h / 2, width: w, height: h, borderRadius: r ?? Math.min(w, h) / 2, backgroundColor: color, transform: [{ rotate: `${rotate}deg` }] }]}>{children}</View>;
}

function Tag({ at, text, gold = false, big = false }: { at: P; text: string; gold?: boolean; big?: boolean }) {
  return (
    <View style={[s.abs, s.tag, gold && s.tagGold, { left: at.x, top: at.y }]}>
      <Text style={[s.tagText, gold && s.tagTextGold, big && s.tagBig]}>{text}</Text>
    </View>
  );
}

function Note({ at, text, align = "left" }: { at: P; text: string; align?: "left" | "right" }) {
  return (
    <View style={[s.abs, s.note, { top: at.y }, align === "left" ? { left: at.x } : { right: W - at.x }]}>
      <Text style={s.noteText}>{text}</Text>
    </View>
  );
}

function TeeMark({ at, ghost = false }: { at: P; ghost?: boolean }) {
  return (
    <View style={[s.abs, s.teeMark, ghost && s.ghost, { left: at.x - 13, top: at.y - 13 }]}>
      <Text style={s.teeMarkText}>T</Text>
    </View>
  );
}

function Flag({ at, color = C.pinMiddle, ghost = false }: { at: P; color?: string; ghost?: boolean }) {
  return (
    <View style={[s.abs, ghost && s.ghost, { left: at.x - 2, top: at.y - 34 }]}>
      <View style={s.flagPole} />
      <View style={[s.flagCloth, { backgroundColor: color }]} />
      <View style={s.flagFoot} />
    </View>
  );
}

function Aim({ at, ghost = false }: { at: P; ghost?: boolean }) {
  return (
    <View style={[s.abs, s.aim, ghost && s.aimGhost, { left: at.x - 17, top: at.y - 17 }]}>
      <View style={s.aimDot} />
    </View>
  );
}

function You({ at }: { at: P }) {
  return (
    <>
      <Blob at={at} w={44} h={44} color="rgba(74,163,223,0.18)" />
      <View style={[s.abs, s.you, { left: at.x - 8, top: at.y - 8 }]} />
    </>
  );
}

function Shot({ at, n }: { at: P; n: number }) {
  return (
    <View style={[s.abs, s.shot, { left: at.x - 11, top: at.y - 11 }]}>
      <Text style={s.shotText}>{n}</Text>
    </View>
  );
}

function Hazard({ at, color, distance }: { at: P; color: string; distance?: string }) {
  return (
    <>
      <View style={[s.abs, s.hazard, { left: at.x - 6, top: at.y - 6, backgroundColor: color }]} />
      {distance ? <Text style={[s.abs, s.hazardText, { left: at.x + 9, top: at.y - 8 }]}>{distance}</Text> : null}
    </>
  );
}

function Hand({ at, dir = "up" }: { at: P; dir?: "up" | "left" | "right" }) {
  return (
    <View style={[s.abs, { left: at.x, top: at.y }]}>
      <Ionicons name={dir === "up" ? "hand-left" : "hand-right"} size={26} color={colors.gold400} style={s.handShadow} />
    </View>
  );
}

/** The hole itself: rough, fairway, green, bunkers, water, the tee box. */
function Course({ water = true }: { water?: boolean }) {
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.rough }]} />
      <Blob at={{ x: 18, y: 120 }} w={70} h={160} color={C.roughDark} rotate={8} />
      <Blob at={{ x: 290, y: 250 }} w={80} h={200} color={C.roughDark} rotate={-6} />
      <Blob at={{ x: 255, y: 40 }} w={90} h={70} color={C.roughDark} />
      {/* Fairway, mown in stripes */}
      <Blob at={{ x: 150, y: 196 }} w={96} h={190} color={C.fairway} r={48} rotate={4}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={{ position: "absolute", left: 0, right: 0, top: 18 + i * 34, height: 16, backgroundColor: C.fairwayStripe }} />
        ))}
      </Blob>
      <Blob at={GREEN} w={78} h={74} color={C.greenEdge} />
      <Blob at={GREEN} w={70} h={66} color={C.green} />
      <Blob at={{ x: 104, y: 92 }} w={32} h={18} color={C.sand} rotate={-25} />
      <Blob at={{ x: 196, y: 62 }} w={26} h={16} color={C.sand} rotate={30} />
      <Blob at={{ x: 196, y: 168 }} w={34} h={20} color={C.sand} rotate={10} />
      {water ? <Blob at={{ x: 72, y: 214 }} w={48} h={74} color={C.water} rotate={-12} /> : null}
      <Blob at={{ x: 150, y: 306 }} w={42} h={22} color={C.tee} r={6} />
      <Blob at={{ x: 150, y: 336 }} w={36} h={18} color={C.tee} r={6} />
    </>
  );
}

/** The bottom panel, as the map shows it. */
function Panel({ front, centre, back, from, pin = false }: { front: string; centre: string; back: string; from: string; pin?: boolean }) {
  return (
    <View style={s.panel}>
      <View style={s.panelHead}>
        <Text style={s.panelHole}>HOLE 4</Text>
        <Text style={s.panelMeta}>Par 4 · SI 7 · 412 yds</Text>
      </View>
      <View style={s.panelNums}>
        <View style={s.num}>
          <Text style={s.numLabel}>Front</Text>
          <Text style={s.numSmall}>{front}</Text>
        </View>
        <View style={s.num}>
          <Text style={[s.numLabel, pin && { color: colors.gold400 }]}>{pin ? "Pin ⚑" : "Centre"}</Text>
          <Text style={s.numBig}>{centre}</Text>
        </View>
        <View style={s.num}>
          <Text style={s.numLabel}>Back</Text>
          <Text style={s.numSmall}>{back}</Text>
        </View>
      </View>
      <Text style={s.panelFrom}>{from}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The scenes
// ---------------------------------------------------------------------------

function Scene({ art }: { art: GuideArt }) {
  switch (art) {
    case "holeOverview":
      return (
        <>
          <Course />
          <Line a={TEE} b={AIM} />
          <Line a={AIM} b={GREEN} />
          <Tag at={{ x: 160, y: 236 }} text="230" />
          <Tag at={{ x: 160, y: 118 }} text="182" gold big />
          <Aim at={AIM} />
          <Hazard at={FRONT} color={C.white} />
          <Hazard at={BACK} color={C.white} />
          <Flag at={GREEN} />
          <TeeMark at={TEE} />
          <Note at={{ x: 8, y: 300 }} text="The tee" />
          <Note at={{ x: 8, y: 166 }} text="Aim circle" />
          <Note at={{ x: 292, y: 24 }} text="The pin" align="right" />
          <Panel front="166" centre="182" back="198" from="From the aim circle" />
        </>
      );
    case "holeNumbers": {
      const me = { x: 158, y: 214 };
      return (
        <>
          <Course />
          <Line a={me} b={FRONT} opacity={0.6} width={1.5} />
          <Line a={me} b={GREEN} />
          <Line a={me} b={BACK} opacity={0.6} width={1.5} />
          <Hazard at={FRONT} color={C.white} />
          <Hazard at={BACK} color={C.white} />
          <Flag at={GREEN} />
          <You at={me} />
          <Note at={{ x: 194, y: 210 }} text="You" />
          <Note at={{ x: 196, y: 96 }} text="Front · 142" />
          <Note at={{ x: 196, y: 70 }} text="Centre · 151" />
          <Note at={{ x: 196, y: 34 }} text="Back · 160" />
          <Panel front="142" centre="151" back="160" from="From you · ±4 m" />
        </>
      );
    }
    case "holeDrag": {
      const pin: P = { x: 160, y: 50 };
      const tee: P = { x: 150, y: 336 };
      return (
        <>
          <Course />
          <Line a={tee} b={pin} />
          <Flag at={GREEN} ghost />
          <Line a={{ x: 152, y: 66 }} b={{ x: 158, y: 54 }} color={colors.gold400} width={2} />
          <Flag at={pin} color={C.pinBack} />
          <TeeMark at={TEE} ghost />
          <TeeMark at={tee} />
          <Hand at={{ x: 172, y: 40 }} />
          <Hand at={{ x: 166, y: 330 }} />
          <Note at={{ x: 292, y: 18 }} text="Drag the flag to today's pin" align="right" />
          <Note at={{ x: 8, y: 356 - PANEL + 40 }} text="Drag T to your tee box" />
          <Panel front="171" centre="196" back="203" from="From your tee" pin />
        </>
      );
    }
    case "holeAim": {
      const aim: P = { x: 186, y: 160 };
      return (
        <>
          <Course />
          <Aim at={AIM} ghost />
          <Line a={TEE} b={aim} />
          <Line a={aim} b={GREEN} />
          <Tag at={{ x: 120, y: 226 }} text="245" />
          <Tag at={{ x: 176, y: 106 }} text="167" gold big />
          <Aim at={aim} />
          <Hand at={{ x: 200, y: 168 }} />
          <Flag at={GREEN} />
          <TeeMark at={TEE} />
          <Note at={{ x: 8, y: 150 }} text="Drag or tap to move it" />
          <Note at={{ x: 214, y: 116 }} text="Left to the green" />
          <Panel front="151" centre="167" back="183" from="From the aim circle · Reset" />
        </>
      );
    }
    case "holeHazards": {
      const me = { x: 150, y: 268 };
      return (
        <>
          <Course />
          <Hazard at={{ x: 196, y: 168 }} color={C.sand} distance="98" />
          <Hazard at={{ x: 72, y: 214 }} color={C.water} distance="61" />
          <Hazard at={{ x: 104, y: 92 }} color={C.sand} distance="178" />
          <Hazard at={{ x: 196, y: 62 }} color={C.sand} distance="208" />
          <Hazard at={{ x: 24, y: 120 }} color="#2f6b3a" distance="152" />
          <Flag at={GREEN} />
          <You at={me} />
          <View style={[s.abs, s.sheet]}>
            <Text style={s.sheetTitle}>Ahead of you</Text>
            <Text style={s.sheetRow}>
              <Text style={{ color: C.water }}>●</Text> Water · 61 yds
            </Text>
            <Text style={s.sheetRow}>
              <Text style={{ color: C.sand }}>●</Text> Fairway bunker · 98 yds
            </Text>
            <Text style={s.sheetRow}>
              <Text style={{ color: C.sand }}>●</Text> Greenside bunker · 178 yds
            </Text>
          </View>
        </>
      );
    }
    case "holeShots": {
      const s2: P = { x: 136, y: 150 };
      const s3: P = { x: 160, y: 96 };
      return (
        <>
          <Course />
          <Line a={TEE} b={s2} />
          <Line a={s2} b={s3} />
          <Tag at={{ x: 150, y: 222 }} text="248" />
          <Tag at={{ x: 156, y: 116 }} text="61" />
          <Shot at={TEE} n={1} />
          <Shot at={s2} n={2} />
          <You at={s3} />
          <Flag at={GREEN} />
          <View style={[s.abs, s.lastShot]}>
            <Text style={s.lastShotKicker}>SHOT 2</Text>
            <Text style={s.lastShotBig}>61 yds</Text>
            <Text style={s.lastShotSmall}>Tap for more</Text>
          </View>
          <View style={[s.abs, s.markBtn]}>
            <Ionicons name="locate" size={16} color={colors.cream50} />
            <Text style={s.markText}>Mark shot 3</Text>
          </View>
        </>
      );
    }
  }
}

export function HoleArt({ art }: { art: GuideArt }) {
  return (
    <View style={s.frame} accessible accessibilityRole="image" accessibilityLabel={LABELS[art]}>
      <View style={s.canvas}>
        <Scene art={art} />
        <View style={[s.abs, s.topBar]}>
          <Ionicons name="chevron-back" size={14} color={colors.cream50} />
          <Text style={s.topText}>Portmarnock Links</Text>
          <View style={s.units}>
            <Text style={s.unitsText}>yds</Text>
          </View>
        </View>
      </View>
      <Text style={s.caption}>Illustration — the real map uses satellite photos.</Text>
    </View>
  );
}

const LABELS: Record<GuideArt, string> = {
  holeOverview: "A hole on the map: the tee at the bottom, the aim circle on the fairway, and the pin on the green, with distances.",
  holeNumbers: "Distances from you to the front, centre and back of the green.",
  holeDrag: "Dragging the flag to today's pin and the T to your tee box.",
  holeAim: "Moving the aim circle: distance to it, and what's left to the green.",
  holeHazards: "Bunkers and water marked with the distance to each.",
  holeShots: "Shots marked on the map, with how far each went.",
};

const s = StyleSheet.create({
  abs: { position: "absolute" },
  frame: { alignItems: "center", gap: 6 },
  canvas: { width: W, height: H, borderRadius: 18, overflow: "hidden", backgroundColor: C.rough, borderWidth: 3, borderColor: colors.navy900 },
  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  ghost: { opacity: 0.35 },
  topBar: { left: 8, right: 8, top: 8, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(12,32,56,0.72)" },
  topText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 12, color: colors.cream50 },
  units: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.cream50 },
  unitsText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.navy900 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: "rgba(12,32,56,0.78)" },
  tagGold: { backgroundColor: colors.gold400 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 12, color: C.white },
  tagTextGold: { color: colors.navy900 },
  tagBig: { fontSize: 17 },
  note: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.cream50 },
  noteText: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.navy900 },
  teeMark: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: C.white, borderWidth: 1, borderColor: C.shadow },
  teeMarkText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
  flagPole: { position: "absolute", left: 0, top: 0, width: 3, height: 34, borderRadius: 1.5, backgroundColor: C.white },
  flagCloth: { position: "absolute", left: 3, top: 1, width: 16, height: 11, borderTopRightRadius: 3, borderBottomRightRadius: 3, borderWidth: 0.5, borderColor: C.shadow },
  flagFoot: { position: "absolute", left: -2, top: 31, width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.white, borderWidth: 1, borderColor: C.shadow },
  aim: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: C.white, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  aimGhost: { opacity: 0.4, borderStyle: "dashed" },
  aimDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.white },
  you: { width: 16, height: 16, borderRadius: 8, backgroundColor: C.you, borderWidth: 2.5, borderColor: C.white },
  shot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.navy900, borderWidth: 2, borderColor: C.white },
  shotText: { fontFamily: fonts.bodyBold, fontSize: 11, color: C.white },
  hazard: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.85)" },
  hazardText: { fontFamily: fonts.bodyBold, fontSize: 11, color: C.white, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 2 },
  handShadow: { textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3 },
  panel: { position: "absolute", left: 0, right: 0, bottom: 0, height: PANEL, paddingHorizontal: 12, paddingTop: 7, backgroundColor: "rgba(12,32,56,0.92)" },
  panelHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  panelHole: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.gold400 },
  panelMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.cream100 },
  panelNums: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end", marginTop: 2 },
  num: { alignItems: "center" },
  numLabel: { fontFamily: fonts.bodySemi, fontSize: 10, color: colors.cream100 },
  numSmall: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50 },
  numBig: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, color: colors.cream50 },
  panelFrom: { fontFamily: fonts.body, fontSize: 10, color: colors.cream100, textAlign: "center" },
  sheet: { left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingVertical: 10, gap: 3, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: colors.cream50 },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },
  sheetRow: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink900 },
  lastShot: { left: 10, top: 150, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: "rgba(12,32,56,0.85)" },
  lastShotKicker: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 1, color: colors.gold400 },
  lastShotBig: { fontFamily: fonts.display, fontSize: 18, color: colors.cream50 },
  lastShotSmall: { fontFamily: fonts.body, fontSize: 10, color: colors.cream100 },
  markBtn: { left: 60, right: 60, bottom: 14, height: 40, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.green700, borderWidth: 2, borderColor: colors.cream50 },
  markText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.cream50 },
});
