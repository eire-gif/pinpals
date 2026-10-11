import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { dayBoard } from "@/lib/live-day-board";
import type { Match } from "@/lib/live-match-days";
import { toParLabel } from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The society day's leaderboard (0121): every player, every group, one
 * table. Stableford shows points (and pace against two a hole); stroke play
 * shows net to par. Your own row is tinted. Tap a row for that group's card
 * — your own to score, anyone else's to watch.
 */
export function DayBoard({ matches, me }: { matches: Match[]; me: string | null }) {
  const board = dayBoard(matches);
  const stableford = board.format === "stableford";
  const mineIds = new Set(matches.flatMap((m) => m.players.filter((p) => p.memberId != null && p.memberId === me).map((p) => p.id)));

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.title}>Leaderboard</Text>
      {board.cardIncomplete ? (
        <Text style={styles.note}>Some stroke indexes are still missing, so points count from the holes that have them.</Text>
      ) : null}
      <View style={styles.table}>
        <View style={[styles.tr, styles.th]}>
          <Text style={[styles.pos, styles.thText]}>Pos</Text>
          <Text style={[styles.name, styles.thText]}>Player</Text>
          <Text style={[styles.thru, styles.thText]}>Thru</Text>
          <Text style={[styles.score, styles.thText]}>{stableford ? "Pts" : "Net"}</Text>
        </View>
        {board.rows.map((r) => {
          const mine = mineIds.has(r.playerId);
          const score = stableford ? String(r.points) : toParLabel(r.netToPar);
          const sub = r.thru === 0 ? (r.teeTime ? `Group ${r.group} · tees off ${r.teeTime.slice(0, 5)}` : `Group ${r.group}`) : stableford ? `Group ${r.group} · ${r.pace >= 0 ? "+" : ""}${r.pace} on pace` : `Group ${r.group}`;
          return (
            <Pressable
              key={`${r.roundId}-${r.playerId}`}
              onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(r.roundId) } })}
              style={({ pressed }) => [styles.tr, mine && styles.mine, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${r.position ? `Position ${r.position}, ` : ""}${r.name}, ${r.thru === 0 ? "not started" : `${score} ${stableford ? "points" : "net"} thru ${r.thru}`}. Group ${r.group}.`}
            >
              <Text style={[styles.pos, styles.posText]}>{r.position || "–"}</Text>
              <View style={styles.name}>
                <Text style={[styles.nameText, mine && styles.mineText]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {sub}
                </Text>
              </View>
              <Text style={[styles.thru, styles.cell]}>{r.thru === 0 ? "–" : r.thru}</Text>
              <Text style={[styles.score, styles.scoreText]}>{r.thru === 0 ? "–" : score}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>Groups go out at different times: compare &ldquo;thru&rdquo; as well as the score. Tap anyone to see their group&apos;s card.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  note: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  table: { borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tr: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  th: { backgroundColor: colors.navy900, borderTopWidth: 0, paddingVertical: 8 },
  thText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.cream50 },
  mine: { backgroundColor: colors.green100 },
  pos: { width: 34 },
  posText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  name: { flex: 1, gap: 1 },
  nameText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  mineText: { fontFamily: fonts.bodyBold },
  sub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  thru: { width: 40, textAlign: "center" },
  cell: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  score: { width: 48, textAlign: "right" },
  scoreText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.navy900 },
});
