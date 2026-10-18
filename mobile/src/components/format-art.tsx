import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import type { FormatCategory, FormatVisual } from "@/lib/game-formats";
import { colors, fonts, radii } from "@/lib/theme";

/**
 * The pictures on a format's page (Menu → Play → Game formats), drawn from
 * Views so they need no new native module and stay sharp at any size. They
 * match the approved mock-ups: Stableford's points ladder, Foursomes' shot
 * order and tee plan, the Scramble's four drives and team handicap.
 */

const GOLD_LINE = "rgba(211,165,63,0.6)";

/** Tile colour per category — the house navy, green and lighter navy. */
export const TILE: Record<FormatCategory, string> = {
  individual: colors.navy900,
  matchplay: colors.navy800,
  pairs: colors.green700,
  team: colors.navy800,
  side: colors.navy900,
};

/** Navy card with a hairline gold border inset — the house frame. */
export function GoldFrame({ children, tone = "navy" }: { children: React.ReactNode; tone?: "navy" | "green" | "navy800" }) {
  const bg = tone === "green" ? colors.green700 : tone === "navy800" ? colors.navy800 : colors.navy900;
  return (
    <View style={[art.frame, { backgroundColor: bg }]}>
      <View style={art.frameInner}>{children}</View>
    </View>
  );
}

function Kicker({ children, dark }: { children: string; dark?: boolean }) {
  return <Text style={[art.kicker, dark && { color: colors.gold500 }]}>{children}</Text>;
}

// ---------------------------------------------------------------- Stableford

const POINTS: { label: string; pts: number; fill: string; text: string; strong?: boolean }[] = [
  { label: "Net albatross", pts: 5, fill: colors.green700, text: colors.green700 },
  { label: "Net eagle", pts: 4, fill: colors.green600, text: colors.green700 },
  { label: "Net birdie", pts: 3, fill: colors.gold500, text: colors.navy900 },
  { label: "Net par", pts: 2, fill: colors.navy900, text: colors.navy900, strong: true },
  { label: "Net bogey", pts: 1, fill: colors.ink500, text: colors.ink500 },
  { label: "Net double +", pts: 0, fill: colors.red600, text: colors.red600 },
];

