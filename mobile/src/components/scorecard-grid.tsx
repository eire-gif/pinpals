import { StyleSheet, Text, View } from "react-native";

import { ScoreMark as Mark } from "@/components/score-mark";
import type { ScorecardHole } from "@/lib/scorecard-math";
import { colors, fonts } from "@/lib/theme";

/**
 * Nine holes of a scorecard, laid out like the paper card: hole, yards, par,
 * stroke index, the score ringed for a birdie and boxed for a bogey (with
 * shot dots), and putts. Used by the card itself (scorecards/[id]) and by
 * the certify screen (scorecards/certify/[id]), so a certifier checks
 * exactly what the owner sees.
 *
 * `highlight`: a hole to mark — the one a playing partner queried.
 */
export function Nine({
  title,
  holes,
  total,
  shots,
  yards,
  si,
  putts,
  highlight,
}: {
  title: string;
  holes: ScorecardHole[];
  total: { par: number; strokes: number | null; yards: number | null; putts: number | null };
  shots: Map<number, number>;
  yards: boolean;
  si: boolean;
  putts: boolean;
  highlight?: number | null;
}) {
  return (
    <View style={styles.nine}>
      <Row label="Hole" cells={holes.map((h) => String(h.hole))} total={title} head />
      {yards ? <Row label="Yds" cells={holes.map((h) => (h.yards != null ? String(h.yards) : "–"))} total={total.yards != null ? String(total.yards) : "–"} small /> : null}
      <Row label="Par" cells={holes.map((h) => String(h.par))} total={String(total.par)} />
      {si ? <Row label="SI" cells={holes.map((h) => (h.strokeIndex != null ? String(h.strokeIndex) : "–"))} total="" small /> : null}
      <View style={styles.row}>
        <Text style={[styles.rowLabel, styles.scoreLabel]}>Score</Text>
        {holes.map((h) => (
          <View key={h.hole} style={[styles.cell, h.hole === highlight && styles.highlight]}>
            <ScoreMark hole={h} shots={shots.get(h.hole) ?? 0} />
          </View>
        ))}
        <Text style={[styles.cell, styles.totalCell, styles.scoreTotal]}>{total.strokes ?? "–"}</Text>
      </View>
      {putts ? <Row label="Putts" cells={holes.map((h) => (h.putts != null ? String(h.putts) : "–"))} total={total.putts != null ? String(total.putts) : "–"} small /> : null}
    </View>
  );
}

function Row({ label, cells, total, head = false, small = false }: { label: string; cells: string[]; total: string; head?: boolean; small?: boolean }) {
  return (
    <View style={[styles.row, head && styles.headRow]}>
      <Text style={[styles.rowLabel, head && styles.headText]}>{label}</Text>
      {cells.map((c, i) => (
        <Text key={i} style={[styles.cell, styles.cellText, small && styles.smallText, head && styles.headText]}>
          {c}
        </Text>
      ))}
      <Text style={[styles.cell, styles.totalCell, styles.cellText, small && styles.smallText, head && styles.headText]}>{total}</Text>
    </View>
  );
}

/** Ringed for under par, boxed for over, the way a card is marked up. */
function ScoreMark({ hole, shots }: { hole: ScorecardHole; shots: number }) {
  if (hole.strokes == null) return <Text style={styles.cellText}>–</Text>;
  return (
    <View>
      <Mark strokes={hole.strokes} par={hole.par} size={24} />
      {shots > 0 ? <Text style={styles.dot}>{"•".repeat(Math.min(shots, 2))}</Text> : null}
    </View>
  );
}

const CELL = 1;

const styles = StyleSheet.create({
  nine: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 28, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  headRow: { backgroundColor: colors.green800 },
  rowLabel: { width: 44, paddingLeft: 8, fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  scoreLabel: { color: colors.ink900 },
  headText: { color: colors.cream50, fontFamily: fonts.bodyBold },
  cell: { flex: CELL, alignItems: "center", justifyContent: "center", textAlign: "center", paddingVertical: 4 },
  highlight: { backgroundColor: "#f8ecc9" },
  cellText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink900, textAlign: "center" },
  smallText: { fontSize: 10.5, color: colors.ink500 },
  totalCell: { flex: 1.5, backgroundColor: colors.cream100 },
  scoreTotal: { fontFamily: fonts.display, fontSize: 16, color: colors.ink900 },
  dot: { position: "absolute", top: -6, right: -4, fontSize: 10, color: colors.green700 },
});
