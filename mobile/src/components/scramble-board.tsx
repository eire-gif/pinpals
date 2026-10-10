import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import type { Match } from "@/lib/live-match-days";
import { buildBoard, toParLabel } from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The scramble-day leaderboard (0113): every team, ranked by net or gross
 * against par for the holes played, so groups out at different times
 * compare fairly. Tap a team for its card.
 */

type TeamRow = {
  m: Match;
  name: string;
  members: string;
  thru: number;
  gross: number;
  netToPar: number;
  grossToPar: number;
  done: boolean;
  position: string;
};

export function teamRows(matches: Match[], by: "net" | "gross"): TeamRow[] {
  const rows: TeamRow[] = matches.map((m) => {
    const scr = m.round.scramble;
    const ordered = [...m.players].sort((a, b) => a.position - b.position);
    const lead = ordered[0];
    const name = scr?.teamName ?? `Team ${m.round.matchNumber ?? scr?.teamNumber ?? ""}`.trim();
    const members = ordered.map((p) => p.name.split(" ")[0]).join(" · ");
    const r = lead ? buildBoard("stroke", m.card, [{ id: lead.id, name, playingHandicap: scr?.teamHandicap ?? 0 }], m.scores).rows[0] : null;
    const played = lead ? [...(m.scores.get(lead.id)?.keys() ?? [])] : [];
    const parPlayed = m.card.filter((c) => played.includes(c.hole)).reduce((n, c) => n + c.par, 0);
    const thru = r?.thru ?? 0;
    return {
      m,
      name,
      members,
      thru,
      gross: r?.gross ?? 0,
      netToPar: r?.netToPar ?? 0,
      grossToPar: (r?.gross ?? 0) - parPlayed,
      done: m.round.status === "finished" || thru === m.card.length,
      position: "",
    };
  });
  const key = (r: TeamRow) => (by === "net" ? r.netToPar : r.grossToPar);
  const started = rows.filter((r) => r.thru > 0).sort((a, b) => key(a) - key(b) || b.thru - a.thru || a.name.localeCompare(b.name));
  for (const r of started) {
    const first = started.findIndex((o) => key(o) === key(r));
    const tied = started.filter((o) => key(o) === key(r)).length > 1;
    r.position = `${tied ? "T" : ""}${first + 1}`;
  }
  const waiting = rows
    .filter((r) => r.thru === 0)
    .sort((a, b) => (a.m.round.teeTime ?? "99").localeCompare(b.m.round.teeTime ?? "99") || (a.m.round.scramble?.teamNumber ?? 0) - (b.m.round.scramble?.teamNumber ?? 0));
  return [...started, ...waiting];
}

export function ScrambleBoard({ matches, isMine }: { matches: Match[]; isMine: (m: Match) => boolean }) {
  const [by, setBy] = useState<"net" | "gross">("net");
  const rows = teamRows(matches, by);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.head}>
        <Text style={styles.title}>Leaderboard</Text>
        <View style={styles.toggle}>
          {(["net", "gross"] as const).map((k) => (
            <Pressable key={k} onPress={() => setBy(k)} style={[styles.pill, by === k && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: by === k }}>
              <Text style={[styles.pillText, by === k && styles.pillTextOn]}>{k === "net" ? "Net" : "Gross"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.table}>
        <View style={[styles.tr, styles.th]}>
          <Text style={[styles.thText, styles.cPos]}>Pos</Text>
          <Text style={[styles.thText, { flex: 1 }]}>Team</Text>
          <Text style={[styles.thText, styles.cNum]}>Thru</Text>
          <Text style={[styles.thText, styles.cNum]}>{by === "net" ? "Gross" : "Net"}</Text>
          <Text style={[styles.thText, styles.cBig]}>{by === "net" ? "Net" : "Gross"}</Text>
        </View>
        {rows.map((r) => {
          const mine = isMine(r.m);
          const main = by === "net" ? r.netToPar : r.grossToPar;
          const other = by === "net" ? r.grossToPar : r.netToPar;
          return (
            <Pressable
              key={r.m.round.id}
              onPress={() => router.push({ pathname: "/live/round/[id]", params: { id: String(r.m.round.id) } })}
              style={({ pressed }) => [styles.tr, mine && styles.trMine, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${r.position ? `Position ${r.position}, ` : ""}${r.name}${r.thru ? `, thru ${r.thru}, ${by} ${toParLabel(main)}` : ", not started"}`}
            >
              <Text style={[styles.pos, styles.cPos]}>{r.position || "–"}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.team} numberOfLines={1}>
                  {r.name}
                  {mine ? <Text style={styles.you}>  · You</Text> : null}
                </Text>
                <Text style={styles.members} numberOfLines={1}>
                  {r.members}
                </Text>
              </View>
              <Text style={[styles.cell, styles.cNum]}>{r.thru === 0 ? (r.m.round.teeTime ?? "–") : r.done ? "F" : r.thru}</Text>
              <Text style={[styles.cell, styles.cNum]}>{r.thru ? toParLabel(other) : "–"}</Text>
              <Text style={[styles.big, styles.cBig, r.thru > 0 && main < 0 && { color: colors.green700 }]}>{r.thru ? toParLabel(main) : "–"}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.foot}>Against par for the holes played, so groups out at different times compare fairly. Tap a team for its card.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  toggle: { flexDirection: "row", gap: 4, backgroundColor: colors.cream100, borderRadius: radii.pill, padding: 3 },
  pill: { paddingHorizontal: 14, minHeight: 32, borderRadius: radii.pill, justifyContent: "center" },
  pillOn: { backgroundColor: colors.navy900 },
  pillText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  pillTextOn: { color: colors.cream50 },
  table: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, minHeight: 60, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm },
  trMine: { backgroundColor: "rgba(232,196,107,0.16)" },
  th: { minHeight: 36, borderTopWidth: 0, backgroundColor: colors.navy900 },
  thText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: colors.cream50 },
  cPos: { width: 34 },
  cNum: { width: 46, textAlign: "center" },
  cBig: { width: 48, textAlign: "right" },
  pos: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  team: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  you: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green700 },
  members: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 1 },
  cell: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  big: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  foot: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, textAlign: "center" },
});