function PointsLadder() {
  return (
    <View style={art.card} accessible accessibilityLabel="Stableford points: net albatross 5, net eagle 4, net birdie 3, net par 2, net bogey 1, net double bogey or worse 0.">
      <Kicker dark>THE POINTS</Kicker>
      {POINTS.map((p) => (
        <View key={p.label} style={art.ladderRow}>
          <Text style={[art.ladderLabel, p.strong && { fontFamily: fonts.bodyBold, color: colors.navy900 }]}>{p.label}</Text>
          <View style={[art.ladderTrack, p.pts === 0 && { backgroundColor: colors.red100 }]}>
            {p.pts > 0 ? <View style={[art.ladderBar, { width: `${p.pts * 20}%`, backgroundColor: p.fill }]} /> : null}
          </View>
          <Text style={[art.ladderPts, { color: p.text }]}>{p.pts}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Foursomes

const SHOTS: { who: "A" | "B"; what: string }[] = [
  { who: "A", what: "Drive — odd hole" },
  { who: "B", what: "Second shot" },
  { who: "A", what: "Approach" },
  { who: "B", what: "Putt — holed" },
];

function Ball({ who, glow }: { who: "A" | "B"; glow?: boolean }) {
  return (
    <View style={[art.ball, who === "A" ? art.ballA : art.ballB, glow && art.ballGlow]}>
      <Text style={art.ballText}>{who}</Text>
    </View>
  );
}

function AlternateShot() {
  return (
    <>
      <GoldFrame>
        <Kicker>ONE HOLE, SHOT BY SHOT</Kicker>
        <View style={art.shotRow} accessible accessibilityLabel="On an odd hole: player A drives, B plays the second shot, A the approach, B holes the putt. Four shots, one score.">
          <View style={art.holeStrip}>
            <Ionicons name="flag" size={20} color={colors.gold400} />
            {[...SHOTS].reverse().map((s, i) => (
              <Ball key={i} who={s.who} glow={i === SHOTS.length - 1} />
            ))}
          </View>
          <View style={art.shotList}>
            <Text style={art.shotText}>
              <Text style={art.shotStrong}>Holed</Text> · 4 shots, one score
            </Text>
            {[...SHOTS].reverse().map((s, i) => (
              <Text key={i} style={art.shotText}>
                <Text style={i === SHOTS.length - 1 ? art.shotGold : art.shotStrong}>{`Player ${s.who}`}</Text>
                {` · ${s.what}`}
              </Text>
            ))}
          </View>
        </View>
      </GoldFrame>

      <View style={art.card}>
        <View style={art.legendRow}>
          <Kicker dark>WHO DRIVES WHERE</Kicker>
          <View style={art.legend}>
            <View style={art.legendItem}><View style={[art.legendSwatch, { backgroundColor: colors.gold500 }]} /><Text style={art.legendText}>Player A</Text></View>
            <View style={art.legendItem}><View style={[art.legendSwatch, { backgroundColor: colors.navy900 }]} /><Text style={art.legendText}>Player B</Text></View>
          </View>
        </View>
        <View style={art.holeGrid} accessible accessibilityLabel="Player A drives holes 1, 3, 5 and every odd hole. Player B drives every even hole.">
          {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
            <View key={n} style={[art.holeCell, n % 2 === 1 ? { backgroundColor: colors.gold500 } : { backgroundColor: colors.navy900 }]}>
              <Text style={[art.holeNum, { color: n % 2 === 1 ? colors.navy900 : colors.gold400 }]}>{n}</Text>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------- Scramble

const TEAM: { name: string; ch: number; share: number }[] = [
  { name: "Player 1", ch: 6, share: 0.25 },
  { name: "Player 2", ch: 12, share: 0.2 },
  { name: "Player 3", ch: 18, share: 0.15 },
  { name: "Player 4", ch: 24, share: 0.1 },
];

function ScrambleDrives() {
  const total = TEAM.reduce((s, p) => s + p.ch * p.share, 0);
  return (
    <>
      <GoldFrame>
        <Kicker>FOUR DRIVES, ONE CHOSEN</Kicker>
        <View style={art.fairway} accessible accessibilityLabel="Four drives on the fairway. The best one is circled in gold, and everyone plays the next shot from there.">
          <View style={art.fairwayStripe} />
          <View style={[art.dot, { left: "12%", top: 44 }]} />
          <View style={[art.dot, { left: "30%", top: 64 }]} />
          <View style={[art.dot, { left: "66%", top: 88 }]} />
          <View style={[art.chosen, { left: "44%", top: 22 }]}>
            <View style={art.chosenBall} />
          </View>
          <View style={[art.chosenTag, { left: "58%", top: 26 }]}>
            <Text style={art.chosenTagText}>Best drive</Text>
          </View>
          <View style={art.teeBox} />
          <Text style={art.teeLabel}>TEE</Text>
        </View>
        <Text style={art.frameNote}>Everyone plays the next shot from beside the chosen ball — no nearer the hole. Repeat until it's holed.</Text>
      </GoldFrame>

      <View style={[art.card, art.dashed]}>
        <Kicker dark>TEAM HANDICAP · TEAM OF FOUR</Kicker>
        <Text style={art.cardText}>Course handicaps lowest to highest, then a set share of each:</Text>
        <View style={art.table}>
          {TEAM.map((p, i) => (
            <View key={p.name} style={[art.tableRow, i > 0 && art.tableLine]}>
              <Text style={art.tableName}>{`${p.name} · ${p.ch}`}</Text>
              <Text style={art.tableShare}>{`× ${Math.round(p.share * 100)}%`}</Text>
              <Text style={art.tableVal}>{(p.ch * p.share).toFixed(1)}</Text>
            </View>
          ))}
          <View style={art.tableTotal}>
            <Text style={art.tableTotalLabel}>Team handicap</Text>
            <Text style={art.tableTotalVal}>{Math.floor(total + 0.5)}</Text>
          </View>
        </View>
        <Text style={art.cardNote}>Team of three: 30%, 20% and 10%. Team of two: 35% of the lower plus 15% of the higher.</Text>
      </View>
    </>
  );
}

export function FormatArt({ visual }: { visual: FormatVisual }) {
  if (visual === "points") return <PointsLadder />;
  if (visual === "alternate") return <AlternateShot />;
  return <ScrambleDrives />;
}

const art = StyleSheet.create({
  frame: {
    borderRadius: 22,
    padding: 5,
    shadowColor: colors.navy900,
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  frameInner: { borderWidth: 1, borderColor: GOLD_LINE, borderRadius: 17, padding: 16, gap: 14 },
  frameNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.cream100 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2, color: colors.gold500 },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 22, padding: 18, gap: 10 },
  dashed: { backgroundColor: colors.surfaceTint, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.gold500 },
  cardText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink900 },
  cardNote: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500 },

  // Points ladder
  ladderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ladderLabel: { width: 108, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  ladderTrack: { flex: 1, height: 22, borderRadius: 6, backgroundColor: colors.green100, overflow: "hidden" },
  ladderBar: { height: 22, borderRadius: 6 },
  ladderPts: { width: 22, textAlign: "right", fontFamily: fonts.bodyBold, fontSize: 17 },

  // Alternate shot
  shotRow: { flexDirection: "row", gap: 16 },
  holeStrip: {
    width: 74,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
    backgroundColor: colors.green700,
    borderRadius: 37,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(232,196,107,0.5)",
  },
  ball: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  ballA: { backgroundColor: colors.gold400 },
  ballB: { backgroundColor: colors.cream50 },
  ballGlow: { borderWidth: 3, borderColor: "rgba(232,196,107,0.45)" },
  ballText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },
  shotList: { flex: 1, justifyContent: "space-between", paddingVertical: 8, gap: 10 },
  shotText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.cream100 },
  shotStrong: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  shotGold: { fontFamily: fonts.bodyBold, color: colors.gold400 },

  legendRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  legend: { flexDirection: "row", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch: { width: 12, height: 12, borderRadius: 4 },
  legendText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink900 },
  holeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  holeCell: { width: "10.1%", flexGrow: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  holeNum: { fontFamily: fonts.bodyBold, fontSize: 13 },

  // Scramble
  fairway: { height: 150, borderRadius: 16, backgroundColor: colors.green700, borderWidth: 1, borderColor: "rgba(232,196,107,0.4)", overflow: "hidden" },
  fairwayStripe: { position: "absolute", left: "24%", right: "24%", top: 0, bottom: 0, backgroundColor: colors.green600 },
  dot: { position: "absolute", width: 11, height: 11, borderRadius: 6, backgroundColor: "rgba(239,231,214,0.75)" },
  chosen: { position: "absolute", width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  chosenBall: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.cream50 },
  chosenTag: { position: "absolute", backgroundColor: colors.gold400, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  chosenTagText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.navy900 },
  teeBox: { position: "absolute", left: "44%", bottom: 12, width: 20, height: 12, borderRadius: 4, backgroundColor: colors.gold500 },
  teeLabel: { position: "absolute", left: 8, bottom: 8, fontFamily: fonts.bodyBold, fontSize: 10, color: colors.cream100 },

  table: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.surface },
  tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10 },
  tableLine: { borderTopWidth: 1, borderTopColor: colors.cream100 },
  tableName: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink900 },
  tableShare: { width: 60, fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
  tableVal: { width: 40, textAlign: "right", fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  tableTotal: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.navy900 },
  tableTotalLabel: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  tableTotalVal: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold400 },
});
