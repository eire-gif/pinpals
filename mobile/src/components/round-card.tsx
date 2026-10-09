import { StyleSheet, Text, View } from "react-native";

import { TeeDot } from "@/components/tee-chip";
import type { RoundDetails } from "@/lib/post-details";
import { holeResult, playedLabel, vsParText } from "@/lib/scorecard-math";
import { colors, creamAlpha, fonts, radii } from "@/lib/theme";

/**
 * A round post's scorecard (Oct 2026) — in place of the row of chips.
 *
 * A navy header with the course, tees (in their colour), date and the score;
 * then, when the round was shared from a scorecard (0111, details.hole_pars
 * and hole_scores), the card itself, front nine over back nine with birdies
 * ringed and bogeys boxed like the paper one; then the stats the member
 * gave. A round typed in by hand has no holes, so it's the header and stats.
 *
 * Pure layout from the post's details: nothing is loaded, so it costs the
 * feed nothing, and it ships over the air.
 */
export function RoundCard({ details, courseName, width }: { details: RoundDetails; courseName: string | null; width: number }) {
  const holes = details.holes === 9 ? 9 : 18;
  const pars = details.hole_pars?.length === holes ? details.hole_pars : null;
  const scores = details.hole_scores?.length === holes ? details.hole_scores : null;
  const coursePar = details.course_par ?? (pars ? pars.reduce((a, b) => a + b, 0) : undefined);
  const toPar = coursePar !== undefined ? vsParText(details.score - coursePar) : null;

  const sub = [
    details.tee ? `${details.tee} tees` : null,
    details.played_on ? playedLabel(details.played_on) : null,
    holes === 9 ? "9 holes" : null,
  ].filter(Boolean);

  const stats: { label: string; value: string }[] = [];
  if (details.front_nine !== undefined && details.back_nine !== undefined && !pars) {
    stats.push({ label: "Out", value: String(details.front_nine) }, { label: "In", value: String(details.back_nine) });
  }
  if (details.birdies !== undefined) stats.push({ label: details.birdies === 1 ? "Birdie" : "Birdies", value: String(details.birdies) });
  if (details.putts !== undefined) stats.push({ label: "Putts", value: String(details.putts) });
  if (details.fairways_hit !== undefined)
    stats.push({ label: "Fairways", value: details.fairways_total !== undefined ? `${details.fairways_hit}/${details.fairways_total}` : String(details.fairways_hit) });
  if (details.gir !== undefined) stats.push({ label: "Greens", value: String(details.gir) });
  if (details.longest_drive !== undefined) stats.push({ label: "Longest drive", value: `${details.longest_drive} yd` });
  if (details.differential !== undefined) stats.push({ label: "Differential", value: String(details.differential) });

  const inner = width - PAD * 2;
  const cell = Math.floor((inner - LABEL_W - TOTAL_W) / 9);

  return (
    <View style={[styles.card, { width }]} accessible accessibilityLabel={label(details, courseName, toPar)}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.kicker}>ROUND</Text>
          <Text style={styles.course} numberOfLines={2}>
            {courseName ?? "A round of golf"}
          </Text>
          {sub.length > 0 && (
            <View style={styles.subRow}>
              {details.tee ? <TeeDot name={details.tee} size={10} /> : null}
              <Text style={styles.sub} numberOfLines={1}>
                {sub.join(" · ")}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.score}>{details.score}</Text>
          {toPar ? (
            <View style={[styles.toPar, toPar.startsWith("-") && styles.toParUnder]}>
              <Text style={[styles.toParText, toPar.startsWith("-") && styles.toParTextUnder]}>{toPar}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {pars && scores ? (
        <View style={styles.grid}>
          <Nine first={1} pars={pars.slice(0, 9)} scores={scores.slice(0, 9)} title={holes === 9 ? "Tot" : "Out"} cell={cell} />
          {holes === 18 ? <Nine first={10} pars={pars.slice(9)} scores={scores.slice(9)} title="In" cell={cell} /> : null}
        </View>
      ) : null}

      {stats.length > 0 && (
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Nine({ first, pars, scores, title, cell }: { first: number; pars: number[]; scores: number[]; title: string; cell: number }) {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return (
    <View style={styles.nine}>
      <View style={styles.row}>
        <Text style={[styles.rowLabel, styles.holeText]}>Hole</Text>
        {pars.map((_, i) => (
          <Text key={i} style={[styles.cellText, styles.holeText, { width: cell }]}>
            {first + i}
          </Text>
        ))}
        <Text style={[styles.cellText, styles.holeText, styles.total]}>{title}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Par</Text>
        {pars.map((p, i) => (
          <Text key={i} style={[styles.cellText, styles.parText, { width: cell }]}>
            {p}
          </Text>
        ))}
        <Text style={[styles.cellText, styles.parText, styles.total]}>{sum(pars)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={[styles.rowLabel, styles.scoreLabel]}>Score</Text>
        {scores.map((s, i) => (
          <View key={i} style={[styles.markCell, { width: cell }]}>
            <Mark strokes={s} par={pars[i]} />
          </View>
        ))}
        <Text style={[styles.cellText, styles.scoreTotal, styles.total]}>{sum(scores)}</Text>
      </View>
    </View>
  );
}

function Mark({ strokes, par }: { strokes: number; par: number }) {
  const r = holeResult(strokes, par);
  const ring = r === "birdie" || r === "eagle" || r === "albatross";
  const box = r === "bogey" || r === "double" || r === "worse";
  return (
    <View style={[styles.mark, ring && styles.ring, ring && r !== "birdie" && styles.ringDouble, box && styles.box, box && r !== "bogey" && styles.boxDouble]}>
      <Text style={[styles.markText, ring && styles.markUnder]}>{strokes}</Text>
    </View>
  );
}

function label(d: RoundDetails, course: string | null, toPar: string | null): string {
  const parts = [`Round${course ? ` at ${course}` : ""}`, `scored ${d.score}${toPar ? `, ${toPar}` : ""}`];
  if (d.tee) parts.push(`${d.tee} tees`);
  if (d.birdies) parts.push(`${d.birdies} birdies`);
  if (d.putts !== undefined) parts.push(`${d.putts} putts`);
  return parts.join(", ");
}

const PAD = 12;
const LABEL_W = 38;
const TOTAL_W = 32;

const styles = StyleSheet.create({
  card: { borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  head: { backgroundColor: colors.navy900, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  headText: { flex: 1, minWidth: 0 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.4, color: colors.gold400 },
  course: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: colors.cream50, marginTop: 2 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  sub: { flexShrink: 1, fontFamily: fonts.body, fontSize: 12.5, color: creamAlpha(0.78) },
  scoreBox: { alignItems: "center" },
  score: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: colors.gold400 },
  toPar: { marginTop: 2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, backgroundColor: creamAlpha(0.14) },
  toParUnder: { backgroundColor: colors.green600 },
  toParText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.cream50 },
  toParTextUnder: { color: colors.cream50 },
  grid: { paddingHorizontal: PAD, paddingTop: 10, gap: 8 },
  nine: { borderRadius: 8, backgroundColor: colors.surfaceTint, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 22 },
  rowLabel: { width: LABEL_W, paddingLeft: 6, fontFamily: fonts.bodySemi, fontSize: 10.5, color: colors.ink500 },
  scoreLabel: { color: colors.ink900 },
  cellText: { textAlign: "center", fontFamily: fonts.body, fontSize: 12, color: colors.ink900 },
  holeText: { fontSize: 10, color: colors.ink500 },
  parText: { color: colors.ink500 },
  total: { width: TOTAL_W, fontFamily: fonts.bodyBold },
  scoreTotal: { fontSize: 13, color: colors.navy900 },
  markCell: { alignItems: "center", paddingVertical: 2 },
  mark: { minWidth: 21, height: 21, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "transparent" },
  ring: { borderRadius: 11, borderColor: colors.green700 },
  ringDouble: { borderWidth: 3, borderColor: colors.green700 },
  box: { borderRadius: 2, borderColor: colors.navy800 },
  boxDouble: { borderWidth: 3 },
  markText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink900 },
  markUnder: { color: colors.green800 },
  stats: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 6, paddingVertical: 10 },
  stat: { minWidth: "25%", flexGrow: 1, alignItems: "center", paddingVertical: 4 },
  statValue: { fontFamily: fonts.display, fontSize: 18, color: colors.navy900 },
  statLabel: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.ink500, marginTop: 1 },
});
